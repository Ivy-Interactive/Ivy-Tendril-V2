use clap::Parser;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use tendril_cli::commands::plan::{
    handle_plan_command, PlanAddDependsOnArgs, PlanAddPrArgs, PlanCommands, PlanEditReasonArgs,
    PlanRecCommands, PlanRemovePrArgs, PlanRemoveRepoArgs, PlanSetArgs, PlanSetVerificationArgs,
    PlanVerificationAddArgs, PlanVerificationCommands, PlanVerificationRemoveArgs,
    PlanWriteRevisionArgs,
};
use tendril_core::config::{
    generate_bearer_secret, get_config_path, get_database_path, load_config, save_config,
    MasterGuard,
};
use tendril_core::db::{get_recommendations, open_database, RecommendationRow};
use tendril_core::models::{
    PlanVerificationEntry, ProjectConfig, ProjectVerificationRef, RecommendationStatus,
    VerificationConfig, VerificationStatus,
};
use tendril_core::plans::{
    create_plan, list_recommendations, read_plan_file, read_plan_yaml, CreatePlanOptions,
};
use tendril_server::{create_router, AppState};

static ENV_LOCK: LazyLock<Arc<tokio::sync::Mutex<()>>> =
    LazyLock::new(|| Arc::new(tokio::sync::Mutex::new(())));

struct EnvGuard {
    _lock: tokio::sync::OwnedMutexGuard<()>,
    orig_plans: Option<String>,
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.orig_plans {
            Some(v) => std::env::set_var("TENDRIL_PLANS", v),
            None => std::env::remove_var("TENDRIL_PLANS"),
        }
    }
}

struct TestServer {
    pub tendril_home: PathBuf,
    pub state: Arc<AppState>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    _env_guard: EnvGuard,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

async fn start_test_server() -> TestServer {
    let lock = ENV_LOCK.clone().lock_owned().await;
    let orig_plans = std::env::var("TENDRIL_PLANS").ok();

    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-plan-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str, "http").unwrap();

    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();

    std::env::set_var("TENDRIL_PLANS", &plans_dir);
    let env_guard = EnvGuard {
        _lock: lock,
        orig_plans,
    };

    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));
    let app = create_router(state.clone());

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _guard = guard;
        let _ = axum::serve(tokio_listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    TestServer {
        tendril_home,
        state,
        shutdown_tx: Some(shutdown_tx),
        _env_guard: env_guard,
    }
}

