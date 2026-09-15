//! Project hook resolution, condition gating, variable expansion and log capture.
//!
//! No test here spawns a process: every execution path goes through a recording [`HookExecutor`]
//! fake that stores each [`HookCommandSpec`] and answers with a canned [`HookCommandResult`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tendril_core::config::{expand_variables_with_env, load_config, save_config, TendrilSettings};
use tendril_core::jobs::hook_condition::classify_hook_condition;
use tendril_core::jobs::hooks::{
    condition_holds, matching_hooks, run_hooks_with_env, shell_hook_executor, HookCommandResult,
    HookCommandSpec, HookExecutor, HookPhase, HookRunContext, HOOK_ACTION_TIMEOUT,
    HOOK_CONDITION_TIMEOUT,
};
use tendril_core::models::{JobStatus, ProjectConfig, PromptwareHookConfig};

fn temp_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tendril-hooks-{}-{}",
        label,
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).expect("failed to create test dir");
    dir
}

fn hook(
    name: &str,
    when: &str,
    promptwares: &[&str],
    condition: &str,
    action: &str,
) -> PromptwareHookConfig {
    PromptwareHookConfig {
        name: name.to_string(),
        when: when.to_string(),
        promptwares: promptwares.iter().map(|p| p.to_string()).collect(),
        condition: condition.to_string(),
        action: action.to_string(),
    }
}

fn project_with_hooks(hooks: Vec<PromptwareHookConfig>) -> ProjectConfig {
    ProjectConfig {
        name: "TestProject".to_string(),
        color: "Blue".to_string(),
        hooks,
        ..Default::default()
    }
}

fn ctx(tendril_home: &Path, project: ProjectConfig, job_type: &str) -> HookRunContext {
    HookRunContext {
        tendril_home: tendril_home.to_path_buf(),
        config_path: tendril_home.join("config.yaml"),
        project,
        job_id: "04242".to_string(),
        job_type: job_type.to_string(),
        job_status: JobStatus::Running,
        plan_folder: String::new(),
    }
}

/// Records every spec it is handed and answers with the queued results in order, falling back to a
/// clean exit-zero once the queue is drained.
#[derive(Clone)]
struct Recorder {
    seen: Arc<Mutex<Vec<HookCommandSpec>>>,
    results: Arc<Mutex<Vec<HookCommandResult>>>,
}

impl Recorder {
    fn new(results: Vec<HookCommandResult>) -> Self {
        Self {
            seen: Arc::new(Mutex::new(Vec::new())),
            results: Arc::new(Mutex::new(results)),
        }
    }

    fn ok() -> Self {
        Self::new(Vec::new())
    }

    fn executor(&self) -> HookExecutor {
        let seen = self.seen.clone();
        let results = self.results.clone();
        Arc::new(move |spec: HookCommandSpec| {
            seen.lock().unwrap().push(spec);
            let result = results
                .lock()
                .unwrap()
                .pop()
                .unwrap_or_else(|| success(String::new()));
            Box::pin(async move { result })
        })
    }

    fn specs(&self) -> Vec<HookCommandSpec> {
        self.seen.lock().unwrap().clone()
    }

    fn commands(&self) -> Vec<String> {
        self.specs().into_iter().map(|s| s.command).collect()
    }
}

fn success(stdout: String) -> HookCommandResult {
    HookCommandResult {
        exit_code: Some(0),
        stdout,
        ..Default::default()
    }
}

fn no_env() -> HashMap<String, String> {
    HashMap::new()
}

// ---------------------------------------------------------------------------
// 1. Config round-trip with hooks
// ---------------------------------------------------------------------------

