use std::path::{Path, PathBuf};
use tendril_core::config::{
    delete_master, dirs_home, dirs_home_with_env, expand_variables, expand_variables_with_env,
    find_projects_referencing_verification, get_config_path, get_config_path_with_env,
    get_default_tendril_home, get_default_tendril_home_with_env, get_plans_dir,
    get_plans_dir_with_env, get_plans_dir_with_settings, get_tendril_home,
    get_tendril_home_with_env, load_config, normalize_slashes, read_master,
    remove_verification_from_projects, save_config, write_master, EnvSource, SystemEnv,
    TendrilSettings,
};
use tendril_core::models::{ProjectConfig, ProjectVerificationRef, RepoRef, ReviewActionConfig};

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
        ..Default::default()
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
fn promptware_overlay_config_round_trips() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-config-overlay-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");
    let config_file = test_dir.join("config.yaml");

    let settings = TendrilSettings {
        promptware_overlay: Some("%TENDRIL_HOME%/Overlay".to_string()),
        ..Default::default()
    };
    save_config(&config_file, &settings).expect("Failed to save config");

    let raw = std::fs::read_to_string(&config_file).expect("read config");
    assert!(
        raw.contains("promptwareOverlay: '%TENDRIL_HOME%/Overlay'")
            || raw.contains("promptwareOverlay: \"%TENDRIL_HOME%/Overlay\"")
            || raw.contains("promptwareOverlay: %TENDRIL_HOME%/Overlay"),
        "expected the key in {}",
        raw
    );

    let loaded = load_config(&config_file).expect("Failed to load config");
    assert_eq!(
        loaded.promptware_overlay.as_deref(),
        Some("%TENDRIL_HOME%/Overlay")
    );
    // Now modelled rather than swept into `extra`, so it must not appear twice.
    assert!(!loaded.extra.contains_key("promptwareOverlay"));

    // A config without the key still round-trips, and the key is omitted when unset.
    let plain = TendrilSettings::default();
    let plain_file = test_dir.join("plain.yaml");
    save_config(&plain_file, &plain).expect("Failed to save plain config");
    let plain_raw = std::fs::read_to_string(&plain_file).expect("read plain config");
    assert!(!plain_raw.contains("promptwareOverlay"));
    assert_eq!(
        load_config(&plain_file)
            .expect("Failed to load plain config")
            .promptware_overlay,
        None
    );

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_review_action_paths_round_trip_and_omitted_when_empty() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-config-paths-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");
    let config_file = test_dir.join("config.yaml");

    let mut settings = TendrilSettings::default();
    settings.projects.push(ProjectConfig {
        name: "TestProject".to_string(),
        color: "Blue".to_string(),
        review_actions: vec![
            ReviewActionConfig {
                name: "Storybook".to_string(),
                condition: String::new(),
                command: String::new(),
                paths: vec!["src/packages/components".to_string()],
            },
            ReviewActionConfig {
                name: "App".to_string(),
                condition: String::new(),
                command: String::new(),
                paths: vec![],
            },
        ],
        ..Default::default()
    });

    save_config(&config_file, &settings).expect("Failed to save config");

    let raw = std::fs::read_to_string(&config_file).expect("read config");
    assert!(raw.contains("paths"));
    // The unscoped action's empty `paths` must not be emitted at all.
    let app_section = raw.split("App").nth(1).unwrap_or("");
    assert!(!app_section.trim_start().starts_with("paths"));

    let loaded = load_config(&config_file).expect("Failed to load config");
    assert_eq!(
        loaded.projects[0].review_actions[0].paths,
        vec!["src/packages/components".to_string()]
    );
    assert!(loaded.projects[0].review_actions[1].paths.is_empty());

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_review_action_config_written_before_paths_field_still_loads() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-config-legacy-review-action-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");
    let config_file = test_dir.join("config.yaml");

    std::fs::write(
        &config_file,
        r#"
projects:
  - name: LegacyProject
    reviewActions:
      - name: App
        command: pnpm dev:app
        condition: "$true"
"#,
    )
    .expect("write legacy config");

    let loaded = load_config(&config_file).expect("Failed to load legacy config");
    assert_eq!(loaded.projects[0].review_actions[0].name, "App");
    assert!(loaded.projects[0].review_actions[0].paths.is_empty());

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

    write_master(&test_dir, 49200, "secret-token-xyz", "127.0.0.1", "http")
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
fn test_model_cache_age_thresholds_default() {
    let defaults = TendrilSettings::default();
    assert_eq!(defaults.model_cache_warn_age_days, 7);
    assert_eq!(defaults.model_cache_max_age_days, 30);

    // Absent from the raw YAML: both fields fall back to their defaults.
    let loaded: TendrilSettings = serde_yaml::from_str("codingAgent: claude\n").expect("parse");
    assert_eq!(loaded.model_cache_warn_age_days, 7);
    assert_eq!(loaded.model_cache_max_age_days, 30);

    // Explicit values in the raw YAML round-trip.
    let loaded_custom: TendrilSettings =
        serde_yaml::from_str("modelCacheWarnAgeDays: 3\nmodelCacheMaxAgeDays: 14\n")
            .expect("parse");
    assert_eq!(loaded_custom.model_cache_warn_age_days, 3);
    assert_eq!(loaded_custom.model_cache_max_age_days, 14);
}

