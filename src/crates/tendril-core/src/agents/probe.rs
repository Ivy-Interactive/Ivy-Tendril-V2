//! One-off probes against a coding agent: is its CLI installed, is it authenticated, and will the
//! provider actually serve a given model.
//!
//! This is the daemon half of V1's **Test Agent** dialog
//! (`Apps/Settings/Dialogs/AgentTestDialog.cs`), which drives `IAgentHealthCheck` per agent:
//! `CheckInstallAsync`, then `CheckAuthAsync`, then one `ValidateModelAsync` per configured profile
//! model. Every argv, timeout and string match below is that interface's per-provider implementation
//! ported verbatim — see the per-function docs for which file each came from.
//!
//! Deliberately **not** part of [`crate::health`]. `agent_model_checks` promises to stay
//! "synchronous and offline" because `tendril doctor` must not spend a minute shelling out to six
//! CLIs; these probes are the opposite contract — they launch real processes, spend real quota and
//! are only ever reached from an explicit operator action.
//!
//! The bring-your-own-LLM agents (`ivy`, `openaiproxy`) take a different path entirely: they have no
//! CLI of their own to interrogate, so their auth and model checks reuse onboarding's
//! [`crate::agents::provider_models::test_model_prompt`] — the same five-token `ping` the Coding
//! Agent pane's "Fetch models" button falls back to.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::agents::provider_models::{test_model_prompt, ModelValidation, ModelValidationStatus};
use crate::agents::providers::{resolve_copilot_binary, resolve_opencode_binary};
use crate::agents::resolution::normalize_agent_name;
use crate::config::dirs_home;
use crate::jobs::process_tree::{kill_tree, DEFAULT_KILL_GRACE};
use crate::tunnel::installer::find_on_path;

// ---------------------------------------------------------------------------
// Provider error classification — V1 `Runtime/ProviderErrorClassifier`
// ---------------------------------------------------------------------------

/// The two provider-level walls that stop an agent before it does any work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderErrorKind {
    None,
    /// Quota exhausted or rate limited. Clears by itself, so it is worth retrying.
    Quota,
    /// Authentication failed. Will not clear on its own.
    Auth,
}

/// V1 `ProviderErrorClassifier.QuotaTerms`.
const QUOTA_TERMS: &[&str] = &[
    "quota",
    "rate limit",
    "429",
    "too many requests",
    "resource_exhausted",
];

/// V1 `ProviderErrorClassifier.AuthTerms`.
const AUTH_TERMS: &[&str] = &[
    "not logged in",
    "you are not logged into",
    "oauth",
    "unauthorized",
    "401",
    "403",
    "authentication",
    "unauthenticated",
];

/// gRPC/Google-style status names a provider puts in front of its message. Matched before the
/// numeric form so `RESOURCE_EXHAUSTED (code 429)` reports the more specific name.
static SYMBOLIC_CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\b(RESOURCE_EXHAUSTED|PERMISSION_DENIED|UNAUTHENTICATED|DEADLINE_EXCEEDED|UNAVAILABLE|INVALID_ARGUMENT|NOT_FOUND|FAILED_PRECONDITION)\b",
    )
    .expect("symbolic provider code pattern is valid")
});

/// Only the HTTP statuses a provider failure actually reports, rather than any three-digit number:
/// an unconstrained pattern happily reads "attempt 429" out of prose that is not a code.
static NUMERIC_CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(400|401|402|403|404|408|409|422|429|500|502|503|504)\b")
        .expect("numeric provider code pattern is valid")
});

/// Which wall, if either, a provider message describes.
///
/// Quota is checked first, which is V1's order and its reason: "a 429 that also mentions oauth is a
/// quota wall, and retrying is the right advice for it."
pub fn classify_provider_error(text: Option<&str>) -> ProviderErrorKind {
    let Some(text) = text else {
        return ProviderErrorKind::None;
    };
    if text.trim().is_empty() {
        return ProviderErrorKind::None;
    }
    let lower = text.to_ascii_lowercase();
    if QUOTA_TERMS.iter().any(|term| lower.contains(term)) {
        return ProviderErrorKind::Quota;
    }
    if AUTH_TERMS.iter().any(|term| lower.contains(term)) {
        return ProviderErrorKind::Auth;
    }
    ProviderErrorKind::None
}

/// The provider's own error code out of a message, e.g. `RESOURCE_EXHAUSTED` or `429`.
pub fn extract_provider_code(text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    if let Some(found) = SYMBOLIC_CODE.find(text) {
        return Some(found.as_str().to_string());
    }
    NUMERIC_CODE.find(text).map(|m| m.as_str().to_string())
}

/// A quota wall clears by itself; an auth failure will not.
pub fn is_retryable(kind: ProviderErrorKind) -> bool {
    kind == ProviderErrorKind::Quota
}

/// Human-readable name of the condition, for the message shown on a failed probe.
pub fn describe_provider_error(kind: ProviderErrorKind) -> &'static str {
    match kind {
        ProviderErrorKind::Quota => "provider quota exhausted",
        ProviderErrorKind::Auth => "provider authentication failed",
        ProviderErrorKind::None => "provider error",
    }
}

// ---------------------------------------------------------------------------
// The process runner — V1 `Helpers/HealthCheckRunner`
// ---------------------------------------------------------------------------

/// What V1's runner puts on stderr when it kills a probe for running long. Several checks read this
/// exact sentinel as a *result* rather than a failure — Codex treats a five-second timeout as proof
/// the model was accepted — so it is a constant rather than a literal spelled in each of them.
pub const TIMED_OUT: &str = "Timed out";

/// How long output draining is given after a kill, so a wedged pipe cannot hang a probe.
const POST_KILL_TIMEOUT: Duration = Duration::from_secs(5);