#[test]
fn test_config_round_trip_with_hooks() {
    let dir = temp_dir("roundtrip");
    let config_file = dir.join("config.yaml");

    let mut settings = TendrilSettings::default();
    settings.projects.push(project_with_hooks(vec![
        hook("PreFlight", "before", &[], "test -d .git", "echo starting"),
        hook(
            "SlackNotify",
            "after",
            &["CreatePr"],
            "",
            "pwsh -NoProfile -File %TENDRIL_HOME%/Hooks/NotifySlack.ps1",
        ),
    ]));

    save_config(&config_file, &settings).expect("failed to save config");

    let yaml = std::fs::read_to_string(&config_file).expect("failed to read config");
    assert!(yaml.contains("hooks:"), "config should carry a hooks block");
    assert!(
        yaml.contains("promptwares:"),
        "config should carry the promptwares list"
    );
    assert!(
        yaml.contains("%TENDRIL_HOME%"),
        "the stored action must keep its unexpanded form, got:\n{}",
        yaml
    );

    let loaded = load_config(&config_file).expect("failed to load config");
    let hooks = &loaded.projects[0].hooks;
    assert_eq!(hooks.len(), 2);

    assert_eq!(hooks[0].name, "PreFlight");
    assert_eq!(hooks[0].when, "before");
    assert!(hooks[0].promptwares.is_empty());
    assert_eq!(hooks[0].condition, "test -d .git");
    assert_eq!(hooks[0].action, "echo starting");

    assert_eq!(hooks[1].name, "SlackNotify");
    assert_eq!(hooks[1].when, "after");
    assert_eq!(hooks[1].promptwares, vec!["CreatePr".to_string()]);
    assert_eq!(hooks[1].condition, "");
    assert_eq!(
        hooks[1].action,
        "pwsh -NoProfile -File %TENDRIL_HOME%/Hooks/NotifySlack.ps1"
    );

    let _ = std::fs::remove_dir_all(dir);
}

// ---------------------------------------------------------------------------
// 2. Config round-trip without hooks
// ---------------------------------------------------------------------------

#[test]
fn test_config_without_hooks_loads_and_defaults() {
    let dir = temp_dir("absent");

    let absent = dir.join("absent.yaml");
    std::fs::write(
        &absent,
        "codingAgent: claude\nprojects:\n  - name: NoHooks\n    color: Blue\n",
    )
    .unwrap();
    let loaded = load_config(&absent).expect("a config with no hooks key must load");
    assert!(loaded.projects[0].hooks.is_empty());

    // Saving and reloading it still parses, and the absent block comes back as an empty list.
    save_config(&absent, &loaded).expect("failed to save config");
    let reloaded = load_config(&absent).expect("failed to reload config");
    assert!(reloaded.projects[0].hooks.is_empty());

    let empty = dir.join("empty.yaml");
    std::fs::write(
        &empty,
        "projects:\n  - name: EmptyHooks\n    color: Blue\n    hooks: []\n",
    )
    .unwrap();
    let loaded = load_config(&empty).expect("a config with `hooks: []` must load");
    assert!(loaded.projects[0].hooks.is_empty());

    // A hook that gives only what it must: `when` defaults to `before`, the rest to empty.
    let partial = dir.join("partial.yaml");
    std::fs::write(
        &partial,
        "projects:\n  - name: Partial\n    color: Blue\n    hooks:\n      - name: Minimal\n        action: echo hi\n",
    )
    .unwrap();
    let loaded = load_config(&partial).expect("a hook with only name and action must load");
    let h = &loaded.projects[0].hooks[0];
    assert_eq!(h.name, "Minimal");
    assert_eq!(h.when, "before");
    assert!(h.promptwares.is_empty());
    assert_eq!(h.condition, "");
    assert_eq!(h.action, "echo hi");

    let _ = std::fs::remove_dir_all(dir);
}

// ---------------------------------------------------------------------------
// 3. Matching by promptware and phase
// ---------------------------------------------------------------------------