#[test]
fn test_model_enrichment_interval_default() {
    let defaults = TendrilSettings::default();
    assert_eq!(defaults.model_enrichment_interval_hours, 12);

    let loaded: TendrilSettings =
        serde_yaml::from_str("modelEnrichmentIntervalHours: 6\n").expect("parse");
    assert_eq!(loaded.model_enrichment_interval_hours, 6);

    let yaml = serde_yaml::to_string(&loaded).expect("serialize settings");
    let reloaded: TendrilSettings = serde_yaml::from_str(&yaml).expect("parse");
    assert_eq!(reloaded.model_enrichment_interval_hours, 6);
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

    let settings = TendrilSettings {
        plan_folder: Some("MyPlans".to_string()),
        ..Default::default()
    };

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

    let mut settings = TendrilSettings {
        plan_folder: Some("%TENDRIL_HOME%/CustomPlans".to_string()),
        ..Default::default()
    };

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
    let configured_settings = TendrilSettings {
        plan_folder: Some("CustomFolder".to_string()),
        ..Default::default()
    };
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

#[test]
fn test_find_and_remove_projects_referencing_verification() {
    let mut settings = TendrilSettings::default();
    settings.projects.push(ProjectConfig {
        name: "ProjectA".to_string(),
        color: "Blue".to_string(),
        repos: vec![],
        verifications: vec![
            ProjectVerificationRef {
                name: "RustClippy".to_string(),
                required: true,
            },
            ProjectVerificationRef {
                name: "RustTest".to_string(),
                required: false,
            },
        ],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        ..Default::default()
    });
    settings.projects.push(ProjectConfig {
        name: "ProjectB".to_string(),
        color: "Red".to_string(),
        repos: vec![],
        verifications: vec![ProjectVerificationRef {
            name: "rustclippy".to_string(), // case-insensitive check
            required: true,
        }],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        ..Default::default()
    });
    settings.projects.push(ProjectConfig {
        name: "ProjectC".to_string(),
        color: "Green".to_string(),
        repos: vec![],
        verifications: vec![ProjectVerificationRef {
            name: "RustTest".to_string(),
            required: true,
        }],
        context: "".to_string(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        ..Default::default()
    });

    let referencing = find_projects_referencing_verification(&settings, "RustClippy");
    assert_eq!(referencing, vec!["ProjectA", "ProjectB"]);

    let referencing_none = find_projects_referencing_verification(&settings, "NonExistent");
    assert!(referencing_none.is_empty());

    let modified = remove_verification_from_projects(&mut settings, "RUSTCLIPPY");
    assert_eq!(modified, vec!["ProjectA", "ProjectB"]);

    assert_eq!(settings.projects[0].verifications.len(), 1);
    assert_eq!(settings.projects[0].verifications[0].name, "RustTest");
    assert_eq!(settings.projects[1].verifications.len(), 0);
    assert_eq!(settings.projects[2].verifications.len(), 1);
    assert_eq!(settings.projects[2].verifications[0].name, "RustTest");

    let modified_again = remove_verification_from_projects(&mut settings, "RustClippy");
    assert!(modified_again.is_empty());
}

#[test]
fn test_dirs_home_with_env() {
    let empty_env = std::collections::HashMap::<&str, &str>::new();
    assert_eq!(dirs_home_with_env(&empty_env), None);

    let mut blank_env = std::collections::HashMap::new();
    blank_env.insert("USERPROFILE", "   ");
    blank_env.insert("HOME", "");
    assert_eq!(dirs_home_with_env(&blank_env), None);

    let mut env_home = std::collections::HashMap::new();
    env_home.insert("HOME", "/mock/home");
    assert_eq!(
        dirs_home_with_env(&env_home),
        Some(PathBuf::from("/mock/home"))
    );

    let mut env_userprofile = std::collections::HashMap::new();
    env_userprofile.insert("USERPROFILE", "/mock/userprofile");
    assert_eq!(
        dirs_home_with_env(&env_userprofile),
        Some(PathBuf::from("/mock/userprofile"))
    );

    let mut env_both = std::collections::HashMap::new();
    env_both.insert("USERPROFILE", "/mock/userprofile");
    env_both.insert("HOME", "/mock/home");
    assert_eq!(
        dirs_home_with_env(&env_both),
        Some(PathBuf::from("/mock/userprofile"))
    );

    let _ = dirs_home();
}

#[test]
fn test_expand_variables_with_env() {
    let mut mock_env = std::collections::HashMap::new();
    mock_env.insert("HOME", "/mock/home");

    assert_eq!(
        expand_variables_with_env("~/projects", "/tendril", &mock_env),
        "/mock/home/projects"
    );
    assert_eq!(
        expand_variables_with_env("~", "/tendril", &mock_env),
        "/mock/home"
    );

    let empty_env = std::collections::HashMap::<&str, &str>::new();
    assert_eq!(
        expand_variables_with_env("~/projects", "/tendril", &empty_env),
        "~/projects"
    );
}

#[test]
fn test_get_default_tendril_home_fallback_with_env() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-fallback-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let custom_home = test_dir.join("custom_home");
    let tendril_dir = custom_home.join(".tendril");
    std::fs::create_dir_all(&tendril_dir).expect("Failed to create custom home tendril dir");

    let mut mock_env = std::collections::HashMap::new();
    let custom_home_str = custom_home.to_string_lossy().to_string();
    mock_env.insert("HOME", custom_home_str.clone());
    #[cfg(windows)]
    mock_env.insert("USERPROFILE", custom_home_str);

    let resolved = get_default_tendril_home_with_env(&mock_env);

    #[cfg(not(windows))]
    assert_eq!(resolved, custom_home.join(".tendril"));

    #[cfg(windows)]
    {
        if !Path::new(r"D:\.tendril").exists() {
            assert_eq!(resolved, custom_home.join(".tendril"));
        }
    }

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn daemon_request_timeout_round_trips_and_defaults() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-daemon-timeout-config-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");
    let config_file = test_dir.join("config.yaml");

    // A config written before this setting existed must load with the default, not with 0 — which
    // would silently mean "no timeout" and restore the hang.
    std::fs::write(&config_file, "codingAgent: claude\njobTimeout: 30\n").unwrap();
    let legacy = load_config(&config_file).expect("Failed to load legacy config");
    assert_eq!(legacy.daemon_request_timeout, 30);

    let settings = TendrilSettings {
        daemon_request_timeout: 12,
        ..TendrilSettings::default()
    };
    save_config(&config_file, &settings).expect("Failed to save config");

    let raw = std::fs::read_to_string(&config_file).unwrap();
    assert!(
        raw.contains("daemonRequestTimeout: 12"),
        "the setting must serialize under its camelCase name: {}",
        raw
    );

    let loaded = load_config(&config_file).expect("Failed to reload config");
    assert_eq!(loaded.daemon_request_timeout, 12);
    // If the rename and the field ever disagree, the value lands in the flattened `extra` map and
    // the modeled field silently keeps its default. Assert it does not.
    assert!(
        !loaded.extra.contains_key("daemonRequestTimeout"),
        "daemonRequestTimeout must be a modeled field, not an unknown passthrough key"
    );

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn public_config_keys_advertise_only_real_settings() {
    use tendril_core::mcp::dispatch::PUBLIC_CONFIG_KEYS;

    assert!(
        PUBLIC_CONFIG_KEYS.contains(&"daemonRequestTimeout"),
        "the new setting must be readable through the MCP config tool"
    );
    // `chatTimeout` was advertised with no field behind it, so reading it always returned null.
    assert!(
        !PUBLIC_CONFIG_KEYS.contains(&"chatTimeout"),
        "chatTimeout has no field behind it and must not be advertised"
    );

    // `planFolder` is `skip_serializing_if = "Option::is_none"`, so it only appears once populated;
    // populate it rather than carve it out.
    let settings = TendrilSettings {
        plan_folder: Some("Plans".to_string()),
        ..TendrilSettings::default()
    };
    let serialized = serde_json::to_value(&settings).expect("settings must serialize");
    let object = serialized.as_object().expect("settings serialize to a map");

    // `themeMode` is a V1 desktop key with no Rust field: it round-trips through the flattened
    // `extra` map (asserted by config_unknown_keys_test) and is deliberately still advertised.
    const EXTRA_BACKED_KEYS: &[&str] = &["themeMode"];

    for key in PUBLIC_CONFIG_KEYS {
        if EXTRA_BACKED_KEYS.contains(key) {
            continue;
        }
        assert!(
            object.contains_key(*key),
            "advertised config key '{}' does not resolve to a serialized field, so reading it \
             would always return null",
            key
        );
    }
}
fn write_config(body: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tendril-inbox-cfg-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).expect("Failed to create scratch config dir");
    let path = dir.join("config.yaml");
    std::fs::write(&path, body).expect("Failed to write scratch config");
    path
}

#[test]
fn inbox_defaults_are_off_and_fifteen_minutes() {
    let settings = TendrilSettings::default();
    assert!(
        !settings.inbox.auto_accept_assigned_issues,
        "Auto-accept must default to off: a swept issue turning straight into a plan is not \
         something a user should get without asking for it"
    );
    assert_eq!(settings.inbox.check_interval_minutes, 15);
}

#[test]
fn an_absent_inbox_section_loads_as_defaults() {
    let path = write_config("codingAgent: claude\n");
    let settings = load_config(&path).expect("A config without an inbox section must still load");

    assert!(!settings.inbox.auto_accept_assigned_issues);
    assert_eq!(settings.inbox.check_interval_minutes, 15);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn inbox_reads_camel_case_keys() {
    let path =
        write_config("inbox:\n  autoAcceptAssignedIssues: true\n  checkIntervalMinutes: 5\n");
    let settings = load_config(&path).expect("Config with an inbox section must load");

    assert!(settings.inbox.auto_accept_assigned_issues);
    assert_eq!(settings.inbox.check_interval_minutes, 5);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn a_partial_inbox_section_keeps_the_default_for_the_missing_key() {
    let path = write_config("inbox:\n  autoAcceptAssignedIssues: true\n");
    let settings = load_config(&path).expect("A partial inbox section must load");

    assert!(settings.inbox.auto_accept_assigned_issues);
    assert_eq!(
        settings.inbox.check_interval_minutes, 15,
        "Setting one inbox key must not zero the other, which would silently disable the importer"
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn a_malformed_inbox_section_degrades_to_defaults_instead_of_failing_the_load() {
    // A bad hand-edit to one section must not take Tendril down, the same rule `codingAgents`
    // follows.
    for body in [
        "inbox: not-a-mapping\n",
        "inbox: []\n",
        "inbox:\n  checkIntervalMinutes: \"every so often\"\n",
    ] {
        let path = write_config(body);
        let settings =
            load_config(&path).unwrap_or_else(|e| panic!("Config {body:?} must still load: {e}"));

        assert!(!settings.inbox.auto_accept_assigned_issues);
        assert_eq!(settings.inbox.check_interval_minutes, 15);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

#[test]
fn an_inbox_section_survives_a_save_load_round_trip() {
    let mut settings = TendrilSettings::default();
    settings.inbox.auto_accept_assigned_issues = true;
    settings.inbox.check_interval_minutes = 30;

    let path = write_config("");
    save_config(&path, &settings).expect("Saving settings with an inbox section must succeed");
    let reloaded = load_config(&path).expect("Reloading saved settings must succeed");

    assert!(reloaded.inbox.auto_accept_assigned_issues);
    assert_eq!(reloaded.inbox.check_interval_minutes, 30);

    let raw = std::fs::read_to_string(&path).expect("Saved config must be readable");
    assert!(
        raw.contains("autoAcceptAssignedIssues"),
        "The section must be written in the camelCase the original app reads, got:\n{raw}"
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
