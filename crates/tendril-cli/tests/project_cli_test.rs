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