/// One probe's process outcome. `exit_code` is `-1` for "never ran, or was killed", which is the
/// convention every classifier below reads together with `stderr`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl ProbeOutput {
    /// Whether this is the killed-for-time case: V1's `(-1, partial stdout, "Timed out")`.
    pub fn timed_out(&self) -> bool {
        self.exit_code == -1 && self.stderr.trim().eq_ignore_ascii_case(TIMED_OUT)
    }

    /// `stdout` and `stderr` as one haystack, which is what V1's substring matches run against.
    fn combined(&self) -> String {
        format!("{}\n{}", self.stdout, self.stderr)
    }
}

/// Runs `command` with `args` under a deadline, returning its output.
///
/// V1's contract, kept exactly:
///
/// * `CI=true` and `TERM=dumb` are always set, so a CLI that would otherwise draw a spinner or open
///   a pager prints plain text and exits.
/// * stdin is closed immediately. Codex's `exec -` reads stdin and would otherwise block forever;
///   every other probe simply must not be able to ask a question.
/// * On the deadline the whole process **tree** is killed — agents shell out freely, so killing the
///   direct child alone leaves grandchildren spending tokens — and the call returns
///   `(-1, whatever stdout arrived, "Timed out")`.
pub async fn run_probe(command: &str, args: &[String], timeout: Duration) -> ProbeOutput {
    let failed_to_start = |err: std::io::Error| ProbeOutput {
        exit_code: -1,
        stdout: String::new(),
        stderr: format!("Failed to start process: {err}"),
    };

    let mut cmd = Command::new(command);
    cmd.args(args)
        .env("CI", "true")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Its own process group, for the same reason `agents::runner` does it: `kill_tree` signals the
    // negated pid, and that only reaches grandchildren when the child leads a group.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.as_std_mut().process_group(0);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => return failed_to_start(err),
    };
    let pid = child.id().unwrap_or(0);

    // Drained on their own tasks rather than after the wait: a probe that fills the 64KiB pipe
    // buffer would otherwise block on write while we block on exit.
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).to_string()
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).to_string()
    });

    let collect = |task: tokio::task::JoinHandle<String>| async move {
        match tokio::time::timeout(POST_KILL_TIMEOUT, task).await {
            Ok(Ok(text)) => text.trim().to_string(),
            _ => String::new(),
        }
    };

    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => ProbeOutput {
            exit_code: status.code().unwrap_or(-1),
            stdout: collect(stdout_task).await,
            stderr: collect(stderr_task).await,
        },
        Ok(Err(err)) => failed_to_start(err),
        Err(_) => {
            if pid != 0 {
                let _ =
                    tokio::task::spawn_blocking(move || kill_tree(pid, DEFAULT_KILL_GRACE)).await;
            }
            let _ = child.kill().await;
            ProbeOutput {
                exit_code: -1,
                // Partial output is kept: a CLI that printed its complaint and then hung is still
                // telling us what went wrong.
                stdout: collect(stdout_task).await,
                stderr: TIMED_OUT.to_string(),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Result shapes — V1 `Abstractions/AgentTypes`
// ---------------------------------------------------------------------------

/// V1 `AgentInstallStatus`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallStatus {
    pub is_installed: bool,
    pub version: Option<String>,
    pub binary_path: Option<String>,
    pub error: Option<String>,
}

/// V1 `AuthStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthStatus {
    Authenticated,
    NotAuthenticated,
    /// The check itself failed — the CLI errored for a reason that is not "you are signed out".
    CheckFailed,
    /// No answer either way, e.g. the probe timed out.
    Unknown,
}

/// V1 `AgentAuthResult`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthResult {
    pub status: AuthStatus,
    /// Which backend the credential is for (`bedrock`, `vertex`, `anthropic-api`).
    pub provider: Option<String>,
    /// How the credential is held (`oauth`, `api-key`, `auth-file`, `environment`).
    pub auth_method: Option<String>,
    pub error: Option<String>,
    pub sign_in_hint: Option<String>,
}

impl AgentAuthResult {
    fn authenticated() -> Self {
        Self {
            status: AuthStatus::Authenticated,
            provider: None,
            auth_method: None,
            error: None,
            sign_in_hint: None,
        }
    }

    fn with_method(mut self, method: &str) -> Self {
        self.auth_method = Some(method.to_string());
        self
    }

    fn with_provider(mut self, provider: Option<String>) -> Self {
        self.provider = provider;
        self
    }

    fn failed(status: AuthStatus, error: impl Into<String>, hint: Option<&str>) -> Self {
        Self {
            status,
            provider: None,
            auth_method: None,
            error: Some(error.into()),
            sign_in_hint: hint.map(str::to_string),
        }
    }
}

/// The credentials a bring-your-own-LLM agent is probed with. Read from `config.yaml` by the route,
/// never by this module: the key belongs to the daemon's settings layer and is passed in so nothing
/// here has to know where it is stored.
#[derive(Debug, Clone, Default)]
pub struct ProbeCredentials {
    pub base_url: String,
    pub api_key: String,
}

/// Whether `agent` is one of the two proxy entries, which have no CLI of their own.
fn is_proxy_agent(agent: &str) -> bool {
    matches!(agent, "ivy" | "openaiproxy" | "proxy")
}

/// The binary a probe launches for `agent`, and the arguments that must come before its own.
///
/// `copilot` is the reason this returns a pair: with no `copilot` on PATH it is reached as
/// `gh copilot`, and every probe's argv has to carry that prefix. The two resolvers come from
/// `providers.rs` rather than being re-derived, so a probe always talks to the binary a launch would.
fn probe_binary(agent: &str) -> (String, Vec<String>) {
    match agent {
        "copilot" => resolve_copilot_binary(),
        "opencode" => (resolve_opencode_binary(), vec![]),
        // Both proxy entries are driven through OpenCode in this build, where V1 had its own
        // `ivy-agent` CLI. There is no separate binary to find.
        agent if is_proxy_agent(agent) => (resolve_opencode_binary(), vec![]),
        "antigravity" | "agy" => ("agy".to_string(), vec![]),
        other => (other.to_string(), vec![]),
    }
}

fn argv(prefix: &[String], rest: &[&str]) -> Vec<String> {
    let mut args = prefix.to_vec();
    args.extend(rest.iter().map(|arg| arg.to_string()));
    args
}

