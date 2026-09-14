//! Project hooks: a shell command a project runs before or after one of its promptware runs.
//!
//! **A failing hook never fails its job.** A non-zero exit, a timeout, a command that cannot be
//! spawned and a condition that does not hold are all logged and then ignored — even for a `before`
//! hook, which runs while the job is still deciding what to do. Hooks are notifications, not gates,
//! and [`run_hooks`] returns `()` rather than a `Result` so that property is enforced by the type
//! instead of by a comment a caller can `?` its way past.
//!
//! The decisions ([`matching_hooks`], [`condition_holds`]) are pure and the process spawn is
//! injectable ([`HookExecutor`]), mirroring the `SpecBuilder` seam in [`crate::jobs::manager`], so a
//! test can assert on what *would* have been executed without executing anything.

use crate::config::{expand_variables_with_env, EnvSource, SystemEnv};
use crate::jobs::hook_condition::{
    classify_hook_condition, evaluate_powershell_condition, HookConditionLanguage,
};
use crate::jobs::logger::append_agent_log;
use crate::jobs::process_tree::{kill_tree, DEFAULT_KILL_GRACE};
use crate::models::{JobStatus, ProjectConfig, PromptwareHookConfig};
use futures_util::future::BoxFuture;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// How long a hook's `condition` may run before it is killed and treated as not holding.
pub const HOOK_CONDITION_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a hook's `action` may run before it is killed.
pub const HOOK_ACTION_TIMEOUT: Duration = Duration::from_secs(30);
/// Cap on the captured bytes of each of a hook's streams. A chatty hook must not bloat the job log.
pub const HOOK_OUTPUT_LIMIT: usize = 8 * 1024;

/// When a hook runs relative to the promptware.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookPhase {
    Before,
    After,
}

impl HookPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Before => "before",
            Self::After => "after",
        }
    }
}

impl std::fmt::Display for HookPhase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// One command a hook wants run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookCommandSpec {
    pub hook_name: String,
    /// Already variable-expanded, so an executor never has to know about `%TENDRIL_HOME%`.
    pub command: String,
    pub working_dir: PathBuf,
    pub env: Vec<(String, String)>,
    pub timeout: Duration,
}

/// What running a hook command produced. Every failure mode is a value here rather than an error:
/// there is no caller who could usefully handle one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HookCommandResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub spawn_error: Option<String>,
}

pub type HookFuture = BoxFuture<'static, HookCommandResult>;

/// Runs one hook command. Takes an owned spec so the returned future borrows nothing from the
/// caller — a `BoxFuture<'a, _>` seam is unusable from a test holding its stub in a local.
pub type HookExecutor = Arc<dyn Fn(HookCommandSpec) -> HookFuture + Send + Sync>;

/// Everything a hook run needs from the job that triggered it.
pub struct HookRunContext {
    pub tendril_home: PathBuf,
    pub config_path: PathBuf,
    pub project: ProjectConfig,
    pub job_id: String,
    pub job_type: String,
    pub job_status: JobStatus,
    /// Empty for a `CreatePlan` job, which has no plan folder yet.
    pub plan_folder: String,
}

impl HookRunContext {
    /// The directory a hook's command runs in: the plan folder when there is one, otherwise
    /// `TENDRIL_HOME`.
    ///
    /// The original used `"."` as the fallback, which in a daemon means whichever directory it
    /// happens to have been started from — a deliberate divergence.
    pub fn working_dir(&self) -> PathBuf {
        if !self.plan_folder.is_empty() {
            let folder = PathBuf::from(&self.plan_folder);
            if folder.is_dir() {
                return folder;
            }
        }
        self.tendril_home.clone()
    }

    fn hook_env(&self) -> Vec<(String, String)> {
        vec![
            ("TENDRIL_JOB_ID".to_string(), self.job_id.clone()),
            ("TENDRIL_JOB_TYPE".to_string(), self.job_type.clone()),
            (
                "TENDRIL_JOB_STATUS".to_string(),
                self.job_status.as_str().to_string(),
            ),
            ("TENDRIL_PLAN_FOLDER".to_string(), self.plan_folder.clone()),
            (
                "TENDRIL_CONFIG".to_string(),
                self.config_path.to_string_lossy().to_string(),
            ),
            (
                "TENDRIL_HOME".to_string(),
                self.tendril_home.to_string_lossy().to_string(),
            ),
        ]
    }
}