#[test]
fn test_matching_hooks_by_phase_and_promptware() {
    let project = project_with_hooks(vec![
        hook("BeforeAll", "before", &[], "", "echo before-all"),
        hook("AfterCreatePr", "After", &["CreatePr"], "", "echo after-pr"),
        hook(
            "BeforeCreatePr",
            "before",
            &["createpr"],
            "",
            "echo before-pr",
        ),
        hook(
            "BeforeExecutePlan",
            "before",
            &["ExecutePlan"],
            "",
            "echo before-execute",
        ),
        hook("Sideways", "sideways", &[], "", "echo never"),
    ]);

    let before: Vec<&str> = matching_hooks(&project, "CreatePr", HookPhase::Before)
        .iter()
        .map(|h| h.name.as_str())
        .collect();
    // Config order, and only the `before` hooks that apply to CreatePr.
    assert_eq!(before, vec!["BeforeAll", "BeforeCreatePr"]);

    let after: Vec<&str> = matching_hooks(&project, "CreatePr", HookPhase::After)
        .iter()
        .map(|h| h.name.as_str())
        .collect();
    // `When: "After"` matches case-insensitively.
    assert_eq!(after, vec!["AfterCreatePr"]);

    let execute: Vec<&str> = matching_hooks(&project, "ExecutePlan", HookPhase::Before)
        .iter()
        .map(|h| h.name.as_str())
        .collect();
    assert_eq!(execute, vec!["BeforeAll", "BeforeExecutePlan"]);

    // A `when` that is neither phase matches nothing at all.
    for phase in [HookPhase::Before, HookPhase::After] {
        assert!(
            matching_hooks(&project, "AnyPromptware", phase)
                .iter()
                .all(|h| h.name != "Sideways"),
            "a hook with when: sideways must never match"
        );
    }
}

// ---------------------------------------------------------------------------
// 4. Condition gating
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_empty_condition_runs_the_action_without_executing_a_condition() {
    let home = temp_dir("empty-condition");
    let project = project_with_hooks(vec![hook("Notify", "before", &[], "", "echo hi")]);
    let recorder = Recorder::ok();

    run_hooks_with_env(
        &ctx(&home, project, "CreatePr"),
        HookPhase::Before,
        &recorder.executor(),
        &no_env(),
    )
    .await;

    let specs = recorder.specs();
    assert_eq!(
        specs.len(),
        1,
        "an empty condition must not be executed at all"
    );
    assert_eq!(specs[0].command, "echo hi");
    assert_eq!(specs[0].timeout, HOOK_ACTION_TIMEOUT);

    let _ = std::fs::remove_dir_all(home);
}

#[tokio::test]
async fn test_failing_condition_gates_the_action() {
    let cases: Vec<(&str, HookCommandResult)> = vec![
        (
            "non-zero exit",
            HookCommandResult {
                exit_code: Some(3),
                ..Default::default()
            },
        ),
        ("printed False", success("False".to_string())),
        ("printed false", success("false\n".to_string())),
        (
            "timed out",
            HookCommandResult {
                timed_out: true,
                ..Default::default()
            },
        ),
        (
            "could not spawn",
            HookCommandResult {
                spawn_error: Some("No such file or directory".to_string()),
                ..Default::default()
            },
        ),
    ];

    for (label, condition_result) in cases {
        assert!(
            !condition_holds(&condition_result),
            "{}: the condition must not hold",
            label
        );

        let home = temp_dir("gated");
        let project =
            project_with_hooks(vec![hook("Notify", "before", &[], "check-me", "echo hi")]);
        let recorder = Recorder::new(vec![condition_result]);

        run_hooks_with_env(
            &ctx(&home, project, "CreatePr"),
            HookPhase::Before,
            &recorder.executor(),
            &no_env(),
        )
        .await;

        let specs = recorder.specs();
        assert_eq!(
            specs.len(),
            1,
            "{}: only the condition should have been executed",
            label
        );
        assert_eq!(specs[0].command, "check-me");
        assert_eq!(specs[0].timeout, HOOK_CONDITION_TIMEOUT);

        let _ = std::fs::remove_dir_all(home);
    }
}

