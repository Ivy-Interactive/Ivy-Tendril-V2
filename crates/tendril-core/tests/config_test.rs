use std::path::Path;
use tendril_core::config::{
    delete_master, expand_variables, load_config, normalize_slashes, read_master, save_config,
    write_master, TendrilSettings,
};
use tendril_core::models::{ProjectConfig, ProjectVerificationRef, RepoRef};

#[test]
fn test_normalize_slashes() {
    let p = Path::new(r"C:\Users\pavel\.tendril\Plans\00001-Test");
    let norm = normalize_slashes(p);
    assert_eq!(norm, "C:/Users/pavel/.tendril/Plans/00001-Test");
}

#[test]
fn test_expand_variables() {
    let tendril_home = "D:/.tendril";

    assert_eq!(
        expand_variables("%TENDRIL_HOME%/Plans", tendril_home),
        "D:/.tendril/Plans"
    );
    assert_eq!(
        expand_variables("${TENDRIL_HOME}/config.yaml", tendril_home),
        "D:/.tendril/config.yaml"
    );
    assert_eq!(
        expand_variables("$TENDRIL_HOME/tendril.db", tendril_home),
        "D:/.tendril/tendril.db"
    );

    let expanded_tilde = expand_variables("~/workspace", tendril_home);
    assert!(!expanded_tilde.starts_with('~'));
    assert!(expanded_tilde.contains("workspace"));
}

#[test]
fn test_config_load_and_save() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-config-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");
    let config_file = test_dir.join("config.yaml");

    let mut settings = TendrilSettings {
        coding_agent: "gemini".to_string(),
        job_timeout: 45,
        ..TendrilSettings::default()
    };
    settings.projects.push(ProjectConfig {
        name: "TestProject".to_string(),
        color: "Blue".to_string(),
        repos: vec![RepoRef {
            path: "D:/repos/test".to_string(),
            base_branch: Some("main".to_string()),
        }],
        verifications: vec![ProjectVerificationRef {
            name: "Build".to_string(),
            required: true,
        }],
        context: "Rust Project".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
    });

    save_config(&config_file, &settings).expect("Failed to save config");
    assert!(config_file.exists());

    let loaded = load_config(&config_file).expect("Failed to load config");
    assert_eq!(loaded.coding_agent, "gemini");
    assert_eq!(loaded.job_timeout, 45);
    assert_eq!(loaded.projects.len(), 1);
    assert_eq!(loaded.projects[0].name, "TestProject");
    assert_eq!(loaded.projects[0].repos[0].path, "D:/repos/test");
    assert_eq!(
        loaded.projects[0].repos[0].base_branch.as_deref(),
        Some("main")
    );

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_master_file_lifecycle() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-master-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    assert!(read_master(&test_dir).is_none());

    write_master(&test_dir, 49200, "secret-token-xyz", "127.0.0.1")
        .expect("Failed to write master");

    let master_info = read_master(&test_dir).expect("Master info not found");
    assert_eq!(master_info.port, 49200);
    assert_eq!(master_info.secret, "secret-token-xyz");
    assert_eq!(master_info.host, "127.0.0.1");
    assert_eq!(master_info.pid, std::process::id());
    assert!(!master_info.started_at.is_empty());
    assert_eq!(master_info.api_version, 1);
    assert!(!master_info.capabilities.is_empty());

    delete_master(&test_dir);
    assert!(read_master(&test_dir).is_none());

    let _ = std::fs::remove_dir_all(test_dir);
}