/// The hooks of `project` that fire for `promptware` in `phase`, in config order.
///
/// A `when` that is neither `before` nor `after` matches no phase, so a typo leaves the hook inert.
/// An empty `promptwares` list matches every promptware.
pub fn matching_hooks<'a>(
    project: &'a ProjectConfig,
    promptware: &str,
    phase: HookPhase,
) -> Vec<&'a PromptwareHookConfig> {
    project
        .hooks
        .iter()
        .filter(|h| h.when.trim().eq_ignore_ascii_case(phase.as_str()))
        .filter(|h| {
            h.promptwares.is_empty()
                || h.promptwares
                    .iter()
                    .any(|p| p.trim().eq_ignore_ascii_case(promptware))
        })
        .collect()
}

/// Whether a condition's result lets the hook's action run. An empty condition never reaches here.
///
/// `False` on stdout counts as not holding: a condition ported from the original is a PowerShell
/// expression, and `Test-Path` printing `False` exits zero.
pub fn condition_holds(result: &HookCommandResult) -> bool {
    if result.timed_out || result.spawn_error.is_some() {
        return false;
    }
    if result.exit_code != Some(0) {
        return false;
    }
    !result.stdout.trim().eq_ignore_ascii_case("False")
}

/// What a hook's condition decided, before the action ever runs.
enum HookConditionVerdict {
    /// The action should run.
    Holds,
    /// The condition was evaluated and genuinely did not hold — a normal skip.
    NotMet(String),
    /// The condition could not be evaluated at all (unsupported syntax, timeout, spawn failure).
    /// Distinguished from `NotMet` so a broken condition never reads like an honest `False`.
    Unevaluable(String),
}

/// Runs every hook of `ctx.project` that matches `ctx.job_type` and `phase`, in config order.
///
/// Never returns an error and never propagates one: see the module docs.
pub async fn run_hooks(ctx: &HookRunContext, phase: HookPhase, executor: &HookExecutor) {
    run_hooks_with_env(ctx, phase, executor, &SystemEnv).await
}

/// [`run_hooks`] against an explicit environment, which is what `%ENV_VAR%` in a `condition` or
/// `action` resolves through. Tests use it to expand against a fixture environment rather than the
/// process's own.
pub async fn run_hooks_with_env(
    ctx: &HookRunContext,
    phase: HookPhase,
    executor: &HookExecutor,
    env: &impl EnvSource,
) {
    let hooks = matching_hooks(&ctx.project, &ctx.job_type, phase);
    if hooks.is_empty() {
        return;
    }

    let tendril_home = ctx.tendril_home.to_string_lossy().to_string();
    let working_dir = ctx.working_dir();
    let hook_env = ctx.hook_env();

    for hook in hooks {
        if hook.action.trim().is_empty() {
            log_hook(
                ctx,
                hook,
                phase,
                "Skipped: the hook has no action.".to_string(),
                false,
            );
            continue;
        }

        // Expanded here rather than at load time, so an edit to `config.yaml` takes effect on the
        // next job without a restart and the stored config keeps its `%TENDRIL_HOME%` form.
        let condition = expand_variables_with_env(&hook.condition, &tendril_home, env);
        if !condition.trim().is_empty() {
            let verdict = match classify_hook_condition(&condition) {
                HookConditionLanguage::Shell => {
                    let result = executor(HookCommandSpec {
                        hook_name: hook.name.clone(),
                        command: condition.clone(),
                        working_dir: working_dir.clone(),
                        env: hook_env.clone(),
                        timeout: HOOK_CONDITION_TIMEOUT,
                    })
                    .await;

                    if condition_holds(&result) {
                        HookConditionVerdict::Holds
                    } else if result.timed_out || result.spawn_error.is_some() {
                        HookConditionVerdict::Unevaluable(describe_shell_condition_unevaluable(
                            &condition, &result,
                        ))
                    } else {
                        HookConditionVerdict::NotMet(describe_condition_failure(
                            &condition, &result,
                        ))
                    }
                }
                HookConditionLanguage::PowerShell => {
                    match evaluate_powershell_condition(&condition, &working_dir) {
                        Ok(true) => HookConditionVerdict::Holds,
                        Ok(false) => HookConditionVerdict::NotMet(format!(
                            "Condition not met (the PowerShell condition evaluated to false), \
                             skipping.\n\n**Condition:** `{}`",
                            condition
                        )),
                        Err(why) => HookConditionVerdict::Unevaluable(
                            describe_unevaluable_condition(&condition, &why),
                        ),
                    }
                }
                HookConditionLanguage::PowerShellUnsupported(why) => {
                    HookConditionVerdict::Unevaluable(describe_unevaluable_condition(
                        &condition, &why,
                    ))
                }
            };

            match verdict {
                HookConditionVerdict::Holds => {}
                HookConditionVerdict::NotMet(summary) => {
                    log_hook(ctx, hook, phase, summary, false);
                    continue;
                }
                HookConditionVerdict::Unevaluable(summary) => {
                    log_hook(ctx, hook, phase, summary, true);
                    continue;
                }
            }
        }

        let action = expand_variables_with_env(&hook.action, &tendril_home, env);
        let result = executor(HookCommandSpec {
            hook_name: hook.name.clone(),
            command: action.clone(),
            working_dir: working_dir.clone(),
            env: hook_env.clone(),
            timeout: HOOK_ACTION_TIMEOUT,
        })
        .await;

        let failed =
            result.timed_out || result.spawn_error.is_some() || result.exit_code != Some(0);
        log_hook(ctx, hook, phase, describe_action(&action, &result), failed);
    }
}