#[tokio::test]
async fn test_holding_condition_runs_the_action_after_it() {
    let home = temp_dir("holds");
    let project = project_with_hooks(vec![hook("Notify", "before", &[], "check-me", "echo hi")]);

    let held = success("True".to_string());
    assert!(condition_holds(&held));
    // `Recorder` pops from the back, so the condition's result is queued last.
    let recorder = Recorder::new(vec![success(String::new()), held]);

    run_hooks_with_env(
        &ctx(&home, project, "CreatePr"),
        HookPhase::Before,
        &recorder.executor(),
        &no_env(),
    )
    .await;

    assert_eq!(recorder.commands(), vec!["check-me", "echo hi"]);

    let _ = std::fs::remove_dir_all(home);
}

// ---------------------------------------------------------------------------
// 5. Variable expansion
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_hook_command_and_condition_are_variable_expanded() {
    let home = temp_dir("expansion");
    let home_str = home.to_string_lossy().to_string();

    let project = project_with_hooks(vec![
        hook(
            "Percent",
            "before",
            &[],
            "test -d %TENDRIL_HOME%/Hooks",
            "pwsh -NoProfile -File %TENDRIL_HOME%/Hooks/NotifySlack.ps1",
        ),
        hook(
            "Braced",
            "before",
            &[],
            "",
            "cat ${TENDRIL_HOME}/config.yaml",
        ),
        hook("Bare", "before", &[], "", "cat $TENDRIL_HOME/config.yaml"),
    ]);
    let recorder = Recorder::ok();

    run_hooks_with_env(
        &ctx(&home, project, "CreatePr"),
        HookPhase::Before,
        &recorder.executor(),
        &no_env(),
    )
    .await;

    let commands = recorder.commands();
    // Asserted against the shared expander, so a duplicated expander cannot make this pass.
    let expected: Vec<String> = [
        "test -d %TENDRIL_HOME%/Hooks",
        "pwsh -NoProfile -File %TENDRIL_HOME%/Hooks/NotifySlack.ps1",
        "cat ${TENDRIL_HOME}/config.yaml",
        "cat $TENDRIL_HOME/config.yaml",
    ]
    .iter()
    .map(|c| expand_variables_with_env(c, &home_str, &no_env()))
    .collect();
    assert_eq!(commands, expected);
    for command in &commands {
        assert!(
            command.contains(&home_str),
            "expected TENDRIL_HOME in {}",
            command
        );
    }

    let _ = std::fs::remove_dir_all(home);
}

#[tokio::test]
async fn test_hook_action_expands_arbitrary_env_vars_and_leaves_unset_ones_literal() {
    let home = temp_dir("env-expansion");
    let home_str = home.to_string_lossy().to_string();

    let mut env = HashMap::new();
    env.insert("REPOS_HOME".to_string(), "/srv/repos".to_string());

    let project = project_with_hooks(vec![hook(
        "Notify",
        "before",
        &[],
        "",
        "notify %REPOS_HOME%/tool --home %TENDRIL_HOME% --missing %NOPE%",
    )]);
    let recorder = Recorder::ok();

    run_hooks_with_env(
        &ctx(&home, project, "CreatePr"),
        HookPhase::Before,
        &recorder.executor(),
        &env,
    )
    .await;

    let command = recorder.commands().remove(0);
    assert_eq!(
        command,
        expand_variables_with_env(
            "notify %REPOS_HOME%/tool --home %TENDRIL_HOME% --missing %NOPE%",
            &home_str,
            &env
        )
    );
    assert!(command.contains("/srv/repos/tool"), "got: {}", command);
    assert!(command.contains(&home_str), "got: {}", command);
    assert!(
        command.contains("%NOPE%"),
        "an unset variable must be left literal, got: {}",
        command
    );

    let _ = std::fs::remove_dir_all(home);
}