/// `default`, blank, or absent all mean "whatever the CLI picks", so none of them may be passed
/// through as a model id — that would be a request for a model that does not exist.
fn explicit_model(model: &str) -> Option<&str> {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("default") {
        None
    } else {
        Some(trimmed)
    }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/// Whether `agent`'s CLI is on this machine, and at what version.
///
/// Every V1 health check opens with the same two steps — resolve the binary, then ask it for its
/// version — and reports the binary's absence as the error rather than running anything else.
pub async fn check_install(agent: &str) -> AgentInstallStatus {
    let agent = normalize_agent_name(agent);
    let (binary, prefix) = probe_binary(&agent);

    let resolved: Option<PathBuf> = if Path::new(&binary).is_absolute() {
        Path::new(&binary).is_file().then(|| PathBuf::from(&binary))
    } else {
        find_on_path(&binary)
    };

    let Some(path) = resolved else {
        return AgentInstallStatus {
            is_installed: false,
            version: None,
            binary_path: None,
            error: Some(match agent.as_str() {
                "copilot" => "copilot (or gh) not found on PATH".to_string(),
                agent if is_proxy_agent(agent) => "opencode not found".to_string(),
                other => format!("{other} not found on PATH"),
            }),
        };
    };

    AgentInstallStatus {
        is_installed: true,
        version: probe_agent_version(&agent, &binary, &prefix).await,
        binary_path: Some(path.to_string_lossy().to_string()),
        error: None,
    }
}

/// A three-part semantic version anywhere in the output.
static SEMVER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d+\.\d+\.\d+").expect("semver pattern is valid"));

/// `<binary> --version`, at V1's ten-second budget.
///
/// Claude, Codex and Copilot pull a `\d+\.\d+\.\d+` out of the line and fall back to the whole
/// trimmed stdout; Gemini, OpenCode, Antigravity and the proxies report the whole line as-is,
/// because their CLIs print a version string a semver pattern would truncate.
async fn probe_agent_version(agent: &str, binary: &str, prefix: &[String]) -> Option<String> {
    let out = run_probe(
        binary,
        &argv(prefix, &["--version"]),
        Duration::from_secs(10),
    )
    .await;
    if out.exit_code != 0 {
        return None;
    }
    let trimmed = out.stdout.trim().to_string();
    if matches!(agent, "claude" | "codex" | "copilot") {
        if let Some(found) = SEMVER.find(&trimmed) {
            return Some(found.as_str().to_string());
        }
    }
    (!trimmed.is_empty()).then_some(trimmed)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/// Whether `agent` holds a usable credential.
///
/// Each arm is one V1 `CheckAuthAsync`. They are deliberately unalike: two of them never launch a
/// process at all when a credential file answers the question, because the CLIs they would launch
/// reach the OS keychain and can block on a prompt in a non-interactive context.
pub async fn check_auth(agent: &str, creds: &ProbeCredentials) -> AgentAuthResult {
    match normalize_agent_name(agent).as_str() {
        "claude" => claude_auth().await,
        "codex" => codex_auth().await,
        "gemini" => gemini_auth().await,
        "copilot" => copilot_auth().await,
        "antigravity" | "agy" => antigravity_auth().await,
        "opencode" => opencode_auth().await,
        other if is_proxy_agent(other) => proxy_auth(creds).await,
        other => AgentAuthResult::failed(
            AuthStatus::Unknown,
            format!("No authentication probe is defined for '{other}'"),
            None,
        ),
    }
}

/// V1 `ClaudeHealthCheck.CheckAuthAsync`: the only honest test is a real one-turn prompt.
async fn claude_auth() -> AgentAuthResult {
    let out = run_probe(
        "claude",
        &argv(&[], &["-p", "ping", "--max-turns", "1"]),
        Duration::from_secs(30),
    )
    .await;

    let provider = claude_provider();
    if out.exit_code == 0 {
        return AgentAuthResult::authenticated().with_provider(provider);
    }

    let lower = out.stderr.to_ascii_lowercase();
    if lower.contains("auth") || lower.contains("login") || lower.contains("sign in") {
        return AgentAuthResult::failed(
            AuthStatus::NotAuthenticated,
            out.stderr,
            Some("Run 'claude login' to authenticate"),
        )
        .with_provider(provider);
    }

    AgentAuthResult::failed(AuthStatus::CheckFailed, out.stderr, None).with_provider(provider)
}

/// V1 `ClaudeHealthCheck.DetectProvider`: which backend the CLI is pointed at, read off the
/// environment rather than asked for.
fn claude_provider() -> Option<String> {
    let set = |name: &str| std::env::var(name).is_ok_and(|value| !value.is_empty());
    if set("CLAUDE_CODE_USE_BEDROCK") || set("AWS_BEARER_TOKEN_BEDROCK") {
        return Some("bedrock".to_string());
    }
    if set("CLAUDE_CODE_USE_VERTEX") || set("CLOUD_ML_REGION") {
        return Some("vertex".to_string());
    }
    if set("ANTHROPIC_API_KEY") {
        return Some("anthropic-api".to_string());
    }
    None
}

/// V1 `CodexHealthCheck.CheckAuthAsync`.
async fn codex_auth() -> AgentAuthResult {
    let out = run_probe(
        "codex",
        &argv(&[], &["login", "status"]),
        Duration::from_secs(15),
    )
    .await;

    if out.exit_code == 0 {
        return AgentAuthResult::authenticated();
    }

    let lower = out.stderr.to_ascii_lowercase();
    if lower.contains("auth")
        || lower.contains("login")
        || lower.contains("not logged in")
        || lower.contains("unauthorized")
    {
        return AgentAuthResult::failed(
            AuthStatus::NotAuthenticated,
            out.stderr,
            Some("Run 'codex login' to authenticate"),
        );
    }

    AgentAuthResult::failed(AuthStatus::CheckFailed, out.stderr, None)
}

/// V1 `GeminiHealthCheck.CheckAuthAsync`: environment first, then the credential files the CLI
/// writes, and only then a real prompt.
///
/// The file cascade is not an optimisation. `gemini -p ping` at thirty seconds is the slowest probe
/// here, and the files answer the same question in microseconds for the common case.
async fn gemini_auth() -> AgentAuthResult {
    let api_key = std::env::var("GOOGLE_API_KEY")
        .ok()
        .filter(|key| !key.is_empty())
        .or_else(|| {
            std::env::var("GEMINI_API_KEY")
                .ok()
                .filter(|key| !key.is_empty())
        });
    if api_key.is_some() {
        return AgentAuthResult::authenticated().with_method("api-key");
    }

    if let Some(home) = dirs_home() {
        for path in gemini_credential_candidates(Path::new(&home)) {
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            if content.is_empty() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            match name {
                "oauth_creds.json" => {
                    return AgentAuthResult::authenticated().with_method("oauth");
                }
                "google_accounts.json" if has_active_account(&content) => {
                    return AgentAuthResult::authenticated().with_method("oauth");
                }
                // Skipped under a test runner, as in V1: a developer's real `settings.json` would
                // otherwise make the suite's answer depend on their machine.
                "settings.json"
                    if std::env::var("IVY_TEST_RUNNER").is_err()
                        && settings_names_a_credential(&content) =>
                {
                    return AgentAuthResult::authenticated().with_method("api-key");
                }
                "config.json" if content.len() > 2 && content.contains('{') => {
                    return AgentAuthResult::authenticated().with_method("oauth");
                }
                _ => {}
            }
        }
    }

    let out = run_probe(
        "gemini",
        &argv(&[], &["-p", "ping"]),
        Duration::from_secs(30),
    )
    .await;
    if out.exit_code == 0 {
        return AgentAuthResult::authenticated().with_method("oauth");
    }
    if out.timed_out() {
        return AgentAuthResult::failed(AuthStatus::Unknown, "Gemini auth check timed out", None);
    }

    AgentAuthResult::failed(
        AuthStatus::NotAuthenticated,
        "OAuth credentials not found and no API key set",
        Some("Run 'gemini auth' or set GEMINI_API_KEY"),
    )
}

/// V1 `GeminiHealthCheck.GetCredentialCandidates`, in its order.
fn gemini_credential_candidates(home: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for file in ["oauth_creds.json", "google_accounts.json", "settings.json"] {
        candidates.push(home.join(".gemini").join(file));
        candidates.push(home.join(".gemini").join("config").join(file));
    }
    candidates.push(home.join(".gemini").join("config").join("config.json"));
    candidates
}

static ACTIVE_ACCOUNT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)"active"\s*:\s*"([^"]+)""#).expect("active-account pattern is valid")
});