/// Why the condition genuinely did not hold (a clean run that printed `False` or exited non-zero).
/// Never called for a timeout or spawn error — see [`describe_shell_condition_unevaluable`] — so
/// this text always says "not met", never "could not be evaluated".
fn describe_condition_failure(condition: &str, result: &HookCommandResult) -> String {
    let reason = match result.exit_code {
        Some(0) => "Condition not met (it printed `False`), skipping.".to_string(),
        Some(code) => format!("Condition not met (exit code {}), skipping.", code),
        None => "Condition not met (terminated by a signal), skipping.".to_string(),
    };

    let mut summary = format!("{}\n\n**Condition:** `{}`", reason, condition);
    append_streams(&mut summary, result);
    summary
}

/// Why a shell-executed condition could not be evaluated at all (timed out or failed to spawn).
/// Distinct wording from [`describe_condition_failure`] so it is never confused with an honest
/// `False`, the same rule [`describe_unevaluable_condition`] applies to the PowerShell path.
fn describe_shell_condition_unevaluable(condition: &str, result: &HookCommandResult) -> String {
    let why = if result.timed_out {
        format!(
            "the condition timed out after {}s and was terminated",
            HOOK_CONDITION_TIMEOUT.as_secs()
        )
    } else {
        format!(
            "could not spawn the condition ({})",
            result.spawn_error.as_deref().unwrap_or("unknown error")
        )
    };

    let mut summary = describe_unevaluable_condition(condition, &why);
    append_streams(&mut summary, result);
    summary
}

/// Why a condition could not be evaluated at all — distinct wording from
/// [`describe_condition_failure`] so it is never confused with an honest `False`.
fn describe_unevaluable_condition(condition: &str, why: &str) -> String {
    format!(
        "Condition could not be evaluated: {}.\nThe action was NOT run. Hook conditions support \
         $true/$false, Test-Path \"<path>\", -and and -or.\nRewrite the condition in that subset, \
         or as a POSIX shell command.\n\n**Condition:** `{}`",
        why, condition
    )
}

fn describe_action(action: &str, result: &HookCommandResult) -> String {
    let outcome = if result.timed_out {
        format!(
            "Timed out after {}s and was terminated.",
            HOOK_ACTION_TIMEOUT.as_secs()
        )
    } else if let Some(err) = &result.spawn_error {
        format!("Could not spawn: {}", err)
    } else {
        match result.exit_code {
            Some(0) => "Completed with exit code 0.".to_string(),
            Some(code) => format!("Failed with exit code {}.", code),
            None => "Terminated by a signal.".to_string(),
        }
    };

    let action_failed = result.spawn_error.is_some() || !matches!(result.exit_code, Some(0));
    let mut summary = format!("{}\n\n**Command:** `{}`", outcome, action);
    if action_failed && looks_like_inline_powershell(action) {
        summary.push_str(
            "\n\nThe action looks like inline PowerShell; hooks run through the platform shell, \
             so wrap it as: `pwsh -NoProfile -NonInteractive -Command '",
        );
        summary.push_str(action);
        summary.push_str("'`");
    }
    append_streams(&mut summary, result);
    summary
}

