use std::path::{Path, PathBuf};
use tendril_core::config::{
    delete_master, expand_variables, get_config_path, get_config_path_with_env,
    get_default_tendril_home, get_default_tendril_home_with_env, get_plans_dir,
    get_plans_dir_with_env, get_plans_dir_with_settings, get_tendril_home,
    get_tendril_home_with_env, load_config, normalize_slashes, read_master, save_config,
    write_master, EnvSource, SystemEnv, TendrilSettings,
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

#[test]
fn test_plan_folder_serialization() {
    let mut settings = TendrilSettings::default();
    assert_eq!(settings.plan_folder, None);

    let yaml = serde_yaml::to_string(&settings).expect("serialize settings");
    assert!(!yaml.contains("planFolder"));

    settings.plan_folder = Some("/custom/plans".to_string());
    let yaml = serde_yaml::to_string(&settings).expect("serialize settings with planFolder");
    assert!(yaml.contains("planFolder: /custom/plans"));

    let deserialized: TendrilSettings = serde_yaml::from_str(&yaml).expect("deserialize settings");
    assert_eq!(deserialized.plan_folder, Some("/custom/plans".to_string()));

    let raw_yaml = "planFolder: D:/Tendril/MyPlans\n";
    let loaded: TendrilSettings = serde_yaml::from_str(raw_yaml).expect("deserialize raw yaml");
    assert_eq!(loaded.plan_folder, Some("D:/Tendril/MyPlans".to_string()));
}

#[test]
fn test_system_env() {
    let env = SystemEnv;
    assert!(env.get_var("PATH").is_some());
    assert!(env.get_var("NON_EXISTENT_VAR_TENDRIL_TEST_XYZ").is_none());
}

#[test]
fn test_mock_env_sources() {
    let closure_env = |k: &str| {
        if k == "FOO" {
            Some("bar".to_string())
        } else {
            None
        }
    };
    assert_eq!(closure_env.get_var("FOO"), Some("bar".to_string()));
    assert_eq!(closure_env.get_var("BAZ"), None);

    let mut map_owned = std::collections::HashMap::new();
    map_owned.insert("KEY".to_string(), "VAL".to_string());
    assert_eq!(map_owned.get_var("KEY"), Some("VAL".to_string()));
    assert_eq!(map_owned.get_var("OTHER"), None);

    let mut map_ref = std::collections::HashMap::new();
    map_ref.insert("KEY", "VAL");
    assert_eq!(map_ref.get_var("KEY"), Some("VAL".to_string()));
    assert_eq!(map_ref.get_var("OTHER"), None);

    let mut map_str_string = std::collections::HashMap::new();
    map_str_string.insert("KEY", "VAL".to_string());
    assert_eq!(map_str_string.get_var("KEY"), Some("VAL".to_string()));
    assert_eq!(map_str_string.get_var("OTHER"), None);

    let mut map_string_str = std::collections::HashMap::new();
    map_string_str.insert("KEY".to_string(), "VAL");
    assert_eq!(map_string_str.get_var("KEY"), Some("VAL".to_string()));
    assert_eq!(map_string_str.get_var("OTHER"), None);
}

#[test]
fn test_config_path_and_tendril_home_with_env() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-envpaths-test-{}",
        uuid::Uuid::new_v4().simple()
    ));

    let empty_env = std::collections::HashMap::<&str, &str>::new();
    assert_eq!(
        get_config_path_with_env(&test_dir, &empty_env),
        test_dir.join("config.yaml")
    );

    let mut custom_config_env = std::collections::HashMap::new();
    custom_config_env.insert("TENDRIL_CONFIG", "/custom/path/config.yaml");
    assert_eq!(
        get_config_path_with_env(&test_dir, &custom_config_env),
        PathBuf::from("/custom/path/config.yaml")
    );

    let mut custom_home_env = std::collections::HashMap::new();
    custom_home_env.insert("TENDRIL_HOME", "/custom/tendril/home");
    assert_eq!(
        get_default_tendril_home_with_env(&custom_home_env),
        PathBuf::from("/custom/tendril/home")
    );
    assert_eq!(
        get_tendril_home_with_env(&custom_home_env),
        PathBuf::from("/custom/tendril/home")
    );

    // Verify backward-compatible wrappers
    assert!(
        get_config_path(&test_dir).ends_with("config.yaml")
            || get_config_path(&test_dir).is_absolute()
    );
    assert!(!get_default_tendril_home().as_os_str().is_empty());
    assert_eq!(get_tendril_home(), get_default_tendril_home());
}