/// V1 `IsActiveAccountAuthenticated`: a `google_accounts.json` naming a non-empty active account.
fn has_active_account(content: &str) -> bool {
    ACTIVE_ACCOUNT
        .captures(content)
        .and_then(|caps| caps.get(1))
        .is_some_and(|account| !account.as_str().trim().is_empty())
}

/// V1 `IsApiKeyConfiguredInSettings`.
fn settings_names_a_credential(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("\"selectedtype\"")
        && (lower.contains("gemini-api-key") || lower.contains("oauth"))
}

/// V1 `CopilotHealthCheck.CheckAuthAsync`.
async fn copilot_auth() -> AgentAuthResult {
    let (binary, prefix) = resolve_copilot_binary();
    let out = run_probe(
        &binary,
        &argv(
            &prefix,
            &[
                "-p",
                "ping",
                "--allow-all-paths",
                "--allow-all-urls",
                "--allow-all-tools",
                "-s",
            ],
        ),
        Duration::from_secs(30),
    )
    .await;

    if out.exit_code == 0 {
        return AgentAuthResult::authenticated();
    }

    let lower = out.stderr.to_ascii_lowercase();
    if lower.contains("auth") || lower.contains("login") || lower.contains("sign in") {
        return AgentAuthResult::failed(
            AuthStatus::NotAuthenticated,
            out.stderr,
            Some("Run 'copilot login' or 'gh auth login' to authenticate"),
        );
    }

    AgentAuthResult::failed(AuthStatus::CheckFailed, out.stderr, None)
}

/// V1 `AntigravityHealthCheck.CheckAuthAsync`: a three-second `agy models`, then the onboarding
/// state file.
///
/// Three seconds, not thirty, and with a file fallback, because `agy` reaches the OS keychain: in a
/// non-interactive or locked-screen context that call can block or prompt, and the state file
/// answers the same question without touching it.
async fn antigravity_auth() -> AgentAuthResult {
    let out = run_probe("agy", &argv(&[], &["models"]), Duration::from_secs(3)).await;
    if out.exit_code == 0 {
        return AgentAuthResult::authenticated().with_method("oauth");
    }

    if let Some(home) = dirs_home() {
        let state = Path::new(&home)
            .join(".gemini")
            .join("antigravity")
            .join("antigravity_state.pbtxt");
        if let Ok(content) = std::fs::read_to_string(state) {
            if content
                .to_ascii_lowercase()
                .contains("agent_onboarding_state_completed")
            {
                return AgentAuthResult::authenticated().with_method("oauth");
            }
        }
    }

    AgentAuthResult::failed(
        AuthStatus::NotAuthenticated,
        if out.stderr.trim().is_empty() {
            "Not authenticated".to_string()
        } else {
            out.stderr
        },
        Some("Run 'agy' and complete the browser-based auth flow"),
    )
}