/// Whether `action` matches the `Verb-Noun` cmdlet shape [`classify_hook_condition`] treats as a
/// PowerShell marker. Used only to append a diagnostic hint when the action fails — an action that
/// invokes `pwsh` explicitly (the documented pattern) never matches this and runs unaffected.
fn looks_like_inline_powershell(action: &str) -> bool {
    crate::jobs::hook_condition::matches_powershell_cmdlet(action)
}

fn append_streams(summary: &mut String, result: &HookCommandResult) {
    if !result.stdout.trim().is_empty() {
        summary.push_str(&format!(
            "\n\n**stdout:**\n```\n{}\n```",
            result.stdout.trim()
        ));
    }
    if !result.stderr.trim().is_empty() {
        summary.push_str(&format!(
            "\n\n**stderr:**\n```\n{}\n```",
            result.stderr.trim()
        ));
    }
}

/// Appends one hook outcome to the job's own log, which is what `tendril job log` and the Jobs UI
/// read, and mirrors it to `tracing`. A logging failure is itself only warned about.
fn log_hook(
    ctx: &HookRunContext,
    hook: &PromptwareHookConfig,
    phase: HookPhase,
    summary: String,
    failed: bool,
) {
    let action = format!("hook:{} ({})", hook.name, phase.as_str());

    if failed {
        tracing::warn!("job {}: {} — {}", ctx.job_id, action, summary);
    } else {
        tracing::info!("job {}: {} — {}", ctx.job_id, action, summary);
    }

    if let Err(e) = append_agent_log(&ctx.tendril_home, &ctx.job_id, &action, Some(&summary)) {
        tracing::warn!(
            "Failed to log hook '{}' for job {}: {}",
            hook.name,
            ctx.job_id,
            e
        );
    }
}

/// The executor used in production: runs the command through the platform shell, the same shape as
/// the review-action executor in `tendril-server`.
pub fn shell_hook_executor() -> HookExecutor {
    Arc::new(|spec: HookCommandSpec| Box::pin(run_shell_hook(spec)) as HookFuture)
}

async fn run_shell_hook(spec: HookCommandSpec) -> HookCommandResult {
    let mut cmd = if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", &spec.command]);
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", &spec.command]);
        c
    };

    if spec.working_dir.is_dir() {
        cmd.current_dir(&spec.working_dir);
    }
    for (key, value) in &spec.env {
        cmd.env(key, value);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return HookCommandResult {
                spawn_error: Some(e.to_string()),
                ..Default::default()
            };
        }
    };

    // Both streams are drained by their own task, started before the wait: reading one to EOF first
    // deadlocks as soon as the child floods the other pipe, and a blocking read would make the
    // timeout below dead code.
    let stdout = child.stdout.take().map(|s| tokio::spawn(drain(s)));
    let stderr = child.stderr.take().map(|s| tokio::spawn(drain(s)));

    let pid = child.id().unwrap_or(0);
    let (exit_code, timed_out) = match tokio::time::timeout(spec.timeout, child.wait()).await {
        Ok(Ok(status)) => (status.code(), false),
        Ok(Err(e)) => {
            return HookCommandResult {
                spawn_error: Some(e.to_string()),
                ..Default::default()
            };
        }
        Err(_) => {
            // The hook's own children die with it, or the drain tasks below never see EOF.
            let _ = tokio::task::spawn_blocking(move || kill_tree(pid, DEFAULT_KILL_GRACE)).await;
            let _ = child.wait().await;
            (None, true)
        }
    };

    let stdout = match stdout {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    let stderr = match stderr {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };

    HookCommandResult {
        exit_code,
        stdout,
        stderr,
        timed_out,
        spawn_error: None,
    }
}

/// Reads a stream to EOF, keeping at most [`HOOK_OUTPUT_LIMIT`] bytes but still draining the rest so
/// the child is never blocked on a full pipe.
async fn drain<R>(mut reader: R) -> String
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;

    let mut kept: Vec<u8> = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if kept.len() < HOOK_OUTPUT_LIMIT {
                    let room = HOOK_OUTPUT_LIMIT - kept.len();
                    kept.extend_from_slice(&buf[..n.min(room)]);
                }
            }
        }
    }

    String::from_utf8_lossy(&kept).to_string()
}