#[tokio::test]
async fn test_plan_set_with_reason_and_chat_session() {
    let server = start_test_server().await;

    // 1. Create a linked chat session
    let session = server
        .state
        .chat_manager
        .create_session(
            Some("Plan Review Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    // 2. Create plan linked to the session
    let opts = CreatePlanOptions {
        title: "Initial Title".to_string(),
        project: "test-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: Some(session.id.clone()),
    };
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();

    // 3. Run tendril plan set with --reason and --chat-session
    let set_args = PlanSetArgs {
        plan_id: pf.id().to_string(),
        field: "title".to_string(),
        value: "Updated Title".to_string(),
        allow_failed_verifications: false,
        reason: Some("User requested shorter title".to_string()),
        chat_session: Some("different-originating-session".to_string()),
    };

    handle_plan_command(PlanCommands::Set(set_args), &server.tendril_home)
        .await
        .expect("handle_plan_command Set");

    // 4. Verify plan.yaml was updated
    let updated_pf = read_plan_file(std::path::Path::new(&pf.folder_path)).unwrap();
    assert_eq!(updated_pf.metadata.title, "Updated Title");

    // 5. Verify linked session received event
    let sess_after = server
        .state
        .chat_manager
        .get_session(&session.id)
        .await
        .unwrap();
    assert_eq!(sess_after.messages.len(), 1);
    let msg = &sess_after.messages[0];
    assert_eq!(msg.role, "system");
    assert!(msg.content.contains("title set to Updated Title"));
    assert!(msg
        .content
        .contains("Reason: User requested shorter title."));
}

#[tokio::test]
async fn test_plan_set_verification_with_reason() {
    let server = start_test_server().await;

    let session = server
        .state
        .chat_manager
        .create_session(
            Some("Plan Review Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let opts = CreatePlanOptions {
        title: "Verif Plan".to_string(),
        project: "test-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![PlanVerificationEntry {
            name: "RustBuild".to_string(),
            status: VerificationStatus::Pending,
        }],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: Some(session.id.clone()),
    };
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();

    let set_verif_args = PlanSetVerificationArgs {
        plan_id: pf.id().to_string(),
        name: "RustBuild".to_string(),
        status: "Pass".to_string(),
        reason: Some("build succeeded with zero warnings".to_string()),
        chat_session: Some("source-session".to_string()),
    };

    handle_plan_command(
        PlanCommands::SetVerification(set_verif_args),
        &server.tendril_home,
    )
    .await
    .expect("handle_plan_command SetVerification");

    let updated_pf = read_plan_file(std::path::Path::new(&pf.folder_path)).unwrap();
    let verif = updated_pf
        .metadata
        .verifications
        .iter()
        .find(|v| v.name == "RustBuild")
        .unwrap();
    assert_eq!(verif.status, VerificationStatus::Pass);

    let sess_after = server
        .state
        .chat_manager
        .get_session(&session.id)
        .await
        .unwrap();
    assert_eq!(sess_after.messages.len(), 1);
    let msg = &sess_after.messages[0];
    assert!(msg.content.contains("verification RustBuild set to Pass"));
    assert!(msg
        .content
        .contains("Reason: build succeeded with zero warnings."));
}

#[tokio::test]
async fn test_plan_write_revision_warns_on_missing_reason() {
    let server = start_test_server().await;

    let opts = CreatePlanOptions {
        title: "Revision Warn Plan".to_string(),
        project: "test-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    };
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();

    let rev_file = server.tendril_home.join("temp-rev.md");
    std::fs::write(
        &rev_file,
        "# Revision Warn Plan\n\n## Problem\nSome problem\n\n## Solution\nSome solution\n",
    )
    .unwrap();

    let write_args = PlanWriteRevisionArgs {
        plan_id: pf.id().to_string(),
        file: Some(rev_file),
        stdin: false,
        plans_dir: None,
        no_question_check: true,
        reason: None, // Missing reason!
        chat_session: None,
    };

    handle_plan_command(
        PlanCommands::WriteRevision(write_args),
        &server.tendril_home,
    )
    .await
    .expect("handle_plan_command WriteRevision should succeed even without reason");

    let updated_pf = read_plan_file(std::path::Path::new(&pf.folder_path)).unwrap();
    assert!(updated_pf.revision_count >= 1);
}

#[tokio::test]
async fn test_plan_write_revision_reports_event() {
    let server = start_test_server().await;

    let session = server
        .state
        .chat_manager
        .create_session(
            Some("Plan Review Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let opts = CreatePlanOptions {
        title: "Revision Event Plan".to_string(),
        project: "test-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: Some(session.id.clone()),
    };
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();

    let rev_file = server.tendril_home.join("temp-rev-event.md");
    std::fs::write(
        &rev_file,
        "# Revision Event Plan\n\n## Problem\nProblem\n\n## Solution\nSolution\n",
    )
    .unwrap();

    let write_args = PlanWriteRevisionArgs {
        plan_id: pf.id().to_string(),
        file: Some(rev_file),
        stdin: false,
        plans_dir: None,
        no_question_check: true,
        reason: Some("Added database migration step".to_string()),
        chat_session: Some("source-editor-session".to_string()),
    };

    handle_plan_command(
        PlanCommands::WriteRevision(write_args),
        &server.tendril_home,
    )
    .await
    .expect("handle_plan_command WriteRevision with event reporting");

    let sess_after = server
        .state
        .chat_manager
        .get_session(&session.id)
        .await
        .unwrap();
    assert_eq!(sess_after.messages.len(), 1);
    let msg = &sess_after.messages[0];
    assert!(msg.content.contains("was edited directly: revision"));
    assert!(msg
        .content
        .contains("Reason: Added database migration step."));
}

// --- Remove-pr -----------------------------------------------------------------------------------

async fn create_test_plan(
    server: &TestServer,
    title: &str,
    chat_session_id: Option<String>,
) -> tendril_core::models::PlanFile {
    create_plan(
        &server.state.plans_dir,
        CreatePlanOptions {
            title: title.to_string(),
            project: "test-proj".to_string(),
            level: Some("Feature".to_string()),
            initial_prompt: None,
            source_url: None,
            execution_profile: None,
            priority: Some(0),
            repos: vec![],
            verifications: vec![],
            depends_on: vec![],
            related_plans: vec![],
            chat_session_id,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn test_plan_remove_pr_removes_by_canonical_url() {
    let server = start_test_server().await;
    let pf = create_test_plan(&server, "Remove Pr Plan", None).await;

    let add_args = PlanAddPrArgs {
        plan_id: pf.id().to_string(),
        url: "https://github.com/owner/repo/pull/42".to_string(),
        reason: None,
        chat_session: None,
    };
    handle_plan_command(PlanCommands::AddPr(add_args), &server.tendril_home)
        .await
        .expect("handle_plan_command AddPr");

    let remove_args = PlanRemovePrArgs {
        plan_id: pf.id().to_string(),
        url: "https://github.com/owner/repo/pull/42/files".to_string(),
        reason: Some("cleaning up a stray PR".to_string()),
        chat_session: None,
    };
    handle_plan_command(PlanCommands::RemovePr(remove_args), &server.tendril_home)
        .await
        .expect("handle_plan_command RemovePr");

    let (plan, _) = read_plan_yaml(std::path::Path::new(&pf.folder_path)).unwrap();
    assert!(plan.prs.is_empty());
}

#[tokio::test]
async fn test_plan_remove_pr_is_idempotent_when_absent() {
    let server = start_test_server().await;
    let pf = create_test_plan(&server, "Remove Pr Absent Plan", None).await;
    let before = read_plan_yaml(std::path::Path::new(&pf.folder_path))
        .unwrap()
        .0
        .updated;

    let remove_args = PlanRemovePrArgs {
        plan_id: pf.id().to_string(),
        url: "https://github.com/owner/repo/pull/99".to_string(),
        reason: None,
        chat_session: None,
    };
    handle_plan_command(PlanCommands::RemovePr(remove_args), &server.tendril_home)
        .await
        .expect("removing an absent PR must succeed rather than error");

    let (plan, _) = read_plan_yaml(std::path::Path::new(&pf.folder_path)).unwrap();
    assert!(plan.prs.is_empty());
    assert_eq!(
        plan.updated, before,
        "a no-op removal must not bump updated"
    );
}

#[tokio::test]
async fn test_plan_remove_pr_reports_reason_to_chat_session() {
    let server = start_test_server().await;

    let session = server
        .state
        .chat_manager
        .create_session(
            Some("PR Removal Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let pf = create_test_plan(&server, "Remove Pr Reason Plan", Some(session.id.clone())).await;

    let add_args = PlanAddPrArgs {
        plan_id: pf.id().to_string(),
        url: "https://github.com/owner/repo/pull/7".to_string(),
        reason: None,
        chat_session: Some("adder-session".to_string()),
    };
    handle_plan_command(PlanCommands::AddPr(add_args), &server.tendril_home)
        .await
        .expect("handle_plan_command AddPr");

    let remove_args = PlanRemovePrArgs {
        plan_id: pf.id().to_string(),
        url: "https://github.com/owner/repo/pull/7".to_string(),
        reason: Some("PR was closed without merging".to_string()),
        chat_session: Some("remover-session".to_string()),
    };
    handle_plan_command(PlanCommands::RemovePr(remove_args), &server.tendril_home)
        .await
        .expect("handle_plan_command RemovePr");

    let sess_after = server
        .state
        .chat_manager
        .get_session(&session.id)
        .await
        .unwrap();
    let msg = sess_after
        .messages
        .iter()
        .find(|m| m.content.contains("was edited directly"))
        .expect("expected an edit notification message");
    assert!(msg.content.contains("was edited directly"));
    assert!(msg
        .content
        .contains("Reason: PR was closed without merging."));
}

#[tokio::test]
async fn test_plan_remove_pr_falls_back_to_env_chat_session() {
    let server = start_test_server().await;

    let session = server
        .state
        .chat_manager
        .create_session(
            Some("PR Removal Env Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let pf = create_test_plan(
        &server,
        "Remove Pr Env Session Plan",
        Some(session.id.clone()),
    )
    .await;

    let add_args = PlanAddPrArgs {
        plan_id: pf.id().to_string(),
        url: "https://github.com/owner/repo/pull/9".to_string(),
        reason: None,
        chat_session: Some(session.id.clone()),
    };
    handle_plan_command(PlanCommands::AddPr(add_args), &server.tendril_home)
        .await
        .expect("handle_plan_command AddPr");

    // Guarded by ENV_LOCK, held for the lifetime of `server` above.
    let orig = std::env::var("TENDRIL_CHAT_SESSION_ID").ok();
    std::env::set_var("TENDRIL_CHAT_SESSION_ID", "env-fallback-session");

    let remove_args = PlanRemovePrArgs {
        plan_id: pf.id().to_string(),
        url: "https://github.com/owner/repo/pull/9".to_string(),
        reason: Some("stray PR removed via env fallback".to_string()),
        chat_session: None,
    };
    let result =
        handle_plan_command(PlanCommands::RemovePr(remove_args), &server.tendril_home).await;

    match orig {
        Some(v) => std::env::set_var("TENDRIL_CHAT_SESSION_ID", v),
        None => std::env::remove_var("TENDRIL_CHAT_SESSION_ID"),
    }
    result.expect("handle_plan_command RemovePr with env fallback session");

    let sess_after = server
        .state
        .chat_manager
        .get_session(&session.id)
        .await
        .unwrap();
    assert!(
        sess_after
            .messages
            .iter()
            .any(|m| m.content.contains("was edited directly")),
        "expected the plan's own chat session to receive the notification since the env session differs from it"
    );
}

// --- Worktree creation and verification listing ------------------------------------------------
//
// ExecutePlan and RetryPlan parse these two commands' *stdout* — the JSON array and the
// `Worktree created:` / `Branch:` lines their error paths quote. So these run the real binary
// rather than `handle_plan_command` directly: a return value cannot check what was printed.

/// A `TendrilHome` with its own plans directory and no daemon behind it.
struct CliHome {
    path: PathBuf,
}

impl Drop for CliHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

impl CliHome {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-cli-plan-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(path.join("Plans")).unwrap();
        Self { path }
    }

    fn plans_dir(&self) -> PathBuf {
        self.path.join("Plans")
    }

    fn run(&self, args: &[&str]) -> std::process::Output {
        std::process::Command::new(env!("CARGO_BIN_EXE_tendril"))
            .arg("--home")
            .arg(&self.path)
            // The tests in this file share TENDRIL_PLANS through ENV_LOCK, so pin the child to
            // this home instead of letting it inherit whatever the parent has set.
            .env("TENDRIL_PLANS", self.plans_dir())
            .args(args)
            .output()
            .unwrap_or_else(|e| panic!("run tendril {:?}: {}", args, e))
    }

    fn run_ok(&self, args: &[&str]) -> String {
        let out = self.run(args);
        assert!(
            out.status.success(),
            "tendril {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).expect("stdout is utf-8")
    }
}

fn entry(name: &str, status: VerificationStatus) -> PlanVerificationEntry {
    PlanVerificationEntry {
        name: name.to_string(),
        status,
    }
}

fn plan_opts(title: &str, verifications: Vec<PlanVerificationEntry>) -> CreatePlanOptions {
    CreatePlanOptions {
        title: title.to_string(),
        project: "list-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications,
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    }
}

#[test]
fn plan_verification_list_json_is_parseable() {
    let home = CliHome::new("verification-list");

    // The project config defines the run order, with CheckResult last where it belongs.
    let cfg_path = get_config_path(&home.path);
    let mut settings = load_config(&cfg_path).unwrap();
    settings.projects.push(ProjectConfig {
        name: "list-proj".to_string(),
        verifications: ["NpmLint", "RustBuild", "CheckResult"]
            .iter()
            .map(|n| ProjectVerificationRef {
                name: n.to_string(),
                required: true,
                extra: Default::default(),
            })
            .collect(),
        ..Default::default()
    });
    save_config(&cfg_path, &settings).unwrap();

    // The plan records them in a different order, which the command must not preserve.
    let pf = create_plan(
        &home.plans_dir(),
        plan_opts(
            "Verification List Plan",
            vec![
                entry("CheckResult", VerificationStatus::Pending),
                entry("NpmLint", VerificationStatus::Pass),
                entry("RustBuild", VerificationStatus::Pending),
            ],
        ),
    )
    .unwrap();
    let plan_id = pf.id().to_string();

    let stdout = home.run_ok(&["plan", "verification", "list", &plan_id, "--json"]);
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).expect("stdout is a JSON array");

    // `{ name, status }` in run order is what ExecutePlan and RetryPlan promise.
    let pairs: Vec<(&str, &str)> = parsed
        .as_array()
        .expect("a JSON array")
        .iter()
        .map(|e| {
            (
                e["name"].as_str().expect("name"),
                e["status"].as_str().expect("status"),
            )
        })
        .collect();
    assert_eq!(
        pairs,
        [
            ("NpmLint", "Pass"),
            ("RustBuild", "Pending"),
            ("CheckResult", "Pending"),
        ]
    );

    // --status filters, case-insensitively, and keeps the order.
    let stdout = home.run_ok(&[
        "plan",
        "verification",
        "list",
        &plan_id,
        "--json",
        "--status",
        "pending",
    ]);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap();
    let names: Vec<&str> = parsed
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["RustBuild", "CheckResult"]);

    // Without --json it is a table, not JSON.
    let stdout = home.run_ok(&["plan", "verification", "list", &plan_id]);
    assert!(stdout.contains("Name"), "table output: {}", stdout);
    assert!(stdout.contains("CheckResult"), "table output: {}", stdout);
}

fn parse_verification(args: &[&str]) -> PlanVerificationCommands {
    let mut argv = vec!["tendril", "verification"];
    argv.extend_from_slice(args);
    match PlanCli::try_parse_from(argv)
        .expect("parse verification command")
        .command
    {
        PlanCommands::Verification(cmd) => cmd,
        _ => panic!("expected a verification subcommand"),
    }
}

#[test]
fn plan_verification_add_remove_parse_all_flags() {
    match parse_verification(&[
        "add",
        "00626",
        "RustBuild",
        "--status",
        "Skipped",
        "--reason",
        "why",
        "--chat-session",
        "sess-1",
    ]) {
        PlanVerificationCommands::Add(args) => {
            assert_eq!(args.plan_id, "00626");
            assert_eq!(args.name, "RustBuild");
            assert_eq!(args.status.as_deref(), Some("Skipped"));
            assert_eq!(args.edit.reason.as_deref(), Some("why"));
            assert_eq!(args.edit.chat_session.as_deref(), Some("sess-1"));
        }
        other => panic!("expected Add, got {:?}", std::mem::discriminant(&other)),
    }

    // A bare `<id> <name>` is valid: --status is optional.
    match parse_verification(&["add", "00626", "RustBuild"]) {
        PlanVerificationCommands::Add(args) => assert_eq!(args.status, None),
        other => panic!("expected Add, got {:?}", std::mem::discriminant(&other)),
    }

    match parse_verification(&[
        "remove",
        "00626",
        "RustBuild",
        "--reason",
        "no longer needed",
        "--chat-session",
        "sess-2",
    ]) {
        PlanVerificationCommands::Remove(args) => {
            assert_eq!(args.plan_id, "00626");
            assert_eq!(args.name, "RustBuild");
            assert_eq!(args.edit.reason.as_deref(), Some("no longer needed"));
            assert_eq!(args.edit.chat_session.as_deref(), Some("sess-2"));
        }
        other => panic!("expected Remove, got {:?}", std::mem::discriminant(&other)),
    }
}

/// `add` appends to the plan's own list, independently of the project config's run order — seeding
/// the plan out of that order (`CheckResult` before `NpmLint`) keeps the two assertions distinct.
#[test]
fn plan_verification_add_appends_and_defaults_to_pending() {
    let home = CliHome::new("verification-add-append");

    let cfg_path = get_config_path(&home.path);
    let mut settings = load_config(&cfg_path).unwrap();
    settings.projects.push(ProjectConfig {
        name: "list-proj".to_string(),
        verifications: ["NpmLint", "RustBuild", "CheckResult"]
            .iter()
            .map(|n| ProjectVerificationRef {
                name: n.to_string(),
                required: true,
                extra: Default::default(),
            })
            .collect(),
        ..Default::default()
    });
    settings.verifications.push(VerificationConfig {
        name: "RustFormat".to_string(),
        prompt: "Run cargo fmt --check".to_string(),
    });
    save_config(&cfg_path, &settings).unwrap();

    let pf = create_plan(
        &home.plans_dir(),
        plan_opts(
            "Verification Add Plan",
            vec![
                entry("CheckResult", VerificationStatus::Pending),
                entry("NpmLint", VerificationStatus::Pending),
            ],
        ),
    )
    .unwrap();
    let plan_id = pf.id().to_string();

    home.run_ok(&["plan", "verification", "add", &plan_id, "RustFormat"]);

    let (plan, _) = read_plan_yaml(Path::new(&pf.folder_path)).unwrap();
    let names: Vec<&str> = plan.verifications.iter().map(|v| v.name.as_str()).collect();
    assert_eq!(
        names,
        ["CheckResult", "NpmLint", "RustFormat"],
        "appended last, preserving the plan's own (out-of-config) order for the rest"
    );
    assert_eq!(
        plan.verifications
            .iter()
            .find(|v| v.name == "RustFormat")
            .unwrap()
            .status,
        VerificationStatus::Pending
    );

    // The project config's order (NpmLint, RustBuild, CheckResult) is the run order, which differs
    // from the plan's own (append) order asserted above.
    let stdout = home.run_ok(&["plan", "verification", "list", &plan_id, "--json"]);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap();
    let ordered_names: Vec<&str> = parsed
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(ordered_names, ["NpmLint", "CheckResult", "RustFormat"]);
}

#[test]
fn plan_verification_add_honours_status_flag() {
    let home = CliHome::new("verification-add-status");
    let pf = create_plan(
        &home.plans_dir(),
        plan_opts("Verification Add Status Plan", vec![]),
    )
    .unwrap();
    let plan_id = pf.id().to_string();

    // Lower-case exercises `VerificationStatus::from_str_loose`.
    home.run_ok(&[
        "plan",
        "verification",
        "add",
        &plan_id,
        "RustBuild",
        "--status",
        "skipped",
    ]);
    let (plan, _) = read_plan_yaml(Path::new(&pf.folder_path)).unwrap();
    assert_eq!(plan.verifications[0].status, VerificationStatus::Skipped);

    let out = home.run(&[
        "plan",
        "verification",
        "add",
        &plan_id,
        "RustClippy",
        "--status",
        "bogus",
    ]);
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Invalid verification status"),
        "stderr: {}",
        stderr
    );
    let (plan, _) = read_plan_yaml(Path::new(&pf.folder_path)).unwrap();
    assert_eq!(
        plan.verifications.len(),
        1,
        "the bad add must not be written"
    );
}

#[test]
fn plan_verification_add_rejects_duplicate() {
    let home = CliHome::new("verification-add-duplicate");
    let pf = create_plan(
        &home.plans_dir(),
        plan_opts(
            "Verification Add Duplicate Plan",
            vec![entry("RustBuild", VerificationStatus::Pass)],
        ),
    )
    .unwrap();
    let plan_id = pf.id().to_string();

    for existing_spelling in ["RustBuild", "rustbuild"] {
        let out = home.run(&["plan", "verification", "add", &plan_id, existing_spelling]);
        assert!(!out.status.success());
        assert!(
            String::from_utf8_lossy(&out.stderr).contains("already exists"),
            "stderr: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    let (plan, _) = read_plan_yaml(Path::new(&pf.folder_path)).unwrap();
    assert_eq!(plan.verifications.len(), 1, "no second entry was written");
    assert_eq!(plan.verifications[0].status, VerificationStatus::Pass);
}

#[test]
fn plan_verification_add_rejects_unknown_name() {
    let home = CliHome::new("verification-add-unknown");

    let cfg_path = get_config_path(&home.path);
    let mut settings = load_config(&cfg_path).unwrap();
    settings.verifications.push(VerificationConfig {
        name: "NpmLint".to_string(),
        prompt: "Run pnpm lint".to_string(),
    });
    settings.verifications.push(VerificationConfig {
        name: "RustBuild".to_string(),
        prompt: "Run cargo build".to_string(),
    });
    save_config(&cfg_path, &settings).unwrap();

    let pf = create_plan(
        &home.plans_dir(),
        plan_opts("Verification Add Unknown Plan", vec![]),
    )
    .unwrap();
    let plan_id = pf.id().to_string();

    let out = home.run(&["plan", "verification", "add", &plan_id, "NotAThing"]);
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Unknown verification 'NotAThing'"),
        "stderr: {}",
        stderr
    );
    assert!(stderr.contains("NpmLint"), "stderr: {}", stderr);
    assert!(stderr.contains("RustBuild"), "stderr: {}", stderr);

    let (plan, _) = read_plan_yaml(Path::new(&pf.folder_path)).unwrap();
    assert!(plan.verifications.is_empty(), "nothing was written");
}

#[test]
fn plan_verification_remove_preserves_order() {
    let home = CliHome::new("verification-remove-order");
    let pf = create_plan(
        &home.plans_dir(),
        plan_opts(
            "Verification Remove Order Plan",
            vec![
                entry("NpmLint", VerificationStatus::Pending),
                entry("RustClippy", VerificationStatus::Pending),
                entry("RustFormat", VerificationStatus::Pending),
                entry("CheckResult", VerificationStatus::Pending),
            ],
        ),
    )
    .unwrap();
    let plan_id = pf.id().to_string();

    home.run_ok(&["plan", "verification", "remove", &plan_id, "RustClippy"]);

    let (plan, _) = read_plan_yaml(Path::new(&pf.folder_path)).unwrap();
    let names: Vec<&str> = plan.verifications.iter().map(|v| v.name.as_str()).collect();
    assert_eq!(names, ["NpmLint", "RustFormat", "CheckResult"]);
}

#[test]
fn plan_verification_remove_missing_lists_current_names() {
    let home = CliHome::new("verification-remove-missing");
    let pf = create_plan(
        &home.plans_dir(),
        plan_opts(
            "Verification Remove Missing Plan",
            vec![
                entry("NpmLint", VerificationStatus::Pending),
                entry("RustBuild", VerificationStatus::Pending),
            ],
        ),
    )
    .unwrap();
    let plan_id = pf.id().to_string();

    let out = home.run(&["plan", "verification", "remove", &plan_id, "NotOnPlan"]);
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("not found"), "stderr: {}", stderr);
    assert!(stderr.contains("NpmLint"), "stderr: {}", stderr);
    assert!(stderr.contains("RustBuild"), "stderr: {}", stderr);

    let (plan, _) = read_plan_yaml(Path::new(&pf.folder_path)).unwrap();
    assert_eq!(plan.verifications.len(), 2, "plan.yaml is untouched");
}

#[test]
fn plan_verification_add_warns_on_missing_reason() {
    let home = CliHome::new("verification-add-warn-reason");
    let pf = create_plan(
        &home.plans_dir(),
        plan_opts("Verification Add Warn Plan", vec![]),
    )
    .unwrap();
    let plan_id = pf.id().to_string();

    let out = home.run(&["plan", "verification", "add", &plan_id, "RustBuild"]);
    assert!(out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("warning: no --reason given for this plan edit"),
        "stderr: {}",
        stderr
    );
}

#[tokio::test]
async fn test_plan_verification_add_reports_reason() {
    let server = start_test_server().await;

    let session = server
        .state
        .chat_manager
        .create_session(
            Some("Plan Review Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let opts = CreatePlanOptions {
        title: "Verification Add Reason Plan".to_string(),
        project: "test-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: Some(session.id.clone()),
    };
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();

    let add_args = PlanVerificationAddArgs {
        plan_id: pf.id().to_string(),
        name: "RustFormat".to_string(),
        status: None,
        edit: PlanEditReasonArgs {
            reason: Some("adding formatting gate".to_string()),
            chat_session: Some("source-session".to_string()),
        },
    };

    handle_plan_command(
        PlanCommands::Verification(PlanVerificationCommands::Add(add_args)),
        &server.tendril_home,
    )
    .await
    .expect("handle_plan_command Verification Add");

    let sess_after = server
        .state
        .chat_manager
        .get_session(&session.id)
        .await
        .unwrap();
    assert_eq!(sess_after.messages.len(), 1);
    let msg = &sess_after.messages[0];
    assert!(msg
        .content
        .contains("verification RustFormat added as Pending"));
    assert!(msg.content.contains("Reason: adding formatting gate."));
}

#[tokio::test]
async fn test_plan_verification_remove_reports_reason() {
    let server = start_test_server().await;

    let session = server
        .state
        .chat_manager
        .create_session(
            Some("Plan Review Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let opts = CreatePlanOptions {
        title: "Verification Remove Reason Plan".to_string(),
        project: "test-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![PlanVerificationEntry {
            name: "RustFormat".to_string(),
            status: VerificationStatus::Pending,
        }],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: Some(session.id.clone()),
    };
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();

    let remove_args = PlanVerificationRemoveArgs {
        plan_id: pf.id().to_string(),
        name: "RustFormat".to_string(),
        edit: PlanEditReasonArgs {
            reason: Some("no longer needed".to_string()),
            chat_session: Some("source-session".to_string()),
        },
    };

    handle_plan_command(
        PlanCommands::Verification(PlanVerificationCommands::Remove(remove_args)),
        &server.tendril_home,
    )
    .await
    .expect("handle_plan_command Verification Remove");

    let updated_pf = read_plan_file(Path::new(&pf.folder_path)).unwrap();
    assert!(!updated_pf
        .metadata
        .verifications
        .iter()
        .any(|v| v.name == "RustFormat"));

    let sess_after = server
        .state
        .chat_manager
        .get_session(&session.id)
        .await
        .unwrap();
    assert_eq!(sess_after.messages.len(), 1);
    let msg = &sess_after.messages[0];
    assert!(msg.content.contains("verification RustFormat removed"));
    assert!(msg.content.contains("Reason: no longer needed."));
}

#[test]
fn plan_add_worktree_reports_branch_and_path() {
    let home = CliHome::new("add-worktree");

    let repo = home.path.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    for args in [
        vec!["init", "--initial-branch=main"],
        vec!["config", "user.name", "Tendril Test"],
        vec!["config", "user.email", "test@example.com"],
    ] {
        let out = std::process::Command::new("git")
            .args(&args)
            .current_dir(&repo)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {:?}", args);
    }
    std::fs::write(repo.join("README.md"), "fixture\n").unwrap();
    for args in [vec!["add", "."], vec!["commit", "-m", "initial"]] {
        let out = std::process::Command::new("git")
            .args(&args)
            .current_dir(&repo)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {:?}: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    let pf = create_plan(&home.plans_dir(), plan_opts("Add Worktree Plan", vec![])).unwrap();
    let plan_id = pf.id().to_string();

    let stdout = home.run_ok(&[
        "plan",
        "add-worktree",
        &plan_id,
        repo.to_str().unwrap(),
        "--base",
        "main",
    ]);

    // ExecutePlan's failure path quotes both of these lines verbatim.
    let expected_worktree = PathBuf::from(&pf.folder_path)
        .join("Worktrees")
        .join("repo");
    assert!(
        stdout.contains(&format!(
            "Worktree created: {}",
            expected_worktree.display()
        )),
        "stdout: {}",
        stdout
    );
    assert!(
        stdout.contains(&format!("Branch: tendril/{}", pf.folder_name)),
        "stdout: {}",
        stdout
    );

    // A worktree with no `.git` file is unusable downstream, so the command guarantees one.
    assert!(expected_worktree.join(".git").is_file());

    // The repo is recorded on the plan, so the plan knows which repos it has worktrees for.
    let plan = read_plan_file(&PathBuf::from(&pf.folder_path)).unwrap();
    assert_eq!(
        plan.metadata.repos,
        vec![repo.to_string_lossy().to_string()]
    );

    // Clean up the worktree so the temp dir removal on drop leaves no registration behind.
    let _ = home.run(&["plan", "remove-worktree", &plan_id, "repo"]);
}

/// A bare plan number is stored as the canonical folder name, so `42` and `00042-Foo` cannot end up
/// on the same plan as two different dependencies.
#[tokio::test]
async fn test_plan_add_depends_on_stores_canonical_folder_name() {
    let server = start_test_server().await;

    let target = create_plan(
        &server.state.plans_dir,
        CreatePlanOptions {
            title: "Dependency Target".to_string(),
            project: "test-proj".to_string(),
            level: Some("Feature".to_string()),
            initial_prompt: None,
            source_url: None,
            execution_profile: None,
            priority: Some(0),
            repos: vec![],
            verifications: vec![],
            depends_on: vec![],
            related_plans: vec![],
            chat_session_id: None,
        },
    )
    .unwrap();

    let pf = create_plan(
        &server.state.plans_dir,
        CreatePlanOptions {
            title: "Dependent Plan".to_string(),
            project: "test-proj".to_string(),
            level: Some("Feature".to_string()),
            initial_prompt: None,
            source_url: None,
            execution_profile: None,
            priority: Some(0),
            repos: vec![],
            verifications: vec![],
            depends_on: vec![],
            related_plans: vec![],
            chat_session_id: None,
        },
    )
    .unwrap();

    let args = PlanAddDependsOnArgs {
        plan_id: pf.id().to_string(),
        folder: target.id().to_string(),
        reason: None,
        chat_session: None,
    };

    handle_plan_command(PlanCommands::AddDependsOn(args), &server.tendril_home)
        .await
        .expect("handle_plan_command AddDependsOn");

    let (plan, _) = read_plan_yaml(std::path::Path::new(&pf.folder_path)).unwrap();
    assert_eq!(plan.depends_on, vec![target.folder_name.clone()]);
}

/// Removing a repo that was never attached has to fail: reporting success would let a caller believe
/// the plan no longer covers that repo.
#[tokio::test]
async fn test_plan_remove_repo_fails_when_not_attached() {
    let server = start_test_server().await;

    let pf = create_plan(
        &server.state.plans_dir,
        CreatePlanOptions {
            title: "Repo Removal Plan".to_string(),
            project: "test-proj".to_string(),
            level: Some("Feature".to_string()),
            initial_prompt: None,
            source_url: None,
            execution_profile: None,
            priority: Some(0),
            repos: vec!["/tmp/attached-repo".to_string()],
            verifications: vec![],
            depends_on: vec![],
            related_plans: vec![],
            chat_session_id: None,
        },
    )
    .unwrap();

    let args = PlanRemoveRepoArgs {
        plan_id: pf.id().to_string(),
        path: "/tmp/never-attached".to_string(),
        reason: None,
        chat_session: None,
    };

    let err = handle_plan_command(PlanCommands::RemoveRepo(args), &server.tendril_home)
        .await
        .expect_err("removing an unattached repo must not report success");
    assert!(
        err.to_string()
            .contains("Repository not found in plan: /tmp/never-attached"),
        "got: {}",
        err
    );

    let (plan, _) = read_plan_yaml(std::path::Path::new(&pf.folder_path)).unwrap();
    assert_eq!(plan.repos, vec!["/tmp/attached-repo".to_string()]);
}

// ---------------------------------------------------------------------------
// Recommendations
//
// The CLI is the surface ExecutePlan drives recommendations through, so every mutating subcommand has
// to leave `plan.yaml` and the `Recommendations` projection agreeing. The cross-plan read comes from
// the projection alone, so a mutation that forgets to sync is invisible until that view is wrong.
// ---------------------------------------------------------------------------

fn rec_plan_opts(title: &str, project: &str) -> CreatePlanOptions {
    CreatePlanOptions {
        title: title.to_string(),
        project: project.to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    }
}

async fn run_rec(server: &TestServer, cmd: PlanRecCommands) {
    handle_plan_command(PlanCommands::Rec(cmd), &server.tendril_home)
        .await
        .expect("handle_plan_command Rec");
}

/// `plan.yaml`'s only recommendation.
fn yaml_rec(folder: &Path) -> tendril_core::models::Recommendation {
    let recs = list_recommendations(folder).expect("list recommendations");
    assert_eq!(recs.len(), 1, "expected exactly one recommendation");
    recs.into_iter().next().unwrap()
}

/// The projected row for one recommendation, or `None` when the table never got it.
fn db_rec(tendril_home: &Path, plan_id: i32, title: &str) -> Option<RecommendationRow> {
    let conn = open_database(&get_database_path(tendril_home)).expect("open database");
    get_recommendations(&conn, None, None)
        .expect("query recommendations")
        .into_iter()
        .find(|r| r.plan_id == plan_id && r.title == title)
}

/// Editing content — not just state — is what the CLI could not do at all before, and every edit has
/// to land in the projection too.
#[tokio::test]
async fn test_plan_rec_set_edits_both_plan_yaml_and_the_database_row() {
    let server = start_test_server().await;
    let pf = create_plan(
        &server.state.plans_dir,
        rec_plan_opts("Recommendation Editing Plan", "test-proj"),
    )
    .unwrap();
    let folder = PathBuf::from(&pf.folder_path);
    let plan_id = pf.id();

    run_rec(
        &server,
        PlanRecCommands::Add {
            plan_id: plan_id.to_string(),
            title: "Add Jobs Index".to_string(),
            description: "Index the jobs table".to_string(),
            impact: Some("Small".to_string()),
            edit: PlanEditReasonArgs::default(),
        },
    )
    .await;

    let row = db_rec(&server.tendril_home, plan_id, "Add Jobs Index")
        .expect("adding a recommendation must project it");
    assert_eq!(row.description, "Index the jobs table");
    assert_eq!(row.state, RecommendationStatus::PENDING);
    assert_eq!(row.project, "test-proj");

    run_rec(
        &server,
        PlanRecCommands::Set {
            plan_id: plan_id.to_string(),
            title: "Add Jobs Index".to_string(),
            field: "description".to_string(),
            value: "Index Jobs(Status, Created)".to_string(),
            edit: PlanEditReasonArgs::default(),
        },
    )
    .await;
    assert_eq!(yaml_rec(&folder).description, "Index Jobs(Status, Created)");
    assert_eq!(
        db_rec(&server.tendril_home, plan_id, "Add Jobs Index")
            .expect("row after edit")
            .description,
        "Index Jobs(Status, Created)"
    );

    run_rec(
        &server,
        PlanRecCommands::Set {
            plan_id: plan_id.to_string(),
            title: "Add Jobs Index".to_string(),
            field: "impact".to_string(),
            value: "High".to_string(),
            edit: PlanEditReasonArgs::default(),
        },
    )
    .await;
    assert_eq!(yaml_rec(&folder).impact.as_deref(), Some("High"));
    assert_eq!(
        db_rec(&server.tendril_home, plan_id, "Add Jobs Index")
            .expect("row after impact edit")
            .impact
            .as_deref(),
        Some("High")
    );

    // A rename changes the row's own key, so the pre-rename row has to go rather than
    // be left behind next to the new one.
    run_rec(
        &server,
        PlanRecCommands::Set {
            plan_id: plan_id.to_string(),
            title: "Add Jobs Index".to_string(),
            field: "title".to_string(),
            value: "Add A Jobs Status Index".to_string(),
            edit: PlanEditReasonArgs::default(),
        },
    )
    .await;
    assert_eq!(yaml_rec(&folder).title, "Add A Jobs Status Index");
    assert!(
        db_rec(&server.tendril_home, plan_id, "Add Jobs Index").is_none(),
        "the pre-rename row must not survive in the projection"
    );
    let renamed = db_rec(&server.tendril_home, plan_id, "Add A Jobs Status Index")
        .expect("row under the new title");
    assert_eq!(renamed.impact.as_deref(), Some("High"));

    // An unknown field has to fail rather than silently do nothing.
    let err = handle_plan_command(
        PlanCommands::Rec(PlanRecCommands::Set {
            plan_id: plan_id.to_string(),
            title: "Add A Jobs Status Index".to_string(),
            field: "urgency".to_string(),
            value: "later".to_string(),
            edit: PlanEditReasonArgs::default(),
        }),
        &server.tendril_home,
    )
    .await
    .expect_err("an unknown field must not report success");
    assert!(err.to_string().contains("urgency"), "got: {}", err);
}

/// An accept note and a decline reason are different facts, and the CLI is where the app's old habit
/// of storing one in the other would be re-introduced.
#[tokio::test]
async fn test_plan_rec_accept_and_decline_keep_notes_and_reasons_apart() {
    let server = start_test_server().await;
    let pf = create_plan(
        &server.state.plans_dir,
        rec_plan_opts("Recommendation States Plan", "test-proj"),
    )
    .unwrap();
    let folder = PathBuf::from(&pf.folder_path);
    let plan_id = pf.id();

    run_rec(
        &server,
        PlanRecCommands::Add {
            plan_id: plan_id.to_string(),
            title: "Batch The Writes".to_string(),
            description: "Coalesce inbox writes".to_string(),
            impact: None,
            edit: PlanEditReasonArgs::default(),
        },
    )
    .await;

    // A bare accept is a plain `Accepted`: no notes means no note-bearing state.
    run_rec(
        &server,
        PlanRecCommands::Accept {
            plan_id: plan_id.to_string(),
            title: "Batch The Writes".to_string(),
            notes: None,
            edit: PlanEditReasonArgs::default(),
        },
    )
    .await;
    let rec = yaml_rec(&folder);
    assert_eq!(rec.state, RecommendationStatus::ACCEPTED);
    assert_eq!(rec.notes, None);
    let row = db_rec(&server.tendril_home, plan_id, "Batch The Writes").expect("row after accept");
    assert_eq!(row.state, RecommendationStatus::ACCEPTED);
    assert_eq!(row.notes, None);

    run_rec(
        &server,
        PlanRecCommands::Accept {
            plan_id: plan_id.to_string(),
            title: "Batch The Writes".to_string(),
            notes: Some("Do it with the queue rewrite".to_string()),
            edit: PlanEditReasonArgs::default(),
        },
    )
    .await;
    let rec = yaml_rec(&folder);
    assert_eq!(rec.state, RecommendationStatus::ACCEPTED_WITH_NOTES);
    assert_eq!(rec.notes.as_deref(), Some("Do it with the queue rewrite"));
    assert_eq!(rec.decline_reason, None);
    let row = db_rec(&server.tendril_home, plan_id, "Batch The Writes").expect("row after notes");
    assert_eq!(row.state, RecommendationStatus::ACCEPTED_WITH_NOTES);
    assert_eq!(row.notes.as_deref(), Some("Do it with the queue rewrite"));
    assert_eq!(row.decline_reason, None);

    run_rec(
        &server,
        PlanRecCommands::Decline {
            plan_id: plan_id.to_string(),
            title: "Batch The Writes".to_string(),
            reason: Some("Superseded by partitioning".to_string()),
            edit_reason: None,
            chat_session: None,
        },
    )
    .await;
    let rec = yaml_rec(&folder);
    assert_eq!(rec.state, RecommendationStatus::DECLINED);
    assert_eq!(
        rec.decline_reason.as_deref(),
        Some("Superseded by partitioning")
    );
    assert_eq!(
        rec.notes, None,
        "the accept note must not linger on a declined recommendation"
    );
    let row = db_rec(&server.tendril_home, plan_id, "Batch The Writes").expect("row after decline");
    assert_eq!(row.state, RecommendationStatus::DECLINED);
    assert_eq!(
        row.decline_reason.as_deref(),
        Some("Superseded by partitioning")
    );
    assert_eq!(row.notes, None);

    run_rec(
        &server,
        PlanRecCommands::Remove {
            plan_id: plan_id.to_string(),
            title: "Batch The Writes".to_string(),
            edit: PlanEditReasonArgs::default(),
        },
    )
    .await;
    assert!(
        list_recommendations(&folder).unwrap().is_empty(),
        "the recommendation must be gone from plan.yaml"
    );
    assert!(
        db_rec(&server.tendril_home, plan_id, "Batch The Writes").is_none(),
        "removing a recommendation must unproject it too"
    );
}

/// `rec decline` spells the decline reason `--reason`, so its notification reason is `--edit-reason`.
/// The two must reach different places: one into `plan.yaml`, one into the watching chat sessions.
#[tokio::test]
async fn test_plan_rec_decline_separates_the_decline_reason_from_the_edit_reason() {
    let server = start_test_server().await;
    let session = server
        .state
        .chat_manager
        .create_session(
            Some("Rec Review Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let mut opts = rec_plan_opts("Recommendation Reason Plan", "test-proj");
    opts.chat_session_id = Some(session.id.clone());
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();
    let folder = PathBuf::from(&pf.folder_path);

    run_rec(
        &server,
        PlanRecCommands::Add {
            plan_id: pf.id().to_string(),
            title: "Rewrite The Poller".to_string(),
            description: "Replace polling with a watch".to_string(),
            impact: Some("Medium".to_string()),
            edit: PlanEditReasonArgs {
                reason: Some("Found while reading the scheduler".to_string()),
                chat_session: Some("some-other-session".to_string()),
            },
        },
    )
    .await;

    run_rec(
        &server,
        PlanRecCommands::Decline {
            plan_id: pf.id().to_string(),
            title: "Rewrite The Poller".to_string(),
            reason: Some("The watch API is not stable yet".to_string()),
            edit_reason: Some("Operator decision on the review call".to_string()),
            chat_session: Some("some-other-session".to_string()),
        },
    )
    .await;

    let rec = yaml_rec(&folder);
    assert_eq!(
        rec.decline_reason.as_deref(),
        Some("The watch API is not stable yet"),
        "--reason is the decline reason and belongs in plan.yaml"
    );

    let sess_after = server
        .state
        .chat_manager
        .get_session(&session.id)
        .await
        .unwrap();
    assert_eq!(
        sess_after.messages.len(),
        2,
        "both the add and the decline must report themselves"
    );
    assert!(
        sess_after.messages[0]
            .content
            .contains("recommendation 'Rewrite The Poller' added"),
        "got: {}",
        sess_after.messages[0].content
    );
    assert!(
        sess_after.messages[0]
            .content
            .contains("Reason: Found while reading the scheduler."),
        "got: {}",
        sess_after.messages[0].content
    );
    let declined = &sess_after.messages[1].content;
    assert!(
        declined.contains("recommendation 'Rewrite The Poller' declined"),
        "got: {}",
        declined
    );
    assert!(
        declined.contains("Reason: Operator decision on the review call."),
        "--edit-reason is the notification reason, got: {}",
        declined
    );
    assert!(
        !declined.contains("The watch API is not stable yet"),
        "the decline reason must not be reported as the edit reason, got: {}",
        declined
    );
}

/// A `Parser` over the plan subcommand tree, so the flag spellings can be checked as an operator
/// types them rather than as a struct literal.
#[derive(Parser)]
struct PlanCli {
    #[command(subcommand)]
    command: PlanCommands,
}

fn parse_rec(args: &[&str]) -> PlanRecCommands {
    let mut argv = vec!["tendril", "rec"];
    argv.extend_from_slice(args);
    match PlanCli::try_parse_from(argv)
        .expect("parse rec command")
        .command
    {
        PlanCommands::Rec(cmd) => cmd,
        _ => panic!("expected a rec subcommand"),
    }
}

/// Every mutating recommendation subcommand takes the same `--reason` / `--chat-session` pair as the
/// rest of `tendril plan`, so an edit can explain itself. `decline` is the exception by necessity:
/// there `--reason` is the decline reason it has always been.
#[test]
fn plan_rec_subcommands_take_reason_and_chat_session() {
    match parse_rec(&[
        "add",
        "00588",
        "Add Jobs Index",
        "--description",
        "Index the jobs table",
        "--impact",
        "High",
        "--reason",
        "Spotted during execution",
        "--chat-session",
        "sess-1",
    ]) {
        PlanRecCommands::Add {
            plan_id,
            title,
            description,
            impact,
            edit,
        } => {
            assert_eq!(plan_id, "00588");
            assert_eq!(title, "Add Jobs Index");
            assert_eq!(description, "Index the jobs table");
            assert_eq!(impact.as_deref(), Some("High"));
            assert_eq!(edit.reason.as_deref(), Some("Spotted during execution"));
            assert_eq!(edit.chat_session.as_deref(), Some("sess-1"));
        }
        _ => panic!("expected Add"),
    }

    match parse_rec(&[
        "set",
        "00588",
        "Add Jobs Index",
        "description",
        "Index Jobs(Status)",
        "--reason",
        "Sharpened the wording",
        "--chat-session",
        "sess-2",
    ]) {
        PlanRecCommands::Set {
            plan_id,
            title,
            field,
            value,
            edit,
        } => {
            assert_eq!(plan_id, "00588");
            assert_eq!(title, "Add Jobs Index");
            assert_eq!(field, "description");
            assert_eq!(value, "Index Jobs(Status)");
            assert_eq!(edit.reason.as_deref(), Some("Sharpened the wording"));
            assert_eq!(edit.chat_session.as_deref(), Some("sess-2"));
        }
        _ => panic!("expected Set"),
    }

    match parse_rec(&[
        "accept",
        "00588",
        "Add Jobs Index",
        "--notes",
        "After the 0.2 migration",
        "--reason",
        "Agreed on the review call",
        "--chat-session",
        "sess-3",
    ]) {
        PlanRecCommands::Accept {
            title, notes, edit, ..
        } => {
            assert_eq!(title, "Add Jobs Index");
            assert_eq!(notes.as_deref(), Some("After the 0.2 migration"));
            assert_eq!(edit.reason.as_deref(), Some("Agreed on the review call"));
            assert_eq!(edit.chat_session.as_deref(), Some("sess-3"));
        }
        _ => panic!("expected Accept"),
    }

    match parse_rec(&[
        "decline",
        "00588",
        "Add Jobs Index",
        "--reason",
        "Out of scope",
        "--edit-reason",
        "Operator decision",
        "--chat-session",
        "sess-4",
    ]) {
        PlanRecCommands::Decline {
            reason,
            edit_reason,
            chat_session,
            ..
        } => {
            assert_eq!(reason.as_deref(), Some("Out of scope"));
            assert_eq!(edit_reason.as_deref(), Some("Operator decision"));
            assert_eq!(chat_session.as_deref(), Some("sess-4"));
        }
        _ => panic!("expected Decline"),
    }

    match parse_rec(&[
        "remove",
        "00588",
        "Add Jobs Index",
        "--reason",
        "Duplicated 00590's",
        "--chat-session",
        "sess-5",
    ]) {
        PlanRecCommands::Remove { title, edit, .. } => {
            assert_eq!(title, "Add Jobs Index");
            assert_eq!(edit.reason.as_deref(), Some("Duplicated 00590's"));
            assert_eq!(edit.chat_session.as_deref(), Some("sess-5"));
        }
        _ => panic!("expected Remove"),
    }

    // The read commands take filters instead, and `rebuild` takes nothing at all.
    match parse_rec(&["list", "00588", "--state", "AcceptedWithNotes"]) {
        PlanRecCommands::List { plan_id, state } => {
            assert_eq!(plan_id, "00588");
            assert_eq!(state.as_deref(), Some("AcceptedWithNotes"));
        }
        _ => panic!("expected List"),
    }
    match parse_rec(&["all", "--project", "TendrilService", "--state", "Pending"]) {
        PlanRecCommands::All { project, state } => {
            assert_eq!(project.as_deref(), Some("TendrilService"));
            assert_eq!(state.as_deref(), Some("Pending"));
        }
        _ => panic!("expected All"),
    }
    assert!(matches!(parse_rec(&["rebuild"]), PlanRecCommands::Rebuild));

    // `rec accept --notes` without a value is a mistake, not an empty note.
    assert!(
        PlanCli::try_parse_from(["tendril", "rec", "accept", "00588", "Title", "--notes"]).is_err(),
        "--notes must require a value"
    );
}

// The recommendation *reads* are stdout too — `rec list`, `rec all` and `rec rebuild` return nothing
// a caller can inspect — so they run the real binary through `CliHome` like the worktree tests above.

/// The per-plan listing is what an operator reads after execution, so the state filter has to narrow
/// it and the notes have to be visible rather than implied by the state name.
#[test]
fn plan_rec_list_filters_by_state_and_shows_notes() {
    let home = CliHome::new("rec-list");
    let pf = create_plan(
        &home.plans_dir(),
        rec_plan_opts("Rec Listing Plan", "ProjA"),
    )
    .unwrap();
    let id = pf.id().to_string();

    for (title, description) in [
        ("Add Jobs Index", "Index the jobs table"),
        ("Cache Results", "Memoize the hot query"),
        ("Rewrite The Poller", "Watch instead of poll"),
    ] {
        home.run_ok(&[
            "plan",
            "rec",
            "add",
            &id,
            title,
            "--description",
            description,
        ]);
    }
    home.run_ok(&[
        "plan",
        "rec",
        "accept",
        &id,
        "Cache Results",
        "--notes",
        "After the 0.2 migration",
    ]);
    home.run_ok(&[
        "plan",
        "rec",
        "decline",
        &id,
        "Rewrite The Poller",
        "--reason",
        "Watch API is unstable",
    ]);

    let all = home.run_ok(&["plan", "rec", "list", &id]);
    assert!(all.contains("Add Jobs Index"), "got: {}", all);
    assert!(all.contains("Cache Results"), "got: {}", all);
    assert!(all.contains("Rewrite The Poller"), "got: {}", all);
    assert!(
        all.contains("notes: After the 0.2 migration"),
        "got: {}",
        all
    );
    assert!(
        all.contains("declineReason: Watch API is unstable"),
        "got: {}",
        all
    );

    let with_notes = home.run_ok(&["plan", "rec", "list", &id, "--state=AcceptedWithNotes"]);
    assert!(with_notes.contains("Cache Results"), "got: {}", with_notes);
    assert!(
        !with_notes.contains("Add Jobs Index") && !with_notes.contains("Rewrite The Poller"),
        "the filter must exclude the other states, got: {}",
        with_notes
    );

    let pending = home.run_ok(&["plan", "rec", "list", &id, "--state=pending"]);
    assert!(pending.contains("Add Jobs Index"), "got: {}", pending);
    assert!(!pending.contains("Cache Results"), "got: {}", pending);

    // A state nobody has is a typo, not an empty list.
    let out = home.run(&["plan", "rec", "list", &id, "--state=Maybe"]);
    assert!(!out.status.success(), "an invalid state must fail");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Invalid recommendation state"),
        "got: {}",
        stderr
    );
}

/// `rec all` is the read no single `plan.yaml` can answer, so it is what proves the projection is
/// being written at all — and `rec rebuild` proves it can be reconstructed from the folders on disk.
#[test]
fn plan_rec_all_spans_plans_and_rebuild_reports_what_it_wrote() {
    let home = CliHome::new("rec-all");
    let first = create_plan(&home.plans_dir(), rec_plan_opts("Scheduler Plan", "ProjA")).unwrap();
    let second = create_plan(&home.plans_dir(), rec_plan_opts("Inbox Plan", "ProjB")).unwrap();
    let first_id = first.id().to_string();
    let second_id = second.id().to_string();

    home.run_ok(&[
        "plan",
        "rec",
        "add",
        &first_id,
        "Add Jobs Index",
        "--description",
        "Index the jobs table",
        "--impact",
        "High",
    ]);
    home.run_ok(&[
        "plan",
        "rec",
        "add",
        &second_id,
        "Batch The Writes",
        "--description",
        "Coalesce inbox writes",
        "--impact",
        "Small",
    ]);
    home.run_ok(&[
        "plan",
        "rec",
        "accept",
        &second_id,
        "Batch The Writes",
        "--notes",
        "With the queue rewrite",
    ]);

    let all = home.run_ok(&["plan", "rec", "all"]);
    assert!(all.contains("Add Jobs Index"), "got: {}", all);
    assert!(all.contains("Batch The Writes"), "got: {}", all);
    assert!(all.contains(&first.folder_name), "got: {}", all);
    assert!(all.contains(&second.folder_name), "got: {}", all);
    assert!(
        all.contains("High"),
        "the impact belongs in the line, got: {}",
        all
    );

    let proj_b = home.run_ok(&["plan", "rec", "all", "--project", "ProjB"]);
    assert!(proj_b.contains("Batch The Writes"), "got: {}", proj_b);
    assert!(!proj_b.contains("Add Jobs Index"), "got: {}", proj_b);

    let accepted = home.run_ok(&["plan", "rec", "all", "--state", "AcceptedWithNotes"]);
    assert!(accepted.contains("Batch The Writes"), "got: {}", accepted);
    assert!(!accepted.contains("Add Jobs Index"), "got: {}", accepted);

    let none = home.run_ok(&["plan", "rec", "all", "--project", "ProjC"]);
    assert!(none.contains("No recommendations."), "got: {}", none);

    let rebuilt = home.run_ok(&["plan", "rec", "rebuild"]);
    assert!(
        rebuilt.contains("Rebuilt 2 recommendation rows from 2 plans."),
        "rebuild must report what it wrote, got: {}",
        rebuilt
    );
    // Rebuilding changes nothing that was already correct.
    let after = home.run_ok(&["plan", "rec", "all"]);
    assert_eq!(after.lines().count(), 2, "got: {}", after);
}

// --- `plan list` filter validation (issue #135) -------------------------------------------------
//
// Every filter is validated before the scan. A filter that cannot be honoured must never degrade to
// "no filter": `--state Faild` used to turn "show me the failed plans" into "show me every plan",
// exit 0, which is the worst possible answer for a script or an agent.

/// Writes a plan folder with an explicit state, bypassing `plan create`.
fn write_plan_with(home: &CliHome, folder_name: &str, state: &str, repos: Vec<String>) -> PathBuf {
    let folder = home.plans_dir().join(folder_name);
    std::fs::create_dir_all(folder.join("Revisions")).unwrap();
    let plan = tendril_core::models::PlanYaml {
        title: folder_name.to_string(),
        state: state.to_string(),
        project: "list-proj".to_string(),
        repos,
        ..Default::default()
    };
    tendril_core::plans::write_plan_yaml(&folder, &plan).unwrap();
    folder
}

const SUPPORTED_STATES: [&str; 10] = [
    "Draft",
    "Creating",
    "Updating",
    "Executing",
    "Completed",
    "Failed",
    "Review",
    "Skipped",
    "Icebox",
    "Blocked",
];

#[test]
fn plan_list_rejects_an_unknown_state_instead_of_dropping_the_filter() {
    let home = CliHome::new("list-bad-state");
    write_plan_with(&home, "00001-Failed", "Failed", vec![]);
    write_plan_with(&home, "00002-Draft", "Draft", vec![]);

    for flag in ["--state", "--status"] {
        for bogus in ["Faild", "fail", "Done", ""] {
            let out = home.run(&["plan", "list", flag, bogus, "--format", "ids"]);
            assert_eq!(
                out.status.code(),
                Some(1),
                "{} {:?} must fail rather than list every plan: {}",
                flag,
                bogus,
                String::from_utf8_lossy(&out.stdout)
            );
            assert!(
                out.stdout.is_empty(),
                "a rejected filter must return no rows: {:?}",
                String::from_utf8_lossy(&out.stdout)
            );
            let stderr = String::from_utf8_lossy(&out.stderr);
            assert!(
                stderr.contains(&format!("Unknown plan state '{}'", bogus)),
                "stderr must name the state it rejected: {}",
                stderr
            );
            // The same vocabulary `GET /api/plans` returns in its 400 `supportedStates` list.
            for state in SUPPORTED_STATES {
                assert!(
                    stderr.contains(state),
                    "the supported-state list must include {}: {}",
                    state,
                    stderr
                );
            }
        }
    }

    // The filter still works, and it still works case-insensitively.
    for good in ["Failed", "failed", "FAILED"] {
        let ids = home.run_ok(&["plan", "list", "--state", good, "--format", "ids"]);
        assert_eq!(ids, "00001\n", "--state {} filtered wrongly", good);
    }
    assert_eq!(
        home.run_ok(&["plan", "list", "--format", "ids"])
            .lines()
            .count(),
        2,
        "no filter still lists everything"
    );
}

/// A mistyped `--plans-dir` printed an empty table and exited 0, which reads as "this home has no
/// plans" rather than "I looked in the wrong place".
#[test]
fn plan_list_rejects_a_plans_dir_that_does_not_exist() {
    let home = CliHome::new("list-bad-plans-dir");
    let missing = home.path.join("NoSuchDirectory");

    let out = home.run(&["plan", "list", "--plans-dir", missing.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Plans directory not found") && stderr.contains("NoSuchDirectory"),
        "stderr must name the directory it could not find: {}",
        stderr
    );

    // The default plans directory is deliberately *not* checked this way: a home that has not grown
    // a `Plans/` folder yet legitimately lists nothing.
    let bare = CliHome::new("list-no-plans-dir");
    std::fs::remove_dir_all(bare.plans_dir()).unwrap();
    let out = bare.run(&["plan", "list", "--format", "ids"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(out.stdout.is_empty());
}

/// `--limit 0` truncated the list to nothing while exiting 0 — indistinguishable from "no plans
/// match". It is now a usage error, which is exit 2.
#[test]
fn plan_list_rejects_a_zero_limit() {
    let home = CliHome::new("list-zero-limit");
    write_plan_with(&home, "00001-Draft", "Draft", vec![]);

    let out = home.run(&["plan", "list", "--limit", "0", "--format", "ids"]);
    assert_eq!(out.status.code(), Some(2), "a zero limit is a usage error");
    assert!(out.stdout.is_empty());

    assert_eq!(
        home.run_ok(&["plan", "list", "--limit", "1", "--format", "ids"]),
        "00001\n"
    );
}

// --- `plan validate` and `plan doctor` (issue #136) ---------------------------------------------

/// A plan whose `repos` point at a directory that does not exist is not valid — and until this was
/// fixed `plan validate` did not merely fail to *signal* it, it failed to *detect* it: it printed
/// "Plan is valid." and exited 0.
#[test]
fn plan_validate_detects_a_missing_repo_and_exits_1() {
    let home = CliHome::new("validate-missing-repo");
    let missing = home.path.join("no-such-repo");
    write_plan_with(
        &home,
        "00001-Broken",
        "Draft",
        vec![missing.to_string_lossy().to_string()],
    );

    let out = home.run(&["plan", "validate", "00001"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(1),
        "an invalid plan must be visible in $?: {}",
        stdout
    );
    assert!(
        stdout.contains("[Error] Repository path does not exist:")
            && stdout.contains("no-such-repo"),
        "the report names the path it could not find: {}",
        stdout
    );
    assert!(
        !stdout.contains("Plan is valid."),
        "an invalid plan must not be called valid: {}",
        stdout
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("1 error(s)"),
        "the summary counts the errors: {}",
        stderr
    );
}

/// The healthy case, and the warning case. Warnings do **not** gate: a missing `Revisions/` folder is
/// a note, not a reason to refuse to work with the plan.
#[test]
fn plan_validate_exits_0_for_a_valid_plan_and_for_warnings_only() {
    let home = CliHome::new("validate-ok");
    let repo = home.path.join("repo-one");
    std::fs::create_dir_all(&repo).unwrap();
    write_plan_with(
        &home,
        "00001-Fine",
        "Draft",
        vec![repo.to_string_lossy().to_string()],
    );
    assert_eq!(
        home.run_ok(&["plan", "validate", "00001"]),
        "Plan is valid.\n"
    );

    // Same plan, minus its Revisions directory: one Warning, still exit 0.
    std::fs::remove_dir_all(home.plans_dir().join("00001-Fine/Revisions")).unwrap();
    let out = home.run(&["plan", "validate", "00001"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "a warning must not gate: {}",
        stdout
    );
    assert!(
        stdout.contains("[Warning] Missing Revisions directory"),
        "{}",
        stdout
    );
}

/// A Completed plan is an archive: its repositories may legitimately have been moved or deleted since,
/// so the repo check is skipped for it — exactly as the schema-version check already is.
#[test]
fn plan_validate_does_not_fail_a_completed_plan_for_a_vanished_repo() {
    let home = CliHome::new("validate-completed");
    write_plan_with(
        &home,
        "00001-Done",
        "Completed",
        vec!["/tmp/tendril-nonexistent-archived-repo".to_string()],
    );
    assert_eq!(
        home.run_ok(&["plan", "validate", "00001"]),
        "Plan is valid.\n"
    );
}

/// `plan doctor` gates on the same rule across every plan: errors exit 1, warnings do not.
#[test]
fn plan_doctor_exits_1_when_any_plan_has_an_error() {
    let home = CliHome::new("doctor-errors");
    // A folder with no plan.yaml at all is an Error.
    std::fs::create_dir_all(home.plans_dir().join("00002-NoYaml")).unwrap();
    write_plan_with(&home, "00001-Fine", "Draft", vec![]);

    let out = home.run(&["plan", "doctor"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1), "{}", stdout);
    assert!(
        stdout.contains("00002-NoYaml: [Error] Missing plan.yaml"),
        "{}",
        stdout
    );
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("plan error(s) found"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Warnings alone stay exit 0.
    std::fs::remove_dir_all(home.plans_dir().join("00002-NoYaml")).unwrap();
    std::fs::remove_dir_all(home.plans_dir().join("00001-Fine/Revisions")).unwrap();
    let out = home.run(&["plan", "doctor"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{}", stdout);
    assert!(
        stdout.contains("[Warning] Missing Revisions directory"),
        "{}",
        stdout
    );
}

// --- `plan cleanup` (issue #134) ----------------------------------------------------------------

/// Creates a fake worktree directory under a plan, so cleanup has something to remove.
fn write_worktree(plan_folder: &Path, name: &str) -> PathBuf {
    let path = plan_folder.join("Worktrees").join(name);
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("file.txt"), b"content").unwrap();
    path
}

/// `plan cleanup` used to delete the worktrees of an actively executing plan out from under its
/// agent and exit 0. The terminal-state gate and `--force` are V1's, and a V1 script passing
/// `--force` used to fail to parse at all.
#[test]
fn plan_cleanup_refuses_a_non_terminal_plan_without_force() {
    let home = CliHome::new("cleanup-guard");

    for state in [
        "Draft",
        "Creating",
        "Updating",
        "Executing",
        "Review",
        "Blocked",
    ] {
        let folder = write_plan_with(&home, "00001-Live", state, vec![]);
        let worktree = write_worktree(&folder, "repo-one");

        let out = home.run(&["plan", "cleanup", "00001"]);
        assert_eq!(
            out.status.code(),
            Some(1),
            "state {} must be refused: {}",
            state,
            String::from_utf8_lossy(&out.stdout)
        );
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            stderr.contains(&format!(
                "Plan is not in a terminal state (current: {}). Use --force to override.",
                state
            )),
            "state {} stderr: {}",
            state,
            stderr
        );
        assert!(
            worktree.exists(),
            "state {}: the worktree must survive a refused cleanup",
            state
        );
        assert!(
            String::from_utf8_lossy(&out.stdout).is_empty(),
            "a refused cleanup must not claim success"
        );

        // `--force` is the documented override, and it does the work.
        let out = home.run(&["plan", "cleanup", "00001", "--force"]);
        assert_eq!(
            out.status.code(),
            Some(0),
            "--force must override: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(!worktree.exists(), "state {}: --force removes it", state);
        std::fs::remove_dir_all(&folder).unwrap();
    }
}

#[test]
fn plan_cleanup_allows_every_terminal_state_without_force() {
    let home = CliHome::new("cleanup-terminal");

    for state in ["Completed", "Failed", "Skipped", "Icebox"] {
        let folder = write_plan_with(&home, "00001-Done", state, vec![]);
        let worktree = write_worktree(&folder, "repo-one");

        let out = home.run(&["plan", "cleanup", "00001"]);
        assert_eq!(
            out.status.code(),
            Some(0),
            "state {} is terminal: {}",
            state,
            String::from_utf8_lossy(&out.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            "Worktrees cleaned up for plan 00001\n"
        );
        assert!(!worktree.exists(), "state {}: the worktree is gone", state);
        std::fs::remove_dir_all(&folder).unwrap();
    }
}

/// The other half of #134: `cleanup_worktrees` swallows every per-directory failure and returns
/// `Ok(())`, so "cleaned up" was printed even when nothing was removed. The command now looks again
/// and reports what survived.
///
/// Unix only: the failure is provoked by making `Worktrees/` unwritable, which is what stops
/// `remove_dir_all` from unlinking its children. Windows has no equivalent that is as cheap.
#[cfg(unix)]
#[test]
fn plan_cleanup_fails_when_a_worktree_survives() {
    use std::os::unix::fs::PermissionsExt;

    let home = CliHome::new("cleanup-survivor");
    let folder = write_plan_with(&home, "00001-Done", "Completed", vec![]);
    let worktree = write_worktree(&folder, "repo-one");
    let worktrees_dir = folder.join("Worktrees");

    // Read and traverse, but no unlinking of entries.
    std::fs::set_permissions(&worktrees_dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    let out = home.run(&["plan", "cleanup", "00001"]);
    std::fs::set_permissions(&worktrees_dir, std::fs::Permissions::from_mode(0o755)).unwrap();

    assert_eq!(
        out.status.code(),
        Some(1),
        "a cleanup that removed nothing must not report success: {}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert!(
        String::from_utf8_lossy(&out.stdout).is_empty(),
        "stdout: {}",
        String::from_utf8_lossy(&out.stdout)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("1 worktrees could not be removed."),
        "stderr must count the survivors: {}",
        stderr
    );
    assert!(
        stderr.contains("Could not remove worktree:") && stderr.contains("repo-one"),
        "stderr must name them: {}",
        stderr
    );
    assert!(
        worktree.exists(),
        "the worktree is still there, as reported"
    );
}

// ---------------------------------------------------------------------------
// Husk plans: detect, report, and prune only on request
// ---------------------------------------------------------------------------
//
// The operator's install held four plans. 00001 and 00002 are real (00002 is `Completed`, the
// negative control). 00003 and 00004 are husks left by a stop-all that killed their `CreatePlan`
// runs between `tendril plan create` and `tendril plan write-revision` -- both revision-less, but
// 00003 holds a wireframe the agent had already built and 00004 holds nothing at all. `plan doctor`
// must tell all four apart, and must not delete anything without being asked.

/// Ages a plan past the quiet period, so the sweep will judge it instead of assuming a live run.
///
/// A husk and a plan created five seconds ago are the same bytes on disk; the only difference is that
/// nobody is coming back for the husk. `classify_abandoned_husk` uses time as the proxy for that, so
/// a fixture has to be old to be judged at all -- which is itself the behaviour
/// `a_freshly_created_plan_is_not_reported_as_a_husk` pins down.
fn age_plan(folder: &Path, days: i64) {
    let when = chrono::Utc::now() - chrono::Duration::days(days);
    let (mut plan, _) = tendril_core::plans::read_plan_yaml(folder).unwrap();
    plan.updated = when;
    plan.created = when;
    tendril_core::plans::write_plan_yaml(folder, &plan).unwrap();

    // The folder's own mtime counts too, and writing the yaml just bumped it. `touch` rather than a
    // new dev-dependency for two lines in one test.
    let stamp = when.format("%Y%m%d%H%M").to_string();
    let ok = std::process::Command::new("touch")
        .arg("-t")
        .arg(&stamp)
        .arg(folder)
        .status()
        .expect("touch");
    assert!(ok.success(), "could not age {}", folder.display());
}

/// Builds the four plans from the operator's install.
fn write_the_operators_plans(home: &CliHome) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
    let real = write_plan_with(home, "00001-Real", "Draft", vec![]);
    std::fs::write(real.join("Revisions/001.md"), b"# Body").unwrap();

    let completed = write_plan_with(home, "00002-Completed", "Completed", vec![]);
    std::fs::write(completed.join("Revisions/001.md"), b"# Body").unwrap();

    // Revision-less, but the agent had already built a wireframe into it before it was killed.
    let with_work = write_plan_with(home, "00003-HasWork", "Draft", vec![]);
    std::fs::create_dir_all(with_work.join("Wireframes/editor")).unwrap();
    std::fs::write(with_work.join("Wireframes/editor/App.tsx"), b"export {}").unwrap();

    // Revision-less and empty: the scaffold and nothing else.
    let bare = write_plan_with(home, "00004-Bare", "Draft", vec![]);

    for folder in [&real, &completed, &with_work, &bare] {
        age_plan(folder, 7);
    }
    (real, completed, with_work, bare)
}

#[test]
fn plan_doctor_reports_the_two_husks_and_leaves_the_real_plans_alone() {
    let home = CliHome::new("doctor-husks");
    let (_real, _completed, with_work, bare) = write_the_operators_plans(&home);

    let out = home.run(&["plan", "doctor"]);
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert_eq!(
        out.status.code(),
        Some(0),
        "a husk is a Warning, not an Error: {}",
        stdout
    );
    assert!(
        stdout.contains("00004-Bare: [Warning] Plan has no revision and holds no work"),
        "the bare husk is reported as removable: {}",
        stdout
    );
    assert!(
        stdout.contains("00003-HasWork: [Warning] Plan has no revision but it contains Wireframes"),
        "the husk holding work is reported as *not* removable: {}",
        stdout
    );
    assert!(
        !stdout.contains("00001-Real: [Warning] Plan has no revision"),
        "a drafted plan is not a husk: {}",
        stdout
    );
    assert!(
        !stdout.contains("00002-Completed: [Warning] Plan has no revision"),
        "the negative control must never be reported: {}",
        stdout
    );

    // Reporting changes nothing on disk.
    assert!(bare.is_dir() && with_work.is_dir());
}

/// **The condition that separates a husk from a new plan.** A plan a live `CreatePlan` has just
/// created is revision-less and empty -- identical to 00004 -- and warning about it would mean every
/// plan is unhealthy for the minute after it is made.
#[test]
fn a_freshly_created_plan_is_not_reported_as_a_husk() {
    let home = CliHome::new("doctor-fresh-plan");
    // Written now, not aged: exactly what a job's `tendril plan create` leaves behind before it gets
    // as far as `write-revision`.
    let fresh = write_plan_with(&home, "00001-JustCreated", "Draft", vec![]);

    let stdout = home.run_ok(&["plan", "doctor"]);
    assert!(
        !stdout.contains("no revision"),
        "a plan a live job may still be drafting into must not be called a husk: {}",
        stdout
    );

    // And `--prune-husks` will not touch it either, which is the part that would destroy data.
    let pruned = home.run_ok(&["plan", "doctor", "--prune-husks"]);
    assert!(
        fresh.is_dir(),
        "pruning must not delete a plan created moments ago: {}",
        pruned
    );
    assert!(pruned.contains("No husk plans found."), "{}", pruned);
}

#[test]
fn prune_husks_removes_only_the_bare_husk_and_only_when_asked() {
    let home = CliHome::new("doctor-prune");
    let (real, completed, with_work, bare) = write_the_operators_plans(&home);

    // A dry run reports the same decision and removes nothing.
    let dry = home.run_ok(&["plan", "doctor", "--prune-husks", "--dry-run"]);
    assert!(
        dry.contains("Would remove husk plan 00004-Bare"),
        "dry run names what it would remove: {}",
        dry
    );
    assert!(
        dry.contains("Kept 00003-HasWork: it contains Wireframes"),
        "dry run says why it is keeping the other: {}",
        dry
    );
    assert!(bare.is_dir(), "a dry run removes nothing");

    let out = home.run_ok(&["plan", "doctor", "--prune-husks"]);
    assert!(out.contains("Removed husk plan 00004-Bare"), "{}", out);
    assert!(!bare.exists(), "the bare husk is gone: {}", out);
    assert!(
        with_work.join("Wireframes/editor/App.tsx").is_file(),
        "the wireframe the agent built survives a prune: {}",
        out
    );
    assert!(real.is_dir() && completed.is_dir(), "real plans survive");
}

/// `--dry-run` is meaningless on its own and must say so rather than silently running a full doctor.
#[test]
fn dry_run_without_prune_husks_is_rejected() {
    let home = CliHome::new("doctor-dry-run-alone");
    let out = home.run(&["plan", "doctor", "--dry-run"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("--dry-run only applies to --prune-husks"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
