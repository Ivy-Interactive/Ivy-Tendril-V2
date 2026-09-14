use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use tendril_cli::commands::plan::{
    handle_plan_command, PlanAddDependsOnArgs, PlanCommands, PlanRemoveRepoArgs, PlanSetArgs,
    PlanSetVerificationArgs, PlanWriteRevisionArgs,
};
use tendril_core::config::{
    generate_bearer_secret, get_config_path, load_config, save_config, MasterGuard,
};
use tendril_core::models::{
    PlanVerificationEntry, ProjectConfig, ProjectVerificationRef, VerificationStatus,
};
use tendril_core::plans::{create_plan, read_plan_file, read_plan_yaml, CreatePlanOptions};
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