// ---------------------------------------------------------------------------
// 6. Log capture and failure tolerance
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_failing_hook_is_logged_and_never_fails_the_job() {
    let home = temp_dir("log-failure");
    let project = project_with_hooks(vec![hook("Notify", "before", &[], "", "false")]);
    let recorder = Recorder::new(vec![HookCommandResult {
        exit_code: Some(1),
        stdout: "partial work".to_string(),
        stderr: "boom".to_string(),
        ..Default::default()
    }]);

    // No `Result` to unwrap and nothing to panic: a failing hook is a logged event, not an error.
    run_hooks_with_env(
        &ctx(&home, project, "CreatePr"),
        HookPhase::Before,
        &recorder.executor(),
        &no_env(),
    )
    .await;

    let log = std::fs::read_to_string(home.join("Logs").join("Jobs").join("04242.md"))
        .expect("the hook must have written to the job log");
    assert!(log.contains("hook:Notify (before)"), "got:\n{}", log);
    assert!(log.contains("exit code 1"), "got:\n{}", log);
    assert!(log.contains("partial work"), "got:\n{}", log);
    assert!(log.contains("boom"), "got:\n{}", log);

    let _ = std::fs::remove_dir_all(home);
}

#[tokio::test]
async fn test_condition_that_does_not_hold_is_logged_and_runs_no_action() {
    let home = temp_dir("log-condition");
    let project = project_with_hooks(vec![hook(
        "Notify",
        "before",
        &[],
        "check-me",
        "should-not-run",
    )]);
    let recorder = Recorder::new(vec![success("False".to_string())]);

    run_hooks_with_env(
        &ctx(&home, project, "CreatePr"),
        HookPhase::Before,
        &recorder.executor(),
        &no_env(),
    )
    .await;

    assert_eq!(recorder.commands(), vec!["check-me"]);

    let log = std::fs::read_to_string(home.join("Logs").join("Jobs").join("04242.md"))
        .expect("the skip must have been logged");
    assert!(log.contains("hook:Notify (before)"), "got:\n{}", log);
    assert!(log.contains("Condition not met"), "got:\n{}", log);
    assert!(
        !log.contains("should-not-run"),
        "the action must never have run, got:\n{}",
        log
    );

    let _ = std::fs::remove_dir_all(home);
}

#[tokio::test]
async fn test_hook_with_no_action_is_skipped_and_logged() {
    let home = temp_dir("no-action");
    let project = project_with_hooks(vec![hook("Empty", "before", &[], "check-me", "   ")]);
    let recorder = Recorder::ok();

    run_hooks_with_env(
        &ctx(&home, project, "CreatePr"),
        HookPhase::Before,
        &recorder.executor(),
        &no_env(),
    )
    .await;

    assert!(
        recorder.specs().is_empty(),
        "a hook with no action must not even evaluate its condition"
    );
    let log = std::fs::read_to_string(home.join("Logs").join("Jobs").join("04242.md"))
        .expect("the skip must have been logged");
    assert!(log.contains("hook:Empty (before)"), "got:\n{}", log);
    assert!(log.contains("no action"), "got:\n{}", log);

    let _ = std::fs::remove_dir_all(home);
}

