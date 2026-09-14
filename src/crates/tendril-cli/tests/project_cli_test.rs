use std::path::PathBuf;
use std::sync::Arc;
use tendril_cli::commands::project::{handle_project_command, ProjectCommands};
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
