use std::path::{Path, PathBuf};
use std::sync::Arc;
use tendril_cli::commands::project::{
    handle_project_command, ProjectCommands, ProjectEnvFileCommands, ProjectPortCommands,
};
use tendril_core::config::{get_config_path, load_config};
use tendril_server::{create_router, AppState, MasterGuard};

struct TestServer {
    tendril_home: PathBuf,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
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
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = tendril_core::config::generate_bearer_secret();
    let _guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str).unwrap();

    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));
    let app = create_router(state);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _guard = _guard;
        let _ = axum::serve(tokio_listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    // Wait a brief moment for server to bind and be ready
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    TestServer {
        tendril_home,
        shutdown_tx: Some(shutdown_tx),
    }
}

#[tokio::test]
async fn test_project_cli_filesystem_fallback() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let cfg_path = get_config_path(&tendril_home);

    // 1. Add project
    handle_project_command(
        ProjectCommands::Add {
            name: "TestProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project via filesystem");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects.len(), 1);
    assert_eq!(cfg.projects[0].name, "TestProj");

    // 2. List projects
    handle_project_command(ProjectCommands::List, &tendril_home)
        .await
        .expect("List projects via filesystem");

    // 3. Get project
    handle_project_command(
        ProjectCommands::Get {
            name: "TestProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Get project via filesystem");

    // 4. AddRepo
    handle_project_command(
        ProjectCommands::AddRepo {
            name: "TestProj".to_string(),
            path: "/repos/test".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("AddRepo via filesystem");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].repos.len(), 1);
    assert_eq!(cfg.projects[0].repos[0].path, "/repos/test");

    // 5. AddVerification
    handle_project_command(
        ProjectCommands::AddVerification {
            name: "TestProj".to_string(),
            verification: "RustBuild".to_string(),
            required: false,
            optional: false,
            after: None,
        },
        &tendril_home,
    )
    .await
    .expect("AddVerification via filesystem");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].verifications.len(), 1);
    assert_eq!(cfg.projects[0].verifications[0].name, "RustBuild");
    assert!(cfg.projects[0].verifications[0].required);

    // 6. RemoveRepo
    handle_project_command(
        ProjectCommands::RemoveRepo {
            name: "TestProj".to_string(),
            path: "/repos/test".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("RemoveRepo via filesystem");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects[0].repos.is_empty());

    // 7. RemoveVerification
    handle_project_command(
        ProjectCommands::RemoveVerification {
            name: "TestProj".to_string(),
            verification: "RustBuild".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("RemoveVerification via filesystem");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects[0].verifications.is_empty());

    // 8. Remove project
    handle_project_command(
        ProjectCommands::Remove {
            name: "TestProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Remove project via filesystem");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects.is_empty());

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_project_cli_routed_through_daemon() {
    let server = start_test_server().await;
    let cfg_path = get_config_path(&server.tendril_home);

    // 1. Add project
    handle_project_command(
        ProjectCommands::Add {
            name: "DaemonProj".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Add project via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects.len(), 1);
    assert_eq!(cfg.projects[0].name, "DaemonProj");

    // 2. List projects
    handle_project_command(ProjectCommands::List, &server.tendril_home)
        .await
        .expect("List projects via daemon");

    // 3. Get project
    handle_project_command(
        ProjectCommands::Get {
            name: "DaemonProj".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Get project via daemon");

    // 4. AddRepo
    handle_project_command(
        ProjectCommands::AddRepo {
            name: "DaemonProj".to_string(),
            path: "/repos/daemon-repo".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("AddRepo via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].repos.len(), 1);
    assert_eq!(cfg.projects[0].repos[0].path, "/repos/daemon-repo");

    // 5. AddVerification
    handle_project_command(
        ProjectCommands::AddVerification {
            name: "DaemonProj".to_string(),
            verification: "Clippy".to_string(),
            required: false,
            optional: false,
            after: None,
        },
        &server.tendril_home,
    )
    .await
    .expect("AddVerification via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].verifications.len(), 1);
    assert_eq!(cfg.projects[0].verifications[0].name, "Clippy");
    assert!(cfg.projects[0].verifications[0].required);

    // 6. RemoveRepo
    handle_project_command(
        ProjectCommands::RemoveRepo {
            name: "DaemonProj".to_string(),
            path: "/repos/daemon-repo".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("RemoveRepo via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects[0].repos.is_empty());

    // 7. RemoveVerification
    handle_project_command(
        ProjectCommands::RemoveVerification {
            name: "DaemonProj".to_string(),
            verification: "Clippy".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("RemoveVerification via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects[0].verifications.is_empty());

    // 8. Remove project
    handle_project_command(
        ProjectCommands::Remove {
            name: "DaemonProj".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Remove project via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects.is_empty());
}

#[tokio::test]
async fn test_project_cli_error_handling() {
    let server = start_test_server().await;

    // Test 404 on non-existent project with daemon
    let err_get = handle_project_command(
        ProjectCommands::Get {
            name: "NonExistent".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert!(
        err_get
            .to_string()
            .contains("Project 'NonExistent' not found"),
        "Unexpected error: {}",
        err_get
    );

    let err_remove = handle_project_command(
        ProjectCommands::Remove {
            name: "NonExistent".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert!(
        err_remove
            .to_string()
            .contains("Project 'NonExistent' not found"),
        "Unexpected error: {}",
        err_remove
    );

    let err_repo = handle_project_command(
        ProjectCommands::AddRepo {
            name: "NonExistent".to_string(),
            path: "/some/path".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert!(
        err_repo
            .to_string()
            .contains("Project 'NonExistent' not found"),
        "Unexpected error: {}",
        err_repo
    );

    let err_ver = handle_project_command(
        ProjectCommands::AddVerification {
            name: "NonExistent".to_string(),
            verification: "RustBuild".to_string(),
            required: false,
            optional: false,
            after: None,
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert!(
        err_ver
            .to_string()
            .contains("Project 'NonExistent' not found"),
        "Unexpected error: {}",
        err_ver
    );

    // Test 409 on duplicate project add with daemon
    handle_project_command(
        ProjectCommands::Add {
            name: "DupProj".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .unwrap();

    let err_dup = handle_project_command(
        ProjectCommands::Add {
            name: "DupProj".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert!(
        err_dup
            .to_string()
            .contains("Project 'DupProj' already exists"),
        "Unexpected error: {}",
        err_dup
    );

    // Test errors without daemon (filesystem fallback)
    let fs_home = std::env::temp_dir().join(format!(
        "tendril-cli-err-fs-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&fs_home).unwrap();

    let err_fs_get = handle_project_command(
        ProjectCommands::Get {
            name: "NonExistent".to_string(),
        },
        &fs_home,
    )
    .await
    .unwrap_err();
    assert!(
        err_fs_get
            .to_string()
            .contains("Project 'NonExistent' not found"),
        "Unexpected error: {}",
        err_fs_get
    );

    handle_project_command(
        ProjectCommands::Add {
            name: "DupProj".to_string(),
        },
        &fs_home,
    )
    .await
    .unwrap();

    let err_fs_dup = handle_project_command(
        ProjectCommands::Add {
            name: "DupProj".to_string(),
        },
        &fs_home,
    )
    .await
    .unwrap_err();
    assert!(
        err_fs_dup
            .to_string()
            .contains("Project 'DupProj' already exists"),
        "Unexpected error: {}",
        err_fs_dup
    );

    let _ = std::fs::remove_dir_all(&fs_home);
}

#[tokio::test]
async fn test_project_cli_rename_filesystem_fallback() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-proj-rename-fs-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "ProjOrig".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    handle_project_command(
        ProjectCommands::Rename {
            name: "ProjOrig".to_string(),
            new_name: "ProjRenamed".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Rename project via fs");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects.len(), 1);
    assert_eq!(cfg.projects[0].name, "ProjRenamed");

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_project_cli_rename_routed_through_daemon() {
    let server = start_test_server().await;
    let cfg_path = get_config_path(&server.tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "DaemonProjOrig".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Add project via daemon");

    handle_project_command(
        ProjectCommands::Rename {
            name: "DaemonProjOrig".to_string(),
            new_name: "DaemonProjRenamed".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Rename project via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects.len(), 1);
    assert_eq!(cfg.projects[0].name, "DaemonProjRenamed");
}

#[tokio::test]
async fn test_project_cli_review_actions_filesystem() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-review-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "ReviewProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "ReviewProj".to_string(),
            action: "App".to_string(),
            command: "pnpm dev:app".to_string(),
            condition: "Test-Path src/apps/tendril-app".to_string(),
            paths: vec![],
            before: None,
            after: None,
        },
        &tendril_home,
    )
    .await
    .expect("Add review action App");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].review_actions.len(), 1);
    assert_eq!(cfg.projects[0].review_actions[0].name, "App");
    assert_eq!(cfg.projects[0].review_actions[0].command, "pnpm dev:app");
    assert_eq!(
        cfg.projects[0].review_actions[0].condition,
        "Test-Path src/apps/tendril-app"
    );

    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "ReviewProj".to_string(),
            action: "Server".to_string(),
            command: "cargo run".to_string(),
            condition: "".to_string(),
            paths: vec![],
            before: None,
            after: None,
        },
        &tendril_home,
    )
    .await
    .expect("Add review action Server");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].review_actions.len(), 2);

    handle_project_command(
        ProjectCommands::RemoveReviewAction {
            name: "ReviewProj".to_string(),
            action: "App".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Remove review action App");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].review_actions.len(), 1);
    assert_eq!(cfg.projects[0].review_actions[0].name, "Server");

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_project_cli_set_field_filesystem() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-set-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "SetProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    handle_project_command(
        ProjectCommands::Set {
            name: "SetProj".to_string(),
            field: "color".to_string(),
            value: "Purple".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Set color");

    handle_project_command(
        ProjectCommands::Set {
            name: "SetProj".to_string(),
            field: "context".to_string(),
            value: "Monorepo context".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Set context");

    handle_project_command(
        ProjectCommands::Set {
            name: "SetProj".to_string(),
            field: "stackHash".to_string(),
            value: "fe.ts:react/be.rs:axum".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Set stackHash");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].color, "Purple");
    assert_eq!(cfg.projects[0].context, "Monorepo context");
    assert_eq!(
        cfg.projects[0].stack_hash,
        Some("fe.ts:react/be.rs:axum".to_string())
    );

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_project_cli_review_actions_daemon() {
    let server = start_test_server().await;
    let cfg_path = get_config_path(&server.tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "DaemonReviewProj".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Add project via daemon");

    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "DaemonReviewProj".to_string(),
            action: "App".to_string(),
            command: "pnpm dev:app".to_string(),
            condition: "Test-Path src/apps/tendril-app".to_string(),
            paths: vec![],
            before: None,
            after: None,
        },
        &server.tendril_home,
    )
    .await
    .expect("Add review action via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].review_actions.len(), 1);
    assert_eq!(cfg.projects[0].review_actions[0].name, "App");
    assert_eq!(cfg.projects[0].review_actions[0].command, "pnpm dev:app");

    handle_project_command(
        ProjectCommands::RemoveReviewAction {
            name: "DaemonReviewProj".to_string(),
            action: "App".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Remove review action via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects[0].review_actions.is_empty());
}

#[tokio::test]
async fn test_project_cli_set_field_daemon() {
    let server = start_test_server().await;
    let cfg_path = get_config_path(&server.tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "DaemonSetProj".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Add project via daemon");

    handle_project_command(
        ProjectCommands::Set {
            name: "DaemonSetProj".to_string(),
            field: "color".to_string(),
            value: "Green".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Set color via daemon");

    handle_project_command(
        ProjectCommands::Set {
            name: "DaemonSetProj".to_string(),
            field: "context".to_string(),
            value: "Daemon test context".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Set context via daemon");

    handle_project_command(
        ProjectCommands::Set {
            name: "DaemonSetProj".to_string(),
            field: "stackHash".to_string(),
            value: "fe.ts:react".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Set stackHash via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].color, "Green");
    assert_eq!(cfg.projects[0].context, "Daemon test context");
    assert_eq!(cfg.projects[0].stack_hash, Some("fe.ts:react".to_string()));
}

// --- Verification ordering -------------------------------------------------------------------
//
// Verification order is run order: `CheckResult` has to be last, so `move-verification` and
// `add-verification --after` are how a caller says where an entry belongs. The daemon and
// filesystem paths share one `move_project_verification` helper precisely so they cannot drift,
// which is why every ordering assertion below runs through both.

/// A `TendrilHome` with no daemon behind it, so commands take the filesystem path.
struct FsHome {
    path: PathBuf,
}

impl Drop for FsHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

impl FsHome {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-cli-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

/// Runs `body` twice: once against a live daemon, once against a home with none.
async fn through_both_paths<F, Fut>(label: &str, body: F)
where
    F: Fn(PathBuf) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let server = start_test_server().await;
    body(server.tendril_home.clone()).await;
    drop(server);

    let fs_home = FsHome::new(label);
    body(fs_home.path.clone()).await;
}

/// Creates a project whose verifications are in exactly the given order.
async fn seed_project(tendril_home: &Path, project: &str, verifications: &[&str]) {
    handle_project_command(
        ProjectCommands::Add {
            name: project.to_string(),
        },
        tendril_home,
    )
    .await
    .expect("add project");

    for verification in verifications {
        handle_project_command(
            ProjectCommands::AddVerification {
                name: project.to_string(),
                verification: verification.to_string(),
                required: false,
                optional: false,
                after: None,
            },
            tendril_home,
        )
        .await
        .expect("seed verification");
    }
}

/// A project's verification names in configured order.
fn verification_names(tendril_home: &Path, project: &str) -> Vec<String> {
    let cfg = load_config(&get_config_path(tendril_home)).expect("load config");
    cfg.projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(project))
        .expect("project exists")
        .verifications
        .iter()
        .map(|v| v.name.clone())
        .collect()
}

async fn move_verification(
    tendril_home: &Path,
    project: &str,
    verification: &str,
    before: Option<&str>,
    after: Option<&str>,
    position: Option<usize>,
) -> anyhow::Result<()> {
    handle_project_command(
        ProjectCommands::MoveVerification {
            name: project.to_string(),
            verification: verification.to_string(),
            before: before.map(str::to_string),
            after: after.map(str::to_string),
            position,
        },
        tendril_home,
    )
    .await
}

#[tokio::test]
async fn move_verification_by_position() {
    through_both_paths("move-position", |home| async move {
        seed_project(
            &home,
            "Proj",
            &["NpmLint", "RustBuild", "RustTest", "CheckResult"],
        )
        .await;

        move_verification(&home, "Proj", "RustTest", None, None, Some(0))
            .await
            .expect("move to position 0");
        assert_eq!(
            verification_names(&home, "Proj"),
            ["RustTest", "NpmLint", "RustBuild", "CheckResult"]
        );

        // A position past the end clamps rather than failing.
        move_verification(&home, "Proj", "RustTest", None, None, Some(99))
            .await
            .expect("move past the end");
        assert_eq!(
            verification_names(&home, "Proj"),
            ["NpmLint", "RustBuild", "CheckResult", "RustTest"]
        );
    })
    .await;
}

#[tokio::test]
async fn move_verification_before() {
    through_both_paths("move-before", |home| async move {
        seed_project(
            &home,
            "Proj",
            &["NpmLint", "RustBuild", "RustTest", "CheckResult"],
        )
        .await;

        move_verification(&home, "Proj", "CheckResult", Some("RustBuild"), None, None)
            .await
            .expect("move before RustBuild");
        assert_eq!(
            verification_names(&home, "Proj"),
            ["NpmLint", "CheckResult", "RustBuild", "RustTest"]
        );
    })
    .await;
}

#[tokio::test]
async fn move_verification_after() {
    through_both_paths("move-after", |home| async move {
        seed_project(
            &home,
            "Proj",
            &["NpmLint", "RustBuild", "RustTest", "CheckResult"],
        )
        .await;

        // Moving an entry forward is the case that needs the index resolved against the list with
        // the entry already removed: without NpmLint, RustTest sits at 1, so NpmLint lands at 2.
        move_verification(&home, "Proj", "NpmLint", None, Some("RustTest"), None)
            .await
            .expect("move after RustTest");
        assert_eq!(
            verification_names(&home, "Proj"),
            ["RustBuild", "RustTest", "NpmLint", "CheckResult"]
        );

        // And backwards.
        move_verification(&home, "Proj", "CheckResult", None, Some("RustBuild"), None)
            .await
            .expect("move after RustBuild");
        assert_eq!(
            verification_names(&home, "Proj"),
            ["RustBuild", "CheckResult", "RustTest", "NpmLint"]
        );
    })
    .await;
}

#[tokio::test]
async fn move_verification_check_result_must_be_last() {
    through_both_paths("move-check-result", |home| async move {
        seed_project(
            &home,
            "ByPosition",
            &["NpmLint", "CheckResult", "RustBuild", "RustTest"],
        )
        .await;

        let len = verification_names(&home, "ByPosition").len();
        move_verification(
            &home,
            "ByPosition",
            "CheckResult",
            None,
            None,
            Some(len - 1),
        )
        .await
        .expect("move to the last position");
        assert_eq!(
            verification_names(&home, "ByPosition"),
            ["NpmLint", "RustBuild", "RustTest", "CheckResult"]
        );

        // The same destination expressed the other way round.
        seed_project(
            &home,
            "ByAfter",
            &["NpmLint", "CheckResult", "RustBuild", "RustTest"],
        )
        .await;

        move_verification(
            &home,
            "ByAfter",
            "CheckResult",
            None,
            Some("RustTest"),
            None,
        )
        .await
        .expect("move after the last entry");
        assert_eq!(
            verification_names(&home, "ByAfter"),
            ["NpmLint", "RustBuild", "RustTest", "CheckResult"]
        );
    })
    .await;
}

#[tokio::test]
async fn move_verification_requires_exactly_one_option() {
    through_both_paths("move-exclusive", |home| async move {
        seed_project(&home, "Proj", &["NpmLint", "CheckResult"]).await;

        let none_given = move_verification(&home, "Proj", "CheckResult", None, None, None).await;
        let two_given =
            move_verification(&home, "Proj", "CheckResult", Some("NpmLint"), None, Some(0)).await;

        for outcome in [none_given, two_given] {
            let message = outcome.expect_err("must be rejected").to_string();
            assert!(
                message.contains("Specify exactly one of --before, --after, or --position"),
                "unexpected error: {}",
                message
            );
        }

        assert_eq!(
            verification_names(&home, "Proj"),
            ["NpmLint", "CheckResult"]
        );
    })
    .await;
}

#[tokio::test]
async fn move_verification_unknown_target_leaves_order_unchanged() {
    through_both_paths("move-unknown", |home| async move {
        seed_project(&home, "Proj", &["NpmLint", "RustBuild", "CheckResult"]).await;
        let original = verification_names(&home, "Proj");

        let err = move_verification(
            &home,
            "Proj",
            "CheckResult",
            None,
            Some("NoSuchThing"),
            None,
        )
        .await
        .expect_err("an unknown --after target must fail");
        assert!(err.to_string().contains("--after"), "error: {}", err);

        let err = move_verification(&home, "Proj", "NoSuchThing", None, None, Some(0))
            .await
            .expect_err("moving a verification the project lacks must fail");
        assert!(
            err.to_string().contains("Verification not found"),
            "error: {}",
            err
        );

        assert_eq!(verification_names(&home, "Proj"), original);
    })
    .await;
}

#[tokio::test]
async fn add_verification_after_inserts_at_position() {
    through_both_paths("add-after", |home| async move {
        seed_project(&home, "Proj", &["NpmLint", "RustBuild", "CheckResult"]).await;

        handle_project_command(
            ProjectCommands::AddVerification {
                name: "Proj".to_string(),
                verification: "RustTest".to_string(),
                required: true,
                optional: false,
                after: Some("RustBuild".to_string()),
            },
            &home,
        )
        .await
        .expect("add after RustBuild");

        // Inserting rather than appending is what keeps CheckResult last.
        assert_eq!(
            verification_names(&home, "Proj"),
            ["NpmLint", "RustBuild", "RustTest", "CheckResult"]
        );
    })
    .await;
}

#[tokio::test]
async fn add_verification_optional_sets_required_false() {
    through_both_paths("add-optional", |home| async move {
        seed_project(&home, "Proj", &[]).await;

        handle_project_command(
            ProjectCommands::AddVerification {
                name: "Proj".to_string(),
                verification: "NpmLint".to_string(),
                required: false,
                optional: true,
                after: None,
            },
            &home,
        )
        .await
        .expect("add optional verification");

        // No flag at all still means required — only --optional changes that.
        handle_project_command(
            ProjectCommands::AddVerification {
                name: "Proj".to_string(),
                verification: "RustBuild".to_string(),
                required: false,
                optional: false,
                after: None,
            },
            &home,
        )
        .await
        .expect("add default verification");

        let cfg = load_config(&get_config_path(&home)).expect("load config");
        let proj = cfg
            .projects
            .iter()
            .find(|p| p.name == "Proj")
            .expect("project exists");
        assert_eq!(proj.verifications[0].name, "NpmLint");
        assert!(!proj.verifications[0].required);
        assert_eq!(proj.verifications[1].name, "RustBuild");
        assert!(proj.verifications[1].required);
    })
    .await;
}

#[tokio::test]
async fn project_port_add_list_remove() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-port-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "PortProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    handle_project_command(
        ProjectCommands::Port(ProjectPortCommands::Add {
            name: "PortProj".to_string(),
            port_name: "backend".to_string(),
            default_port: 3000,
            description: "API server".to_string(),
        }),
        &tendril_home,
    )
    .await
    .expect("Add port");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].ports.len(), 1);
    assert_eq!(cfg.projects[0].ports["backend"].default_port, 3000);
    assert_eq!(cfg.projects[0].ports["backend"].description, "API server");

    // Re-adding the same name upserts rather than duplicating.
    handle_project_command(
        ProjectCommands::Port(ProjectPortCommands::Add {
            name: "PortProj".to_string(),
            port_name: "backend".to_string(),
            default_port: 3100,
            description: "API server (moved)".to_string(),
        }),
        &tendril_home,
    )
    .await
    .expect("Update port");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].ports.len(), 1);
    assert_eq!(cfg.projects[0].ports["backend"].default_port, 3100);

    handle_project_command(
        ProjectCommands::Port(ProjectPortCommands::List {
            name: "PortProj".to_string(),
        }),
        &tendril_home,
    )
    .await
    .expect("List ports");

    let err = handle_project_command(
        ProjectCommands::Port(ProjectPortCommands::Remove {
            name: "PortProj".to_string(),
            port_name: "ghost".to_string(),
        }),
        &tendril_home,
    )
    .await
    .unwrap_err();
    assert!(
        err.to_string().contains("Port not found: ghost"),
        "Unexpected error: {}",
        err
    );

    handle_project_command(
        ProjectCommands::Port(ProjectPortCommands::Remove {
            name: "PortProj".to_string(),
            port_name: "backend".to_string(),
        }),
        &tendril_home,
    )
    .await
    .expect("Remove port");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects[0].ports.is_empty());

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn project_env_file_add_list_remove() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-env-file-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "EnvFileProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    handle_project_command(
        ProjectCommands::EnvFile(ProjectEnvFileCommands::Add {
            name: "EnvFileProj".to_string(),
            path: ".env".to_string(),
            template: Some(".env.example".to_string()),
            // A value may itself contain '=' — only the first one separates key from value.
            overrides: vec![
                "PORT=${ports.backend}".to_string(),
                "CONNECTION=Host=db;Port=5432".to_string(),
            ],
        }),
        &tendril_home,
    )
    .await
    .expect("Add env file");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].env_files.len(), 1);
    let file = &cfg.projects[0].env_files[0];
    assert_eq!(file.path, ".env");
    assert_eq!(file.template.as_deref(), Some(".env.example"));
    assert_eq!(file.overrides["PORT"], "${ports.backend}");
    assert_eq!(file.overrides["CONNECTION"], "Host=db;Port=5432");

    // Re-adding the same path replaces the entry instead of appending a second config for one file.
    handle_project_command(
        ProjectCommands::EnvFile(ProjectEnvFileCommands::Add {
            name: "EnvFileProj".to_string(),
            path: ".env".to_string(),
            template: None,
            overrides: vec!["MODE=test".to_string()],
        }),
        &tendril_home,
    )
    .await
    .expect("Update env file");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.projects[0].env_files.len(), 1);
    let file = &cfg.projects[0].env_files[0];
    assert!(file.template.is_none());
    assert_eq!(file.overrides.len(), 1);
    assert_eq!(file.overrides["MODE"], "test");

    handle_project_command(
        ProjectCommands::EnvFile(ProjectEnvFileCommands::List {
            name: "EnvFileProj".to_string(),
        }),
        &tendril_home,
    )
    .await
    .expect("List env files");

    let err = handle_project_command(
        ProjectCommands::EnvFile(ProjectEnvFileCommands::Add {
            name: "EnvFileProj".to_string(),
            path: ".env.local".to_string(),
            template: None,
            overrides: vec!["NOT_AN_ASSIGNMENT".to_string()],
        }),
        &tendril_home,
    )
    .await
    .unwrap_err();
    assert!(
        err.to_string().contains("Invalid override"),
        "Unexpected error: {}",
        err
    );

    let err = handle_project_command(
        ProjectCommands::EnvFile(ProjectEnvFileCommands::Remove {
            name: "EnvFileProj".to_string(),
            path: ".env.ghost".to_string(),
        }),
        &tendril_home,
    )
    .await
    .unwrap_err();
    assert!(
        err.to_string()
            .contains("Environment file not found: .env.ghost"),
        "Unexpected error: {}",
        err
    );

    handle_project_command(
        ProjectCommands::EnvFile(ProjectEnvFileCommands::Remove {
            name: "EnvFileProj".to_string(),
            path: ".env".to_string(),
        }),
        &tendril_home,
    )
    .await
    .expect("Remove env file");

    let cfg = load_config(&cfg_path).unwrap();
    assert!(cfg.projects[0].env_files.is_empty());

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_project_cli_add_review_action_persists_paths() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-review-paths-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "PathsProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "PathsProj".to_string(),
            action: "Storybook".to_string(),
            command: "pnpm storybook".to_string(),
            condition: "".to_string(),
            paths: vec![
                "src/packages/components".to_string(),
                "src/packages/ui".to_string(),
            ],
            before: None,
            after: None,
        },
        &tendril_home,
    )
    .await
    .expect("Add review action with paths");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(
        cfg.projects[0].review_actions[0].paths,
        vec![
            "src/packages/components".to_string(),
            "src/packages/ui".to_string()
        ]
    );

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_project_cli_add_review_action_before_and_after_positioning() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-review-order-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    handle_project_command(
        ProjectCommands::Add {
            name: "OrderProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    for action in ["App", "Server"] {
        handle_project_command(
            ProjectCommands::AddReviewAction {
                name: "OrderProj".to_string(),
                action: action.to_string(),
                command: "echo hi".to_string(),
                condition: "".to_string(),
                paths: vec![],
                before: None,
                after: None,
            },
            &tendril_home,
        )
        .await
        .expect("Add review action");
    }

    // Insert "Storybook" before "Server" -> App, Storybook, Server
    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "OrderProj".to_string(),
            action: "Storybook".to_string(),
            command: "pnpm storybook".to_string(),
            condition: "".to_string(),
            paths: vec![],
            before: Some("Server".to_string()),
            after: None,
        },
        &tendril_home,
    )
    .await
    .expect("Add review action before Server");

    let cfg = load_config(&cfg_path).unwrap();
    let names: Vec<&str> = cfg.projects[0]
        .review_actions
        .iter()
        .map(|a| a.name.as_str())
        .collect();
    assert_eq!(names, vec!["App", "Storybook", "Server"]);

    // Insert "Docs" after "App" -> App, Docs, Storybook, Server
    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "OrderProj".to_string(),
            action: "Docs".to_string(),
            command: "pnpm docs".to_string(),
            condition: "".to_string(),
            paths: vec![],
            before: None,
            after: Some("App".to_string()),
        },
        &tendril_home,
    )
    .await
    .expect("Add review action after App");

    let cfg = load_config(&cfg_path).unwrap();
    let names: Vec<&str> = cfg.projects[0]
        .review_actions
        .iter()
        .map(|a| a.name.as_str())
        .collect();
    assert_eq!(names, vec!["App", "Docs", "Storybook", "Server"]);

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_project_cli_add_review_action_unknown_before_target_errors() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-review-unknown-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    handle_project_command(
        ProjectCommands::Add {
            name: "UnknownTargetProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "UnknownTargetProj".to_string(),
            action: "App".to_string(),
            command: "echo hi".to_string(),
            condition: "".to_string(),
            paths: vec![],
            before: None,
            after: None,
        },
        &tendril_home,
    )
    .await
    .expect("Add review action App");

    let err = handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "UnknownTargetProj".to_string(),
            action: "Storybook".to_string(),
            command: "pnpm storybook".to_string(),
            condition: "".to_string(),
            paths: vec![],
            before: Some("DoesNotExist".to_string()),
            after: None,
        },
        &tendril_home,
    )
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("DoesNotExist"),
        "Unexpected error: {}",
        err
    );
    assert!(
        err.to_string().contains("Available: App"),
        "Unexpected error: {}",
        err
    );

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_project_cli_review_actions_ranks_by_changed_file() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-fs-review-rank-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    handle_project_command(
        ProjectCommands::Add {
            name: "RankProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add project");

    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "RankProj".to_string(),
            action: "App".to_string(),
            command: "pnpm dev:app".to_string(),
            condition: "".to_string(),
            paths: vec![],
            before: None,
            after: None,
        },
        &tendril_home,
    )
    .await
    .expect("Add review action App");

    handle_project_command(
        ProjectCommands::AddReviewAction {
            name: "RankProj".to_string(),
            action: "Storybook".to_string(),
            command: "pnpm storybook".to_string(),
            condition: "".to_string(),
            paths: vec!["src/packages/components".to_string()],
            before: None,
            after: None,
        },
        &tendril_home,
    )
    .await
    .expect("Add review action Storybook");

    // With a changed file under Storybook's scope, it should rank first.
    handle_project_command(
        ProjectCommands::ReviewActions {
            name: "RankProj".to_string(),
            changed_files: vec![
                "src/packages/components/src/stories/dialog.stories.tsx".to_string()
            ],
            plan: None,
            format: "table".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Rank review actions with changed file");

    // With no changed files (and no plan), falls back to configured order without erroring.
    handle_project_command(
        ProjectCommands::ReviewActions {
            name: "RankProj".to_string(),
            changed_files: vec![],
            plan: None,
            format: "json".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Rank review actions with no changed files falls back to configured order");

    // A --plan referencing a nonexistent plan should warn and fall back rather than fail.
    handle_project_command(
        ProjectCommands::ReviewActions {
            name: "RankProj".to_string(),
            changed_files: vec![],
            plan: Some("99999-DoesNotExist".to_string()),
            format: "table".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Rank review actions falls back to configured order when plan is missing");

    let _ = std::fs::remove_dir_all(&tendril_home);
}

// ---------------------------------------------------------------------------
// Build dependencies, MCP servers, skills, sync and the import verbs.
//
// The list verbs run through `through_both_paths` because the daemon arm and the filesystem arm
// share the mutation helpers and must agree; sync and the imports only ever take the filesystem
// arm, so they are exercised once each.
// ---------------------------------------------------------------------------

/// A project's config as written, for asserting on the new lists.
fn project_config(tendril_home: &Path, project: &str) -> tendril_core::models::ProjectConfig {
    load_config(&get_config_path(tendril_home))
        .expect("load config")
        .projects
        .into_iter()
        .find(|p| p.name.eq_ignore_ascii_case(project))
        .expect("project exists")
}

async fn add_project(tendril_home: &Path, project: &str) {
    handle_project_command(
        ProjectCommands::Add {
            name: project.to_string(),
        },
        tendril_home,
    )
    .await
    .expect("add project");
}

#[tokio::test]
async fn project_build_dep_add_and_remove() {
    through_both_paths("build-dep", |home| async move {
        add_project(&home, "Proj").await;

        handle_project_command(
            ProjectCommands::AddBuildDep {
                name: "Proj".to_string(),
                dependency: "Ivy-Framework".to_string(),
            },
            &home,
        )
        .await
        .expect("add build dependency");
        assert_eq!(
            project_config(&home, "Proj").build_dependencies,
            ["Ivy-Framework"]
        );

        // Case-insensitive: the same dependency in different case is still a duplicate.
        let duplicate = handle_project_command(
            ProjectCommands::AddBuildDep {
                name: "Proj".to_string(),
                dependency: "ivy-framework".to_string(),
            },
            &home,
        )
        .await;
        assert!(duplicate.is_err(), "duplicate build dependency accepted");
        assert_eq!(project_config(&home, "Proj").build_dependencies.len(), 1);

        handle_project_command(
            ProjectCommands::RemoveBuildDep {
                name: "Proj".to_string(),
                dependency: "IVY-FRAMEWORK".to_string(),
            },
            &home,
        )
        .await
        .expect("remove build dependency");
        assert!(project_config(&home, "Proj").build_dependencies.is_empty());

        let missing = handle_project_command(
            ProjectCommands::RemoveBuildDep {
                name: "Proj".to_string(),
                dependency: "Ivy-Framework".to_string(),
            },
            &home,
        )
        .await;
        assert!(missing.is_err(), "removing a missing dependency succeeded");
    })
    .await;
}

#[tokio::test]
async fn project_mcp_add_list_remove() {
    through_both_paths("mcp-verbs", |home| async move {
        add_project(&home, "Proj").await;

        handle_project_command(
            ProjectCommands::ListMcp {
                name: "Proj".to_string(),
            },
            &home,
        )
        .await
        .expect("list an empty MCP list");

        handle_project_command(
            ProjectCommands::AddMcp {
                name: "Proj".to_string(),
                server: "filesystem".to_string(),
                command: "npx".to_string(),
                arguments: vec!["-y".to_string(), "@mcp/filesystem".to_string()],
                environment: vec![
                    "ROOT=/tmp".to_string(),
                    // No '=' and a blank key are both dropped rather than stored.
                    "MALFORMED".to_string(),
                    "=orphan".to_string(),
                ],
            },
            &home,
        )
        .await
        .expect("add MCP server");

        let servers = project_config(&home, "Proj").mcp_servers;
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "filesystem");
        assert_eq!(servers[0].command, "npx");
        assert_eq!(servers[0].arguments, ["-y", "@mcp/filesystem"]);
        assert_eq!(servers[0].environment.len(), 1);
        assert_eq!(
            servers[0].environment.get("ROOT").map(String::as_str),
            Some("/tmp")
        );
        assert!(!servers[0].disabled);

        let duplicate = handle_project_command(
            ProjectCommands::AddMcp {
                name: "Proj".to_string(),
                server: "FILESYSTEM".to_string(),
                command: "uvx".to_string(),
                arguments: vec![],
                environment: vec![],
            },
            &home,
        )
        .await;
        assert!(duplicate.is_err(), "duplicate MCP server accepted");

        handle_project_command(
            ProjectCommands::ListMcp {
                name: "Proj".to_string(),
            },
            &home,
        )
        .await
        .expect("list MCP servers");

        handle_project_command(
            ProjectCommands::RemoveMcp {
                name: "Proj".to_string(),
                server: "filesystem".to_string(),
            },
            &home,
        )
        .await
        .expect("remove MCP server");
        assert!(project_config(&home, "Proj").mcp_servers.is_empty());

        let missing = handle_project_command(
            ProjectCommands::RemoveMcp {
                name: "Proj".to_string(),
                server: "filesystem".to_string(),
            },
            &home,
        )
        .await;
        assert!(missing.is_err(), "removing a missing MCP server succeeded");
    })
    .await;
}

#[tokio::test]
async fn project_skill_add_list_remove() {
    through_both_paths("skill-verbs", |home| async move {
        add_project(&home, "Proj").await;

        handle_project_command(
            ProjectCommands::ListSkills {
                name: "Proj".to_string(),
            },
            &home,
        )
        .await
        .expect("list an empty skill list");

        handle_project_command(
            ProjectCommands::AddSkill {
                name: "Proj".to_string(),
                skill: "review-checklist".to_string(),
                description: Some("How this project reviews changes".to_string()),
                path: None,
                // A blank string is stored as None, so the config never carries an empty field.
                instructions: Some("   ".to_string()),
            },
            &home,
        )
        .await
        .expect("add custom skill");

        let skills = project_config(&home, "Proj").skills;
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "review-checklist");
        assert_eq!(skills[0].description, "How this project reviews changes");
        assert!(skills[0].path.is_none());
        assert!(skills[0].instructions.is_none());
        assert!(!skills[0].disabled);

        let duplicate = handle_project_command(
            ProjectCommands::AddSkill {
                name: "Proj".to_string(),
                skill: "Review-Checklist".to_string(),
                description: None,
                path: None,
                instructions: None,
            },
            &home,
        )
        .await;
        assert!(duplicate.is_err(), "duplicate skill accepted");

        handle_project_command(
            ProjectCommands::ListSkills {
                name: "Proj".to_string(),
            },
            &home,
        )
        .await
        .expect("list skills");

        handle_project_command(
            ProjectCommands::RemoveSkill {
                name: "Proj".to_string(),
                skill: "review-checklist".to_string(),
            },
            &home,
        )
        .await
        .expect("remove skill");
        assert!(project_config(&home, "Proj").skills.is_empty());

        let missing = handle_project_command(
            ProjectCommands::RemoveSkill {
                name: "Proj".to_string(),
                skill: "review-checklist".to_string(),
            },
            &home,
        )
        .await;
        assert!(missing.is_err(), "removing a missing skill succeeded");
    })
    .await;
}

/// A repo whose local `main` is one commit behind a bare `origin` beside it.
///
/// The CLI's sync arm is only meaningful against real git, and the core tests cover the failure
/// states, so this fixture is the minimum needed to see the verb fast-forward and report a refusal.
struct SyncRepoFixture {
    root: PathBuf,
    repo: PathBuf,
}

impl Drop for SyncRepoFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

impl SyncRepoFixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-cli-sync-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        let repo = root.join(label);
        let origin = root.join("origin.git");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::create_dir_all(&origin).unwrap();

        let fixture = Self { root, repo };
        fixture.git_in(&origin, &["init", "--bare", "-b", "main"]);
        fixture.git(&["init", "-b", "main"]);
        fixture.git(&["config", "user.email", "fixture@tendril.test"]);
        fixture.git(&["config", "user.name", "Tendril Fixture"]);
        fixture.git(&["config", "commit.gpgsign", "false"]);
        std::fs::write(fixture.repo.join("README.md"), "fixture\n").unwrap();
        fixture.git(&["add", "."]);
        fixture.git(&["commit", "-m", "Initial commit"]);
        let origin_url = origin.to_string_lossy().to_string();
        fixture.git(&["remote", "add", "origin", &origin_url]);
        fixture.git(&["push", "-u", "origin", "main"]);

        std::fs::write(fixture.repo.join("ahead.txt"), "ahead\n").unwrap();
        fixture.git(&["add", "ahead.txt"]);
        fixture.git(&["commit", "-m", "Commit only origin has"]);
        fixture.git(&["push", "origin", "main"]);
        fixture.git(&["reset", "--hard", "HEAD~1"]);

        fixture
    }

    fn git(&self, args: &[&str]) -> String {
        let repo = self.repo.clone();
        self.git_in(&repo, args)
    }

    fn git_in(&self, dir: &Path, args: &[&str]) -> String {
        let (code, stdout, stderr) =
            tendril_core::git::service::run_git(args, dir).expect("run git");
        assert_eq!(code, 0, "git {:?} failed: {}{}", args, stdout, stderr);
        stdout
    }

    fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"]).trim().to_string()
    }
}

#[tokio::test]
async fn project_sync_reports_a_project_with_no_repos() {
    let home = FsHome::new("sync-no-repos");
    add_project(&home.path, "Proj").await;

    // Nothing to do is not a failure: the operator gets told and the command exits zero.
    handle_project_command(
        ProjectCommands::Sync {
            name: "Proj".to_string(),
            repo: None,
        },
        &home.path,
    )
    .await
    .expect("sync a project with no repos");
}

#[tokio::test]
async fn project_sync_fast_forwards_then_refuses_a_dirty_tree() {
    let home = FsHome::new("sync-repo");
    let fixture = SyncRepoFixture::new("syncable");

    add_project(&home.path, "Proj").await;
    handle_project_command(
        ProjectCommands::AddRepo {
            name: "Proj".to_string(),
            path: fixture.repo.to_string_lossy().to_string(),
        },
        &home.path,
    )
    .await
    .expect("add repo");

    let before = fixture.head();
    handle_project_command(
        ProjectCommands::Sync {
            name: "Proj".to_string(),
            repo: None,
        },
        &home.path,
    )
    .await
    .expect("sync fast-forwards");
    assert_ne!(fixture.head(), before, "HEAD did not advance");

    // An unmatched --repo selects nothing, which is reported rather than treated as a failure.
    handle_project_command(
        ProjectCommands::Sync {
            name: "Proj".to_string(),
            repo: Some("no-such-repo".to_string()),
        },
        &home.path,
    )
    .await
    .expect("sync with an unmatched --repo");

    std::fs::write(fixture.repo.join("README.md"), "edited\n").unwrap();
    let dirty = handle_project_command(
        ProjectCommands::Sync {
            name: "Proj".to_string(),
            repo: Some("syncable".to_string()),
        },
        &home.path,
    )
    .await;
    assert!(dirty.is_err(), "a dirty repo should fail the command");
}

/// A repo directory holding one MCP config and one skill folder.
struct ImportRepoFixture {
    path: PathBuf,
}

impl Drop for ImportRepoFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

impl ImportRepoFixture {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-cli-import-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join(".mcp.json"),
            r#"{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y"] } } }"#,
        )
        .unwrap();

        let skill_dir = path.join(".claude").join("skills").join("repo-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: repo-skill\ndescription: A skill the repo ships\n---\n\nDo the thing.\n",
        )
        .unwrap();

        Self { path }
    }

    fn arg(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

#[tokio::test]
async fn project_import_mcp_upserts_and_filters() {
    let home = FsHome::new("import-mcp");
    let repo = ImportRepoFixture::new("mcp");
    add_project(&home.path, "Proj").await;

    handle_project_command(
        ProjectCommands::ImportMcp {
            name: "Proj".to_string(),
            repo: repo.arg(),
            server: None,
        },
        &home.path,
    )
    .await
    .expect("import MCP servers");

    let servers = project_config(&home.path, "Proj").mcp_servers;
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "filesystem");
    assert_eq!(servers[0].arguments, ["-y"]);

    // Re-importing replaces the entry in place rather than appending a second copy.
    handle_project_command(
        ProjectCommands::ImportMcp {
            name: "Proj".to_string(),
            repo: repo.arg(),
            server: None,
        },
        &home.path,
    )
    .await
    .expect("re-import MCP servers");
    assert_eq!(project_config(&home.path, "Proj").mcp_servers.len(), 1);

    // A --name that matches nothing reports it and exits zero, leaving the config alone.
    handle_project_command(
        ProjectCommands::ImportMcp {
            name: "Proj".to_string(),
            repo: repo.arg(),
            server: Some("not-in-this-repo".to_string()),
        },
        &home.path,
    )
    .await
    .expect("import with an unmatched --name");
    assert_eq!(project_config(&home.path, "Proj").mcp_servers.len(), 1);

    let unknown_repo = handle_project_command(
        ProjectCommands::ImportMcp {
            name: "Proj".to_string(),
            repo: "/definitely/not/a/repo/on/this/machine".to_string(),
            server: None,
        },
        &home.path,
    )
    .await;
    assert!(unknown_repo.is_err(), "unknown repo argument accepted");
}

#[tokio::test]
async fn project_import_skills_copies_and_filters() {
    let home = FsHome::new("import-skills");
    let repo = ImportRepoFixture::new("skills");
    add_project(&home.path, "Proj").await;

    handle_project_command(
        ProjectCommands::ImportSkills {
            name: "Proj".to_string(),
            repo: repo.arg(),
            skill: None,
            no_copy: false,
        },
        &home.path,
    )
    .await
    .expect("import skills");

    let skills = project_config(&home.path, "Proj").skills;
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "repo-skill");
    assert_eq!(skills[0].description, "A skill the repo ships");
    assert!(
        tendril_core::skills::project_skills_dir(&home.path, "Proj")
            .join("repo-skill")
            .join("SKILL.md")
            .is_file(),
        "the skill files were not copied into the project"
    );

    handle_project_command(
        ProjectCommands::ImportSkills {
            name: "Proj".to_string(),
            repo: repo.arg(),
            skill: Some("repo-skill".to_string()),
            no_copy: true,
        },
        &home.path,
    )
    .await
    .expect("re-import one skill without copying");
    assert_eq!(project_config(&home.path, "Proj").skills.len(), 1);

    handle_project_command(
        ProjectCommands::ImportSkills {
            name: "Proj".to_string(),
            repo: repo.arg(),
            skill: Some("no-such-skill".to_string()),
            no_copy: false,
        },
        &home.path,
    )
    .await
    .expect("import with an unmatched --name");
    assert_eq!(project_config(&home.path, "Proj").skills.len(), 1);
}

#[tokio::test]
async fn project_import_honours_mcp_only_and_skills_only() {
    let home = FsHome::new("import-both");
    let repo = ImportRepoFixture::new("both");
    add_project(&home.path, "McpOnly").await;
    add_project(&home.path, "SkillsOnly").await;
    add_project(&home.path, "Everything").await;

    handle_project_command(
        ProjectCommands::Import {
            name: "McpOnly".to_string(),
            repo: repo.arg(),
            mcp_only: true,
            skills_only: false,
        },
        &home.path,
    )
    .await
    .expect("import --mcp-only");
    let mcp_only = project_config(&home.path, "McpOnly");
    assert_eq!(mcp_only.mcp_servers.len(), 1);
    assert!(mcp_only.skills.is_empty());

    handle_project_command(
        ProjectCommands::Import {
            name: "SkillsOnly".to_string(),
            repo: repo.arg(),
            mcp_only: false,
            skills_only: true,
        },
        &home.path,
    )
    .await
    .expect("import --skills-only");
    let skills_only = project_config(&home.path, "SkillsOnly");
    assert!(skills_only.mcp_servers.is_empty());
    assert_eq!(skills_only.skills.len(), 1);

    // Both flags together run both halves, as the original does.
    handle_project_command(
        ProjectCommands::Import {
            name: "Everything".to_string(),
            repo: repo.arg(),
            mcp_only: true,
            skills_only: true,
        },
        &home.path,
    )
    .await
    .expect("import with both flags");
    let everything = project_config(&home.path, "Everything");
    assert_eq!(everything.mcp_servers.len(), 1);
    assert_eq!(everything.skills.len(), 1);
}

#[tokio::test]
async fn project_import_resolves_a_configured_repo_by_directory_name() {
    let home = FsHome::new("import-by-name");
    let repo = ImportRepoFixture::new("named");
    add_project(&home.path, "Proj").await;
    handle_project_command(
        ProjectCommands::AddRepo {
            name: "Proj".to_string(),
            path: repo.arg(),
        },
        &home.path,
    )
    .await
    .expect("add repo");

    let dir_name = repo
        .path
        .file_name()
        .and_then(|n| n.to_str())
        .expect("fixture dir name")
        .to_string();

    handle_project_command(
        ProjectCommands::ImportMcp {
            name: "Proj".to_string(),
            repo: dir_name,
            server: None,
        },
        &home.path,
    )
    .await
    .expect("import by the repo's directory name");
    assert_eq!(project_config(&home.path, "Proj").mcp_servers.len(), 1);
}