#[tokio::test]
async fn test_hook_environment_and_working_directory() {
    let home = temp_dir("environment");
    let plan_folder = home.join("Plans").join("00573-Test");
    std::fs::create_dir_all(&plan_folder).unwrap();

    let project = project_with_hooks(vec![hook("Notify", "after", &[], "", "echo hi")]);
    let mut run_ctx = ctx(&home, project, "ExecutePlan");
    run_ctx.job_status = JobStatus::Completed;
    run_ctx.plan_folder = plan_folder.to_string_lossy().to_string();

    let recorder = Recorder::ok();
    run_hooks_with_env(&run_ctx, HookPhase::After, &recorder.executor(), &no_env()).await;

    let spec = recorder.specs().remove(0);
    assert_eq!(spec.working_dir, plan_folder);

    let env: HashMap<String, String> = spec.env.into_iter().collect();
    assert_eq!(env.get("TENDRIL_JOB_ID").unwrap(), "04242");
    assert_eq!(env.get("TENDRIL_JOB_TYPE").unwrap(), "ExecutePlan");
    assert_eq!(env.get("TENDRIL_JOB_STATUS").unwrap(), "Completed");
    assert_eq!(
        env.get("TENDRIL_PLAN_FOLDER").unwrap(),
        &plan_folder.to_string_lossy().to_string()
    );
    assert_eq!(
        env.get("TENDRIL_CONFIG").unwrap(),
        &home.join("config.yaml").to_string_lossy().to_string()
    );
    assert_eq!(
        env.get("TENDRIL_HOME").unwrap(),
        &home.to_string_lossy().to_string()
    );

    let _ = std::fs::remove_dir_all(home);
}

#[tokio::test]
async fn test_create_plan_style_run_falls_back_to_tendril_home() {
    let home = temp_dir("no-plan-folder");
    let project = project_with_hooks(vec![hook("Notify", "before", &[], "", "echo hi")]);
    let recorder = Recorder::ok();

    // A CreatePlan job has no plan folder yet, so the hook runs in TENDRIL_HOME.
    run_hooks_with_env(
        &ctx(&home, project, "CreatePlan"),
        HookPhase::Before,
        &recorder.executor(),
        &no_env(),
    )
    .await;

    let spec = recorder.specs().remove(0);
    assert_eq!(spec.working_dir, home);
    let env: HashMap<String, String> = spec.env.into_iter().collect();
    assert_eq!(env.get("TENDRIL_PLAN_FOLDER").unwrap(), "");

    let _ = std::fs::remove_dir_all(home);
}

#[tokio::test]
async fn test_project_without_hooks_executes_nothing() {
    let home = temp_dir("no-hooks");
    let recorder = Recorder::ok();

    run_hooks_with_env(
        &ctx(&home, project_with_hooks(vec![]), "CreatePr"),
        HookPhase::Before,
        &recorder.executor(),
        &no_env(),
    )
    .await;

    assert!(recorder.specs().is_empty());
    assert!(
        !home.join("Logs").exists(),
        "a project with no hooks must not touch the job log"
    );

    let _ = std::fs::remove_dir_all(home);
}

// ---------------------------------------------------------------------------
// 7. PowerShell-style conditions are evaluated in-process, not through `sh -c`
// ---------------------------------------------------------------------------