/// V1 `OpenCodeHealthCheck.CheckAuthAsync`: the credential file first, then the CLI's own count.
async fn opencode_auth() -> AgentAuthResult {
    if let Some(path) = opencode_auth_file() {
        if std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) >= 2 {
            return AgentAuthResult::authenticated().with_method("auth-file");
        }
    }

    let binary = resolve_opencode_binary();
    // `providers` is the command in current builds and `auth` its alias, so `auth list` keeps
    // working and keeps V1's argv.
    let out = run_probe(
        &binary,
        &argv(&[], &["auth", "list"]),
        Duration::from_secs(15),
    )
    .await;

    if out.exit_code != 0 {
        return AgentAuthResult::failed(
            AuthStatus::Unknown,
            format!("Failed to check OpenCode credentials: {}", out.stderr),
            Some("Run 'opencode providers login' to authenticate"),
        );
    }

    match parse_opencode_auth_list(&out.stdout) {
        Some(method) => AgentAuthResult::authenticated().with_method(method),
        None => AgentAuthResult::failed(
            AuthStatus::NotAuthenticated,
            "No OpenCode credentials configured (auth.json empty and no provider environment variables)",
            Some("Run 'opencode providers login' to authenticate"),
        ),
    }
}

/// Where OpenCode keeps its credentials. V1 checks the XDG path first and falls back to `%AppData%`
/// on Windows.
fn opencode_auth_file() -> Option<PathBuf> {
    let home = dirs_home()?;
    let xdg = Path::new(&home)
        .join(".local")
        .join("share")
        .join("opencode")
        .join("auth.json");
    if xdg.is_file() {
        return Some(xdg);
    }
    if cfg!(windows) {
        if let Ok(app_data) = std::env::var("AppData") {
            let path = Path::new(&app_data).join("opencode").join("auth.json");
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

static OPENCODE_FILE_CREDS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(\d+)\s+credentials?").expect("credential count is valid"));
static OPENCODE_ENV_CREDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(\d+)\s+environment\s+variables?").expect("env count is valid")
});
static ANSI_ESCAPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*m").expect("ANSI pattern is valid"));

/// V1 `OpenCodeHealthCheck.ParseAuthList`: the credential counts out of a coloured table.
///
/// `Some(method)` when either count is above zero, environment taking precedence as it does in V1.
fn parse_opencode_auth_list(stdout: &str) -> Option<&'static str> {
    let cleaned = ANSI_ESCAPE.replace_all(stdout, "");
    let count = |pattern: &Regex| -> u32 {
        pattern
            .captures(&cleaned)
            .and_then(|caps| caps.get(1))
            .and_then(|digits| digits.as_str().parse().ok())
            .unwrap_or(0)
    };

    if count(&OPENCODE_ENV_CREDS) > 0 {
        return Some("environment");
    }
    if count(&OPENCODE_FILE_CREDS) > 0 {
        return Some("auth-file");
    }
    None
}

/// V1 `OpenAiProxyHealthCheck.CheckAuthAsync`, over onboarding's tester rather than a CLI.
///
/// This is the reuse the Coding Agent pane's "Fetch models" button already relies on: a proxy has no
/// binary that knows whether its key is good, so the only test is a real five-token completion, and
/// [`test_model_prompt`] is the one that already exists for exactly that.
async fn proxy_auth(creds: &ProbeCredentials) -> AgentAuthResult {
    if creds.base_url.trim().is_empty() {
        return AgentAuthResult::failed(
            AuthStatus::NotAuthenticated,
            "Base URL is not configured.",
            Some("Specify the API Base URL under Settings -> Coding Agent."),
        );
    }
    if creds.api_key.trim().is_empty() {
        return AgentAuthResult::failed(
            AuthStatus::NotAuthenticated,
            "API Key is not configured.",
            Some("Specify an API Key under Settings -> Coding Agent."),
        );
    }

    let result = test_model_prompt(&creds.base_url, &creds.api_key, "default").await;
    match result.status {
        ModelValidationStatus::AuthError => AgentAuthResult::failed(
            AuthStatus::NotAuthenticated,
            result
                .error_message
                .unwrap_or_else(|| "Invalid API key.".to_string()),
            Some("Please check your API key in Settings -> Coding Agent."),
        ),
        ModelValidationStatus::Unknown
            if result
                .error_message
                .as_deref()
                .is_some_and(|message| message.to_ascii_lowercase().contains("connect")) =>
        {
            AgentAuthResult::failed(
                AuthStatus::CheckFailed,
                result.error_message.unwrap_or_default(),
                Some("Please check your API Base URL and network connection."),
            )
        }
        _ => AgentAuthResult::authenticated().with_method("api-key"),
    }
}

// ---------------------------------------------------------------------------
// Model validation
// ---------------------------------------------------------------------------

fn validation(
    status: ModelValidationStatus,
    model: &str,
    error: Option<String>,
) -> ModelValidation {
    ModelValidation {
        status,
        model: model.to_string(),
        error_message: error,
    }
}

/// Whether the provider will actually serve `model` for `agent`.
///
/// One V1 `ValidateModelAsync` per arm. They differ far more than the auth checks do — Codex reads a
/// timeout as success, Gemini refuses to answer at all, OpenCode only answers for its default model
/// — and each difference is the provider's, not a simplification.
pub async fn validate_model(agent: &str, model: &str, creds: &ProbeCredentials) -> ModelValidation {
    match normalize_agent_name(agent).as_str() {
        "claude" => claude_model(model).await,
        "codex" => codex_model(model).await,
        "gemini" => gemini_model(model),
        "copilot" => copilot_model(model).await,
        "antigravity" | "agy" => antigravity_model(model).await,
        "opencode" => opencode_model(model).await,
        other if is_proxy_agent(other) => proxy_model(model, creds).await,
        other => validation(
            ModelValidationStatus::Unknown,
            model,
            Some(format!("No model probe is defined for '{other}'")),
        ),
    }
}

/// V1 `ClaudeHealthCheck.ValidateModelAsync`.
async fn claude_model(model: &str) -> ModelValidation {
    let mut args = vec!["-p".to_string(), "ping".to_string()];
    if let Some(explicit) = explicit_model(model) {
        args.push("--model".to_string());
        args.push(explicit.to_string());
    }
    args.push("--max-turns".to_string());
    args.push("1".to_string());

    let out = run_probe("claude", &args, Duration::from_secs(30)).await;
    classify_claude_model(model, &out)
}