#[test]
fn test_get_plans_dir_with_explicit_setting() {
    let empty_env = std::collections::HashMap::<&str, &str>::new();

    let test_dir = std::env::temp_dir().join(format!(
        "tendril-plansdir-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mut settings = TendrilSettings::default();
    settings.plan_folder = Some("MyPlans".to_string());

    let plans_dir = get_plans_dir_with_env(&test_dir, Some(&settings), &empty_env);
    assert_eq!(plans_dir, test_dir.join("MyPlans"));

    let config_file = test_dir.join("config.yaml");
    save_config(&config_file, &settings).expect("Failed to save config");

    // When settings is None, get_plans_dir_with_env should load from config.yaml
    let loaded_plans_dir = get_plans_dir_with_env(&test_dir, None, &empty_env);
    assert_eq!(loaded_plans_dir, test_dir.join("MyPlans"));

    // Also get_plans_dir delegates to get_plans_dir_with_settings(&test_dir, None)
    // which delegates to get_plans_dir_with_env(&test_dir, None, &SystemEnv)
    if std::env::var("TENDRIL_PLANS").is_err() {
        let delegated_plans_dir = get_plans_dir(&test_dir);
        assert_eq!(delegated_plans_dir, test_dir.join("MyPlans"));
        let settings_plans_dir = get_plans_dir_with_settings(&test_dir, Some(&settings));
        assert_eq!(settings_plans_dir, test_dir.join("MyPlans"));
    }

    // Default fallback when plan_folder is None
    let default_settings = TendrilSettings::default();
    let fallback_dir = get_plans_dir_with_env(&test_dir, Some(&default_settings), &empty_env);
    assert_eq!(fallback_dir, test_dir.join("Plans"));

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_get_plans_dir_variable_expansion() {
    let empty_env = std::collections::HashMap::<&str, &str>::new();

    let test_dir = std::env::temp_dir().join(format!(
        "tendril-varexp-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mut settings = TendrilSettings::default();
    settings.plan_folder = Some("%TENDRIL_HOME%/CustomPlans".to_string());

    let plans_dir = get_plans_dir_with_env(&test_dir, Some(&settings), &empty_env);
    assert_eq!(plans_dir, test_dir.join("CustomPlans"));

    settings.plan_folder = Some("${TENDRIL_HOME}/Nested/Plans".to_string());
    let plans_dir = get_plans_dir_with_env(&test_dir, Some(&settings), &empty_env);
    assert_eq!(plans_dir, test_dir.join("Nested/Plans"));

    // Relative path without variable expansion
    settings.plan_folder = Some("RelativePlans".to_string());
    let plans_dir = get_plans_dir_with_env(&test_dir, Some(&settings), &empty_env);
    assert_eq!(plans_dir, test_dir.join("RelativePlans"));

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_get_plans_dir_precedence() {
    let empty_env = std::collections::HashMap::<&str, &str>::new();

    let test_dir = std::env::temp_dir().join(format!(
        "tendril-precedence-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    // 1. Fallback when neither TENDRIL_PLANS nor planFolder is set
    let default_settings = TendrilSettings::default();
    assert_eq!(
        get_plans_dir_with_env(&test_dir, Some(&default_settings), &empty_env),
        test_dir.join("Plans")
    );

    // 2. planFolder in settings takes effect when TENDRIL_PLANS is not set
    let mut configured_settings = TendrilSettings::default();
    configured_settings.plan_folder = Some("CustomFolder".to_string());
    assert_eq!(
        get_plans_dir_with_env(&test_dir, Some(&configured_settings), &empty_env),
        test_dir.join("CustomFolder")
    );

    // 3. TENDRIL_PLANS overrides planFolder in settings
    let env_override_path = test_dir.join("EnvOverride");
    let mut env_with_override = std::collections::HashMap::new();
    env_with_override.insert(
        "TENDRIL_PLANS",
        env_override_path.to_string_lossy().to_string(),
    );
    assert_eq!(
        get_plans_dir_with_env(&test_dir, Some(&configured_settings), &env_with_override),
        env_override_path
    );

    // Also verify with closure environment source
    let closure_env = |k: &str| {
        if k == "TENDRIL_PLANS" {
            Some(env_override_path.to_string_lossy().to_string())
        } else {
            None
        }
    };
    assert_eq!(
        get_plans_dir_with_env(&test_dir, Some(&configured_settings), &closure_env),
        env_override_path
    );

    let _ = std::fs::remove_dir_all(test_dir);
}