/// Fails on today's origin/main: `Test-Path` run through `sh -c` exits non-zero, so the condition
/// never holds and the action never runs, regardless of the actual filesystem state.
#[tokio::test]
async fn test_powershell_style_condition_fires_the_hook() {
    let home = temp_dir("powershell-condition");
    let plan_folder = home.join("Plans").join("00646-Test");
    std::fs::create_dir_all(plan_folder.join("artifacts/sample")).unwrap();

    // Case 1: a plain Test-Path over an existing path fires the action, and the condition is never
    // spawned at all — the recorder must see only the action.
    {
        let project = project_with_hooks(vec![hook(
            "Notify",
            "before",
            &[],
            r#"Test-Path "artifacts/sample""#,
            "echo hi",
        )]);
        let mut run_ctx = ctx(&home, project, "ExecutePlan");
        run_ctx.plan_folder = plan_folder.to_string_lossy().to_string();
        let recorder = Recorder::ok();

        run_hooks_with_env(&run_ctx, HookPhase::Before, &recorder.executor(), &no_env()).await;

        assert_eq!(
            recorder.commands(),
            vec!["echo hi".to_string()],
            "the PowerShell condition must never be spawned as a process"
        );
    }

    // Case 2: an -or across a missing and an existing path still fires.
    {
        let project = project_with_hooks(vec![hook(
            "Notify",
            "before",
            &[],
            r#"Test-Path "missing.txt" -or Test-Path "artifacts/sample""#,
            "echo hi",
        )]);
        let mut run_ctx = ctx(&home, project, "ExecutePlan");
        run_ctx.plan_folder = plan_folder.to_string_lossy().to_string();
        let recorder = Recorder::ok();

        run_hooks_with_env(&run_ctx, HookPhase::Before, &recorder.executor(), &no_env()).await;

        assert_eq!(recorder.commands(), vec!["echo hi".to_string()]);
    }

    // Case 3: a false -or over a parenthesised Test-Path on a missing path does not fire, and logs
    // the ordinary "Condition not met" wording.
    {
        let project = project_with_hooks(vec![hook(
            "Notify",
            "before",
            &[],
            r#"$false -or (Test-Path "missing.txt")"#,
            "should-not-run",
        )]);
        let mut run_ctx = ctx(&home, project, "ExecutePlan");
        run_ctx.plan_folder = plan_folder.to_string_lossy().to_string();
        let recorder = Recorder::ok();

        run_hooks_with_env(&run_ctx, HookPhase::Before, &recorder.executor(), &no_env()).await;

        assert!(
            recorder.specs().is_empty(),
            "the action must not have run, got: {:?}",
            recorder.commands()
        );
        let log = std::fs::read_to_string(home.join("Logs").join("Jobs").join("04242.md"))
            .expect("the skip must have been logged");
        assert!(log.contains("Condition not met"), "got:\n{}", log);
    }

    let _ = std::fs::remove_dir_all(home);
}

// ---------------------------------------------------------------------------
// 8. Unevaluable conditions are reported distinctly from an honest `False`
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_unevaluable_condition_is_reported_and_never_looks_like_a_false_condition() {
    // A condition outside the supported subset: reported as unevaluable, action never runs, and the
    // wording is never confusable with "Condition not met".
    {
        let home = temp_dir("unevaluable");
        let project = project_with_hooks(vec![hook(
            "Notify",
            "before",
            &[],
            "Get-ChildItem | Where-Object { $_.Length -gt 0 }",
            "should-not-run",
        )]);
        let recorder = Recorder::ok();

        run_hooks_with_env(
            &ctx(&home, project, "CreatePr"),
            HookPhase::Before,
            &recorder.executor(),
            &no_env(),
        )
        .await;

        assert!(
            recorder.specs().is_empty(),
            "the action must never have run"
        );
        let log = std::fs::read_to_string(home.join("Logs").join("Jobs").join("04242.md"))
            .expect("the failure must have been logged");
        assert!(
            log.contains("Condition could not be evaluated"),
            "got:\n{}",
            log
        );
        assert!(
            !log.contains("Condition not met"),
            "an unevaluable condition must never read like an honest False, got:\n{}",
            log
        );

        let _ = std::fs::remove_dir_all(home);
    }

    // The converse: a genuinely false condition logs "Condition not met" and never
    // "could not be evaluated".
    {
        let home = temp_dir("genuinely-false");
        let project = project_with_hooks(vec![hook(
            "Notify",
            "before",
            &[],
            "$false",
            "should-not-run",
        )]);
        let recorder = Recorder::ok();

        run_hooks_with_env(
            &ctx(&home, project, "CreatePr"),
            HookPhase::Before,
            &recorder.executor(),
            &no_env(),
        )
        .await;

        assert!(recorder.specs().is_empty());
        let log = std::fs::read_to_string(home.join("Logs").join("Jobs").join("04242.md"))
            .expect("the skip must have been logged");
        assert!(log.contains("Condition not met"), "got:\n{}", log);
        assert!(!log.contains("could not be evaluated"), "got:\n{}", log);

        let _ = std::fs::remove_dir_all(home);
    }

    // Shell path, timeout: `Unevaluable`, not `NotMet`.
    {
        let home = temp_dir("shell-timeout");
        let project = project_with_hooks(vec![hook(
            "Notify",
            "before",
            &[],
            "check-me",
            "should-not-run",
        )]);
        let recorder = Recorder::new(vec![HookCommandResult {
            timed_out: true,
            ..Default::default()
        }]);

        run_hooks_with_env(
            &ctx(&home, project, "CreatePr"),
            HookPhase::Before,
            &recorder.executor(),
            &no_env(),
        )
        .await;

        let log = std::fs::read_to_string(home.join("Logs").join("Jobs").join("04242.md"))
            .expect("the timeout must have been logged");
        assert!(
            log.contains("Condition could not be evaluated"),
            "got:\n{}",
            log
        );
        assert!(!log.contains("Condition not met"), "got:\n{}", log);

        let _ = std::fs::remove_dir_all(home);
    }

    // Shell path, plain non-zero exit: `NotMet`, not `Unevaluable`.
    {
        let home = temp_dir("shell-nonzero");
        let project = project_with_hooks(vec![hook(
            "Notify",
            "before",
            &[],
            "check-me",
            "should-not-run",
        )]);
        let recorder = Recorder::new(vec![HookCommandResult {
            exit_code: Some(3),
            ..Default::default()
        }]);

        run_hooks_with_env(
            &ctx(&home, project, "CreatePr"),
            HookPhase::Before,
            &recorder.executor(),
            &no_env(),
        )
        .await;

        let log = std::fs::read_to_string(home.join("Logs").join("Jobs").join("04242.md"))
            .expect("the skip must have been logged");
        assert!(log.contains("Condition not met"), "got:\n{}", log);
        assert!(!log.contains("could not be evaluated"), "got:\n{}", log);

        let _ = std::fs::remove_dir_all(home);
    }
}