/// V1 `ClaudeHealthCheck.ParseModelValidationResult`, split out for the same reason it is in V1:
/// the classification is where all the behaviour lives, and it is testable without a live CLI.
fn classify_claude_model(model: &str, out: &ProbeOutput) -> ModelValidation {
    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }

    let combined = out.combined();
    let lower = combined.to_ascii_lowercase();

    if lower.contains("data retention mode") {
        return validation(
            ModelValidationStatus::InvalidModel,
            model,
            Some(
                "The selected model requires an AWS Bedrock data retention mode (such as 'aws_review') that is not enabled in your AWS Bedrock account or project."
                    .to_string(),
            ),
        );
    }

    // Quota before anything else, as `ProviderErrorClassifier` does: a 429 naming a model is a wall,
    // not a typo in the model id.
    match classify_provider_error(Some(&combined)) {
        ProviderErrorKind::Quota => {
            return validation(ModelValidationStatus::RateLimit, model, Some(combined));
        }
        ProviderErrorKind::Auth | ProviderErrorKind::None => {}
    }

    if lower.contains("model")
        && [
            "invalid",
            "not found",
            "does not exist",
            "not supported",
            "not available",
        ]
        .iter()
        .any(|term| lower.contains(term))
    {
        return validation(ModelValidationStatus::InvalidModel, model, Some(combined));
    }

    if lower.contains("auth") || lower.contains("permission") || lower.contains("unauthorized") {
        return validation(ModelValidationStatus::AuthError, model, Some(combined));
    }

    validation(
        ModelValidationStatus::Unknown,
        model,
        Some(format!(
            "exit={}\nstdout: {}\nstderr: {}",
            out.exit_code, out.stdout, out.stderr
        )),
    )
}

/// V1 `CodexHealthCheck.ValidateModelAsync`.
///
/// Five seconds, and a timeout means **success**: `codex exec … -` reads the prompt from stdin, so a
/// valid model leaves it waiting there while an invalid one errors immediately. Getting as far as
/// the wait is the answer.
async fn codex_model(model: &str) -> ModelValidation {
    let mut args = vec![
        "exec".to_string(),
        "--full-auto".to_string(),
        "--json".to_string(),
        "--skip-git-repo-check".to_string(),
    ];
    if let Some(explicit) = explicit_model(model) {
        args.push("--model".to_string());
        args.push(explicit.to_string());
    }
    args.push("-".to_string());

    let out = run_probe("codex", &args, Duration::from_secs(5)).await;
    classify_codex_model(model, &out)
}

fn classify_codex_model(model: &str, out: &ProbeOutput) -> ModelValidation {
    if out.timed_out() || out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }

    let combined = out.combined();
    let lower = combined.to_ascii_lowercase();
    let detail = if out.stderr.trim().is_empty() {
        combined.trim().to_string()
    } else {
        out.stderr.clone()
    };

    match classify_provider_error(Some(&combined)) {
        ProviderErrorKind::Quota => {
            return validation(ModelValidationStatus::RateLimit, model, Some(detail));
        }
        ProviderErrorKind::Auth | ProviderErrorKind::None => {}
    }

    if lower.contains("model")
        && ["invalid", "not found", "not supported"]
            .iter()
            .any(|term| lower.contains(term))
    {
        return validation(ModelValidationStatus::InvalidModel, model, Some(detail));
    }
    if lower.contains("auth") || lower.contains("unauthorized") {
        return validation(ModelValidationStatus::AuthError, model, Some(detail));
    }
    validation(ModelValidationStatus::Unknown, model, Some(detail))
}

/// V1 `GeminiHealthCheck.ValidateModelAsync`, which is a hardcoded `Ok` and says why: the Gemini CLI
/// has no lightweight validation, and a full prompt invocation is too slow to be one.
fn gemini_model(model: &str) -> ModelValidation {
    validation(ModelValidationStatus::Ok, model, None)
}

/// V1 `CopilotHealthCheck.ValidateModelAsync`. `--model` goes after the prompt and before the
/// allow-all flags, which is where V1 inserts it.
async fn copilot_model(model: &str) -> ModelValidation {
    let (binary, prefix) = resolve_copilot_binary();
    let mut args = argv(&prefix, &["-p", "ping"]);
    if let Some(explicit) = explicit_model(model) {
        args.push("--model".to_string());
        args.push(explicit.to_string());
    }
    args.extend(
        [
            "--allow-all-paths",
            "--allow-all-urls",
            "--allow-all-tools",
            "-s",
        ]
        .iter()
        .map(|arg| arg.to_string()),
    );

    let out = run_probe(&binary, &args, Duration::from_secs(30)).await;
    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }

    let lower = out.stderr.to_ascii_lowercase();
    match classify_provider_error(Some(&out.stderr)) {
        ProviderErrorKind::Quota => {
            return validation(
                ModelValidationStatus::RateLimit,
                model,
                Some(out.stderr.clone()),
            );
        }
        ProviderErrorKind::Auth | ProviderErrorKind::None => {}
    }
    if lower.contains("model")
        && ["invalid", "not found", "does not exist", "not available"]
            .iter()
            .any(|term| lower.contains(term))
    {
        return validation(ModelValidationStatus::InvalidModel, model, Some(out.stderr));
    }
    if lower.contains("auth") {
        return validation(ModelValidationStatus::AuthError, model, Some(out.stderr));
    }
    validation(ModelValidationStatus::Unknown, model, Some(out.stderr))
}

/// V1 `AntigravityHealthCheck.ValidateModelAsync`.
///
/// A non-default model is probed for real rather than waved through. V1's comment on why is worth
/// keeping: the short-circuit it replaced "is why `tendril doctor` reported a healthy Antigravity
/// while every job launched against it died on an exhausted quota."
async fn antigravity_model(model: &str) -> ModelValidation {
    let mut args = vec![
        "--dangerously-skip-permissions".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--print-timeout".to_string(),
        "30s".to_string(),
    ];
    if let Some(explicit) = explicit_model(model) {
        args.push("--model".to_string());
        args.push(explicit.to_string());
        args.push("--effort".to_string());
        args.push("medium".to_string());
    }
    args.push("--print".to_string());
    args.push("reply with the single word OK".to_string());

    let out = run_probe("agy", &args, Duration::from_secs(30)).await;
    classify_antigravity_model(model, &out)
}

