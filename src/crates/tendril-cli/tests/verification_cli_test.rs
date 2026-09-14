use std::path::PathBuf;
use std::sync::Arc;
use tendril_cli::commands::verification::{handle_verification_command, VerificationCommands};
use tendril_core::config::{get_config_path, load_config, save_config};
use tendril_core::models::{ProjectConfig, ProjectVerificationRef, RepoRef, VerificationConfig};
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
        "tendril-cli-ver-test-{}",
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
async fn test_verification_cli_filesystem_fallback() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-ver-fs-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let cfg_path = get_config_path(&tendril_home);

    // 1. Add verification
    handle_verification_command(
        VerificationCommands::Add {
            name: "MyLint".to_string(),
            prompt: "cargo clippy -- -D warnings".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add verification via filesystem");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.verifications.len(), 1);
    assert_eq!(cfg.verifications[0].name, "MyLint");
    assert_eq!(cfg.verifications[0].prompt, "cargo clippy -- -D warnings");

    // 2. List verifications (plain & json)
    handle_verification_command(VerificationCommands::List { json: false }, &tendril_home)
        .await
        .expect("List verifications plain");

    handle_verification_command(VerificationCommands::List { json: true }, &tendril_home)
        .await
        .expect("List verifications json");

    // 3. Get verification
    handle_verification_command(
        VerificationCommands::Get {
            name: "MyLint".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Get verification via filesystem");

    // 4. Set (update) verification prompt
    handle_verification_command(
        VerificationCommands::Set {
            name: "MyLint".to_string(),
            new_name: None,
            prompt: Some("cargo clippy --all-targets -- -D warnings".to_string()),
        },
        &tendril_home,
    )
    .await
    .expect("Set verification via filesystem");

    let cfg_after_set = load_config(&cfg_path).unwrap();
    assert_eq!(cfg_after_set.verifications.len(), 1);
    assert_eq!(
        cfg_after_set.verifications[0].prompt,
        "cargo clippy --all-targets -- -D warnings"
    );

    // 5. Remove verification
    handle_verification_command(
        VerificationCommands::Remove {
            name: "MyLint".to_string(),
            force: false,
        },
        &tendril_home,
    )
    .await
    .expect("Remove verification via filesystem");

    let cfg_after = load_config(&cfg_path).unwrap();
    assert!(cfg_after.verifications.is_empty());

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_verification_cli_routed_through_daemon() {
    let server = start_test_server().await;
    let cfg_path = get_config_path(&server.tendril_home);

    // 1. Add verification through daemon
    handle_verification_command(
        VerificationCommands::Add {
            name: "DaemonCheck".to_string(),
            prompt: "pytest -v".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Add verification via daemon");

    // Verify written to config.yaml
    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.verifications.len(), 1);
    assert_eq!(cfg.verifications[0].name, "DaemonCheck");
    assert_eq!(cfg.verifications[0].prompt, "pytest -v");

    // 2. List verifications
    handle_verification_command(
        VerificationCommands::List { json: false },
        &server.tendril_home,
    )
    .await
    .expect("List verifications plain via daemon");

    handle_verification_command(
        VerificationCommands::List { json: true },
        &server.tendril_home,
    )
    .await
    .expect("List verifications json via daemon");

    // 3. Get verification
    handle_verification_command(
        VerificationCommands::Get {
            name: "DaemonCheck".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Get verification via daemon");

    // 4. Set (update) verification prompt through daemon
    handle_verification_command(
        VerificationCommands::Set {
            name: "DaemonCheck".to_string(),
            new_name: None,
            prompt: Some("pytest -vv".to_string()),
        },
        &server.tendril_home,
    )
    .await
    .expect("Set verification via daemon");

    let cfg_after_set = load_config(&cfg_path).unwrap();
    assert_eq!(cfg_after_set.verifications.len(), 1);
    assert_eq!(cfg_after_set.verifications[0].prompt, "pytest -vv");

    // 5. Remove verification through daemon
    handle_verification_command(
        VerificationCommands::Remove {
            name: "DaemonCheck".to_string(),
            force: false,
        },
        &server.tendril_home,
    )
    .await
    .expect("Remove verification via daemon");

    let cfg_after = load_config(&cfg_path).unwrap();
    assert!(cfg_after.verifications.is_empty());
}

#[tokio::test]
async fn test_verification_cli_error_handling() {
    let server = start_test_server().await;

    // Test 404 on missing verification with daemon
    let err_daemon_get = handle_verification_command(
        VerificationCommands::Get {
            name: "NonExistent".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err_daemon_get.to_string(),
        "Verification 'NonExistent' not found"
    );

    let err_daemon_rem = handle_verification_command(
        VerificationCommands::Remove {
            name: "NonExistent".to_string(),
            force: false,
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err_daemon_rem.to_string(),
        "Verification 'NonExistent' not found"
    );

    let err_daemon_set = handle_verification_command(
        VerificationCommands::Set {
            name: "NonExistent".to_string(),
            new_name: None,
            prompt: Some("irrelevant".to_string()),
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err_daemon_set.to_string(),
        "Verification 'NonExistent' not found"
    );

    // Add verification and test 409 Conflict on duplicate with daemon
    handle_verification_command(
        VerificationCommands::Add {
            name: "DupVer".to_string(),
            prompt: "".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .unwrap();

    let err_daemon_dup = handle_verification_command(
        VerificationCommands::Add {
            name: "DupVer".to_string(),
            prompt: "".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err_daemon_dup.to_string(),
        "Verification 'DupVer' already exists"
    );

    // Test errors without daemon (filesystem fallback)
    let fs_home = std::env::temp_dir().join(format!(
        "tendril-cli-ver-err-fs-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&fs_home).unwrap();

    let err_fs_get = handle_verification_command(
        VerificationCommands::Get {
            name: "NonExistent".to_string(),
        },
        &fs_home,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err_fs_get.to_string(),
        "Verification 'NonExistent' not found"
    );

    let err_fs_rem = handle_verification_command(
        VerificationCommands::Remove {
            name: "NonExistent".to_string(),
            force: false,
        },
        &fs_home,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err_fs_rem.to_string(),
        "Verification 'NonExistent' not found"
    );

    let err_fs_set = handle_verification_command(
        VerificationCommands::Set {
            name: "NonExistent".to_string(),
            new_name: None,
            prompt: Some("irrelevant".to_string()),
        },
        &fs_home,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err_fs_set.to_string(),
        "Verification 'NonExistent' not found"
    );

    handle_verification_command(
        VerificationCommands::Add {
            name: "DupVer".to_string(),
            prompt: "".to_string(),
        },
        &fs_home,
    )
    .await
    .unwrap();

    let err_fs_dup = handle_verification_command(
        VerificationCommands::Add {
            name: "DupVer".to_string(),
            prompt: "".to_string(),
        },
        &fs_home,
    )
    .await
    .unwrap_err();
    assert_eq!(
        err_fs_dup.to_string(),
        "Verification 'DupVer' already exists"
    );

    // Assert daemon and filesystem error messages match exactly
    assert_eq!(err_daemon_get.to_string(), err_fs_get.to_string());
    assert_eq!(err_daemon_rem.to_string(), err_fs_rem.to_string());
    assert_eq!(err_daemon_dup.to_string(), err_fs_dup.to_string());
    assert_eq!(err_daemon_set.to_string(), err_fs_set.to_string());

    let _ = std::fs::remove_dir_all(&fs_home);
}

#[tokio::test]
async fn test_verification_cli_rename_filesystem_fallback() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-ver-rename-fs-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    handle_verification_command(
        VerificationCommands::Add {
            name: "VerOrig".to_string(),
            prompt: "cargo test".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("Add verification");

    handle_verification_command(
        VerificationCommands::Set {
            name: "VerOrig".to_string(),
            new_name: Some("VerRenamed".to_string()),
            prompt: None,
        },
        &tendril_home,
    )
    .await
    .expect("Rename verification via fs");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.verifications.len(), 1);
    assert_eq!(cfg.verifications[0].name, "VerRenamed");
    assert_eq!(cfg.verifications[0].prompt, "cargo test");

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_verification_cli_rename_routed_through_daemon() {
    let server = start_test_server().await;
    let cfg_path = get_config_path(&server.tendril_home);

    handle_verification_command(
        VerificationCommands::Add {
            name: "DaemonVerOrig".to_string(),
            prompt: "cargo clippy".to_string(),
        },
        &server.tendril_home,
    )
    .await
    .expect("Add verification via daemon");

    handle_verification_command(
        VerificationCommands::Set {
            name: "DaemonVerOrig".to_string(),
            new_name: Some("DaemonVerRenamed".to_string()),
            prompt: None,
        },
        &server.tendril_home,
    )
    .await
    .expect("Rename verification via daemon");

    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.verifications.len(), 1);
    assert_eq!(cfg.verifications[0].name, "DaemonVerRenamed");
    assert_eq!(cfg.verifications[0].prompt, "cargo clippy");
}

#[tokio::test]
async fn test_verification_cli_remove_referenced_blocked_and_force_cleans_fs() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-ver-ref-fs-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    let mut settings = load_config(&cfg_path).unwrap();
    settings.verifications.push(VerificationConfig {
        name: "CheckLint".to_string(),
        prompt: "cargo clippy".to_string(),
    });
    settings.projects.push(ProjectConfig {
        name: "ProjectAlpha".to_string(),
        color: "Blue".to_string(),
        repos: vec![],
        verifications: vec![ProjectVerificationRef {
            name: "CheckLint".to_string(),
            required: true,
        }],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        mcp_servers: Vec::new(),
    });
    save_config(&cfg_path, &settings).unwrap();

    // 1. Without force, remove should fail with conflict message
    let err = handle_verification_command(
        VerificationCommands::Remove {
            name: "CheckLint".to_string(),
            force: false,
        },
        &tendril_home,
    )
    .await
    .unwrap_err();

    let err_msg = err.to_string();
    assert!(err_msg.contains("ProjectAlpha"));
    assert!(err_msg.contains("Use --force"));

    // Verify verification and project reference still exist
    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.verifications.len(), 1);
    assert_eq!(cfg.projects[0].verifications.len(), 1);

    // 2. With force, remove should succeed and clean project references
    handle_verification_command(
        VerificationCommands::Remove {
            name: "CheckLint".to_string(),
            force: true,
        },
        &tendril_home,
    )
    .await
    .expect("Remove with force should succeed");

    let cfg_after = load_config(&cfg_path).unwrap();
    assert!(cfg_after.verifications.is_empty());
    assert!(cfg_after.projects[0].verifications.is_empty());

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn test_verification_cli_remove_referenced_blocked_and_force_cleans_daemon() {
    let server = start_test_server().await;
    let cfg_path = get_config_path(&server.tendril_home);

    let mut settings = load_config(&cfg_path).unwrap();
    settings.verifications.push(VerificationConfig {
        name: "DaemonLint".to_string(),
        prompt: "cargo clippy".to_string(),
    });
    settings.projects.push(ProjectConfig {
        name: "ProjectBeta".to_string(),
        color: "Red".to_string(),
        repos: vec![],
        verifications: vec![ProjectVerificationRef {
            name: "DaemonLint".to_string(),
            required: true,
        }],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        mcp_servers: Vec::new(),
    });
    save_config(&cfg_path, &settings).unwrap();

    // 1. Without force, remove should fail with conflict message
    let err = handle_verification_command(
        VerificationCommands::Remove {
            name: "DaemonLint".to_string(),
            force: false,
        },
        &server.tendril_home,
    )
    .await
    .unwrap_err();

    let err_msg = err.to_string();
    assert!(err_msg.contains("ProjectBeta"));
    assert!(err_msg.contains("Use --force"));

    // Verify verification and project reference still exist
    let cfg = load_config(&cfg_path).unwrap();
    assert_eq!(cfg.verifications.len(), 1);
    assert_eq!(cfg.projects[0].verifications.len(), 1);

    // 2. With force, remove should succeed and clean project references
    handle_verification_command(
        VerificationCommands::Remove {
            name: "DaemonLint".to_string(),
            force: true,
        },
        &server.tendril_home,
    )
    .await
    .expect("Remove with force should succeed");

    let cfg_after = load_config(&cfg_path).unwrap();
    assert!(cfg_after.verifications.is_empty());
    assert!(cfg_after.projects[0].verifications.is_empty());
}

#[test]
fn test_doctor_warns_on_non_existent_verification() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-doc-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    let mut settings = load_config(&cfg_path).unwrap();
    settings.projects.push(ProjectConfig {
        name: "DoctorProj".to_string(),
        color: "Blue".to_string(),
        repos: vec![],
        verifications: vec![ProjectVerificationRef {
            name: "GhostVerification".to_string(),
            required: true,
        }],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        mcp_servers: Vec::new(),
    });
    save_config(&cfg_path, &settings).unwrap();

    let res = tendril_cli::commands::doctor::handle_doctor(&tendril_home);
    assert!(res.is_ok());

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[test]
fn test_doctor_warns_on_non_existent_repository_path() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-doc-repo-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    let existing_repo = tendril_home.join("existing-repo");
    std::fs::create_dir_all(&existing_repo).unwrap();

    let mut settings = load_config(&cfg_path).unwrap();
    settings.projects.push(ProjectConfig {
        name: "DoctorRepoProj".to_string(),
        color: "Blue".to_string(),
        repos: vec![
            RepoRef {
                path: "/non/existent/path/to/repo".to_string(),
                base_branch: None,
            },
            RepoRef {
                path: "%TENDRIL_HOME%/ghost-repo".to_string(),
                base_branch: None,
            },
            RepoRef {
                path: existing_repo.to_string_lossy().to_string(),
                base_branch: None,
            },
        ],
        verifications: vec![],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        mcp_servers: Vec::new(),
    });
    save_config(&cfg_path, &settings).unwrap();

    let res = tendril_cli::commands::doctor::handle_doctor(&tendril_home);
    assert!(res.is_ok());

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[test]
fn test_doctor_warns_on_non_git_repository_path() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-doc-non-git-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    let non_git_repo = tendril_home.join("non-git-repo");
    std::fs::create_dir_all(&non_git_repo).unwrap();

    let git_repo = tendril_home.join("git-repo");
    std::fs::create_dir_all(git_repo.join(".git")).unwrap();

    let mut settings = load_config(&cfg_path).unwrap();
    settings.projects.push(ProjectConfig {
        name: "DoctorNonGitProj".to_string(),
        color: "Blue".to_string(),
        repos: vec![
            RepoRef {
                path: non_git_repo.to_string_lossy().to_string(),
                base_branch: None,
            },
            RepoRef {
                path: git_repo.to_string_lossy().to_string(),
                base_branch: None,
            },
        ],
        verifications: vec![],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        mcp_servers: Vec::new(),
    });
    save_config(&cfg_path, &settings).unwrap();

    let res = tendril_cli::commands::doctor::handle_doctor(&tendril_home);
    assert!(res.is_ok());

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[test]
fn test_doctor_warns_on_bad_build_dependency_path() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-cli-doc-build-dep-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    let cfg_path = get_config_path(&tendril_home);

    let mut settings = load_config(&cfg_path).unwrap();
    settings.projects.push(ProjectConfig {
        name: "DoctorBuildDepProj".to_string(),
        color: "Blue".to_string(),
        repos: vec![],
        verifications: vec![],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec!["/non/existent/build-dependency".to_string()],
        mcp_servers: Vec::new(),
    });
    save_config(&cfg_path, &settings).unwrap();

    let res = tendril_cli::commands::doctor::handle_doctor(&tendril_home);
    assert!(res.is_ok());

    let _ = std::fs::remove_dir_all(&tendril_home);
}