// ---------------------------------------------------------------------------
// 9. POSIX conditions and commands still run through the shell, unchanged
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_posix_conditions_and_commands_still_run_through_the_shell() {
    let home = temp_dir("posix-conditions");
    for condition in [
        "cd /tmp && pnpm install && pnpm dev:app",
        "test -d .git",
        "[ -f package.json ]",
        "test -n \"$HOME\"",
    ] {
        assert_eq!(
            classify_hook_condition(condition),
            tendril_core::jobs::hook_condition::HookConditionLanguage::Shell,
            "expected {condition} to classify as Shell"
        );

        let project = project_with_hooks(vec![hook("Notify", "before", &[], condition, "echo hi")]);
        let recorder = Recorder::new(vec![success(String::new())]);

        run_hooks_with_env(
            &ctx(&home, project, "CreatePr"),
            HookPhase::Before,
            &recorder.executor(),
            &no_env(),
        )
        .await;

        let specs = recorder.specs();
        assert_eq!(
            specs.len(),
            2,
            "condition {condition} and action must both run"
        );
        assert_eq!(
            specs[0].command, condition,
            "the condition must reach the executor verbatim"
        );
        assert_eq!(specs[0].timeout, HOOK_CONDITION_TIMEOUT);
        assert_eq!(specs[1].command, "echo hi");
    }

    let _ = std::fs::remove_dir_all(home);
}

#[cfg(unix)]
#[tokio::test]
async fn test_shell_executor_still_runs_posix_commands_unchanged() {
    let executor = shell_hook_executor();
    let result = executor(HookCommandSpec {
        hook_name: "Notify".to_string(),
        command: "echo hi && test -d .".to_string(),
        working_dir: std::env::temp_dir(),
        env: Vec::new(),
        timeout: HOOK_CONDITION_TIMEOUT,
    })
    .await;

    assert_eq!(result.exit_code, Some(0));
    assert!(result.stdout.contains("hi"), "got: {:?}", result.stdout);
}