fn classify_antigravity_model(model: &str, out: &ProbeOutput) -> ModelValidation {
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }

    let combined = out.combined();
    let detail = [out.stderr.as_str(), out.stdout.as_str()]
        .into_iter()
        .map(str::trim)
        .find(|text| !text.is_empty())
        .map(str::to_string);

    match classify_provider_error(Some(&combined)) {
        ProviderErrorKind::Quota => {
            return validation(ModelValidationStatus::RateLimit, model, detail);
        }
        ProviderErrorKind::Auth => {
            return validation(ModelValidationStatus::AuthError, model, detail);
        }
        ProviderErrorKind::None => {}
    }

    let lower = combined.to_ascii_lowercase();
    if [
        "unknown model",
        "invalid model",
        "model not found",
        "unsupported model",
    ]
    .iter()
    .any(|term| lower.contains(term))
    {
        return validation(ModelValidationStatus::InvalidModel, model, detail);
    }

    // A clean exit still means the CLI did the work, even when it printed nothing this parser
    // recognises.
    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }

    validation(ModelValidationStatus::Unknown, model, detail)
}

/// V1 `OpenCodeHealthCheck.ValidateModelAsync`: only the default model can be validated, and the
/// refusal says so rather than pretending the model is fine.
async fn opencode_model(model: &str) -> ModelValidation {
    if explicit_model(model).is_some() {
        return validation(
            ModelValidationStatus::Unknown,
            model,
            Some("OpenCode does not support model validation for non-default models".to_string()),
        );
    }

    let binary = resolve_opencode_binary();
    let out = run_probe(
        &binary,
        &argv(&[], &["run", "ping"]),
        Duration::from_secs(30),
    )
    .await;
    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }
    match classify_provider_error(Some(&out.combined())) {
        ProviderErrorKind::Quota => validation(
            ModelValidationStatus::RateLimit,
            model,
            Some(out.stderr.clone()),
        ),
        _ => validation(ModelValidationStatus::Unknown, model, Some(out.stderr)),
    }
}

/// V1 `OpenAiProxyHealthCheck.ValidateModelAsync`, over onboarding's tester.
async fn proxy_model(model: &str, creds: &ProbeCredentials) -> ModelValidation {
    if creds.base_url.trim().is_empty() || creds.api_key.trim().is_empty() {
        return validation(
            ModelValidationStatus::AuthError,
            model,
            Some("Base URL or API key not configured.".to_string()),
        );
    }
    test_model_prompt(&creds.base_url, &creds.api_key, model).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(exit_code: i32, stdout: &str, stderr: &str) -> ProbeOutput {
        ProbeOutput {
            exit_code,
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
        }
    }

    #[test]
    fn quota_is_classified_before_auth() {
        // V1's stated reason for the order: a 429 that also mentions oauth is a quota wall.
        assert_eq!(
            classify_provider_error(Some("429 too many requests (oauth token ok)")),
            ProviderErrorKind::Quota
        );
        assert_eq!(
            classify_provider_error(Some("you are not logged into this account")),
            ProviderErrorKind::Auth
        );
        assert_eq!(classify_provider_error(Some("  ")), ProviderErrorKind::None);
        assert_eq!(classify_provider_error(None), ProviderErrorKind::None);
    }

    #[test]
    fn the_symbolic_code_wins_over_the_numeric_one() {
        assert_eq!(
            extract_provider_code("RESOURCE_EXHAUSTED (code 429)").as_deref(),
            Some("RESOURCE_EXHAUSTED")
        );
        assert_eq!(
            extract_provider_code("HTTP 503 from upstream").as_deref(),
            Some("503")
        );
        // Not every three-digit number is a status code.
        assert_eq!(extract_provider_code("read 512 bytes"), None);
    }

    #[test]
    fn only_a_quota_wall_is_worth_retrying() {
        assert!(is_retryable(ProviderErrorKind::Quota));
        assert!(!is_retryable(ProviderErrorKind::Auth));
        assert_eq!(
            describe_provider_error(ProviderErrorKind::Auth),
            "provider authentication failed"
        );
    }

    #[test]
    fn claude_maps_bedrock_retention_to_an_invalid_model() {
        let result = classify_claude_model(
            "claude-opus-5",
            &out(1, "", "Model requires data retention mode aws_review"),
        );
        assert_eq!(result.status, ModelValidationStatus::InvalidModel);
        assert!(result.error_message.unwrap().contains("aws_review"));
    }

    #[test]
    fn claude_needs_both_halves_of_the_invalid_model_phrase() {
        assert_eq!(
            classify_claude_model("x", &out(1, "", "model 'x' not found")).status,
            ModelValidationStatus::InvalidModel
        );
        // "not found" without "model" is not a model complaint.
        assert_eq!(
            classify_claude_model("x", &out(1, "", "config file not found")).status,
            ModelValidationStatus::Unknown
        );
    }

    #[test]
    fn claude_reports_a_quota_wall_rather_than_an_auth_failure() {
        // The message says both; only one of them is actionable advice.
        let result = classify_claude_model(
            "claude-opus-5",
            &out(
                1,
                "",
                "429 rate limit exceeded; re-authenticate if this persists",
            ),
        );
        assert_eq!(result.status, ModelValidationStatus::RateLimit);
    }

    #[test]
    fn claude_keeps_the_whole_output_when_nothing_matches() {
        let result = classify_claude_model("x", &out(7, "some stdout", "some stderr"));
        assert_eq!(result.status, ModelValidationStatus::Unknown);
        let message = result.error_message.unwrap();
        assert!(message.contains("exit=7"));
        assert!(message.contains("stdout: some stdout"));
        assert!(message.contains("stderr: some stderr"));
    }

    /// The single most surprising rule in this module, and the one a refactor would most likely
    /// "fix": Codex's probe blocks on stdin, so being killed for time is the success case.
    #[test]
    fn a_codex_timeout_means_the_model_was_accepted() {
        assert_eq!(
            classify_codex_model("gpt-5.6-sol", &out(-1, "", TIMED_OUT)).status,
            ModelValidationStatus::Ok
        );
        assert_eq!(
            classify_codex_model("gpt-5.6-sol", &out(0, "", "")).status,
            ModelValidationStatus::Ok
        );
        assert_eq!(
            classify_codex_model("nope", &out(1, "", "invalid model 'nope'")).status,
            ModelValidationStatus::InvalidModel
        );
    }

    #[test]
    fn antigravity_accepts_a_clean_exit_it_could_not_parse() {
        assert_eq!(
            classify_antigravity_model("gemini-3", &out(0, "OK", "")).status,
            ModelValidationStatus::Ok
        );
        assert_eq!(
            classify_antigravity_model("gemini-3", &out(-1, "", TIMED_OUT)).status,
            ModelValidationStatus::Timeout
        );
        assert_eq!(
            classify_antigravity_model("gemini-3", &out(1, "", "RESOURCE_EXHAUSTED")).status,
            ModelValidationStatus::RateLimit
        );
        assert_eq!(
            classify_antigravity_model("bogus", &out(1, "", "unknown model bogus")).status,
            ModelValidationStatus::InvalidModel
        );
    }

    #[test]
    fn the_opencode_counts_survive_a_coloured_table() {
        let coloured =
            "\x1b[1mopencode\x1b[0m\n\n  \x1b[32m2 credentials\x1b[0m\n  0 environment variables\n";
        assert_eq!(parse_opencode_auth_list(coloured), Some("auth-file"));
        // Environment wins when both are present, as in V1.
        assert_eq!(
            parse_opencode_auth_list("3 credentials\n1 environment variable"),
            Some("environment")
        );
        assert_eq!(
            parse_opencode_auth_list("0 credentials\n0 environment variables"),
            None
        );
        assert_eq!(parse_opencode_auth_list("nothing here"), None);
    }

    #[test]
    fn a_google_accounts_file_needs_a_named_active_account() {
        assert!(has_active_account(r#"{"active": "me@example.com"}"#));
        assert!(!has_active_account(r#"{"active": ""}"#));
        assert!(!has_active_account("{}"));
    }

    #[test]
    fn the_gemini_candidates_cover_both_layouts() {
        let candidates = gemini_credential_candidates(Path::new("/home/u"));
        assert!(candidates.contains(&PathBuf::from("/home/u/.gemini/oauth_creds.json")));
        assert!(candidates.contains(&PathBuf::from("/home/u/.gemini/config/settings.json")));
        assert!(candidates.contains(&PathBuf::from("/home/u/.gemini/config/config.json")));
        assert_eq!(candidates.len(), 7);
    }

    #[test]
    fn default_and_blank_are_not_model_ids() {
        assert_eq!(explicit_model("  "), None);
        assert_eq!(explicit_model("Default"), None);
        assert_eq!(explicit_model(" opus "), Some("opus"));
    }

    #[tokio::test]
    async fn a_probe_that_outlives_its_deadline_reports_the_sentinel() {
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        let args: Vec<String> = if cfg!(windows) {
            vec!["/c".to_string(), "ping -n 30 127.0.0.1 > nul".to_string()]
        } else {
            vec!["-c".to_string(), "sleep 30".to_string()]
        };
        let out = run_probe(shell, &args, Duration::from_millis(250)).await;
        assert!(out.timed_out(), "{out:?}");
    }

    #[tokio::test]
    async fn a_probe_reports_a_missing_binary_rather_than_panicking() {
        let out = run_probe("tendril-no-such-binary-4c1f", &[], Duration::from_secs(5)).await;
        assert_eq!(out.exit_code, -1);
        assert!(out.stderr.starts_with("Failed to start process"), "{out:?}");
    }

    #[tokio::test]
    async fn a_probe_collects_both_streams() {
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        let args: Vec<String> = if cfg!(windows) {
            vec![
                "/c".to_string(),
                "echo out & echo err 1>&2 & exit 3".to_string(),
            ]
        } else {
            vec![
                "-c".to_string(),
                "echo out; echo err >&2; exit 3".to_string(),
            ]
        };
        let out = run_probe(shell, &args, Duration::from_secs(10)).await;
        assert_eq!(out.exit_code, 3);
        assert!(out.stdout.contains("out"), "{out:?}");
        assert!(out.stderr.contains("err"), "{out:?}");
    }

    #[tokio::test]
    async fn a_missing_cli_is_reported_as_not_installed() {
        let status = check_install("tendril-no-such-agent-8a2b").await;
        assert!(!status.is_installed);
        assert!(status.error.unwrap().contains("not found on PATH"));
    }

    #[tokio::test]
    async fn a_proxy_without_credentials_never_reaches_the_network() {
        let result = check_auth("openaiproxy", &ProbeCredentials::default()).await;
        assert_eq!(result.status, AuthStatus::NotAuthenticated);
        assert_eq!(result.error.as_deref(), Some("Base URL is not configured."));

        let no_key = check_auth(
            "ivy",
            &ProbeCredentials {
                base_url: "https://example.invalid/v1".to_string(),
                api_key: String::new(),
            },
        )
        .await;
        assert_eq!(no_key.error.as_deref(), Some("API Key is not configured."));
    }

    #[tokio::test]
    async fn gemini_declines_to_validate_a_model_without_launching_anything() {
        let result =
            validate_model("gemini", "gemini-3.8-flash", &ProbeCredentials::default()).await;
        assert_eq!(result.status, ModelValidationStatus::Ok);
        assert_eq!(result.model, "gemini-3.8-flash");
    }

    #[tokio::test]
    async fn an_unknown_agent_is_refused_rather_than_probed() {
        let result = validate_model("nope", "m", &ProbeCredentials::default()).await;
        assert_eq!(result.status, ModelValidationStatus::Unknown);
        assert!(result.error_message.unwrap().contains("No model probe"));
    }
}
