use tendril_core::config::{load_config, save_config, update_config_raw, TendrilSettings};

const SAMPLE_IVY_CONFIG: &str = r##"
codingAgent: claude
jobTimeout: 30
staleOutputTimeout: 10
gitTimeout: 10
maxConcurrentJobs: 20
projects:
  - name: my-project
    color: Blue
    repos:
      - path: /repos/my-project
verifications: []
planTemplate: "# Plan Template"
levels:
  - name: Feature
    color: Blue
telemetry: true
theme: default
beta: false
editor:
  command: code
  args: ["-n"]
llm:
  provider: anthropic
  model: claude-3-7-sonnet
auth:
  enabled: true
  tokenExpiry: 3600
api:
  baseUrl: https://api.tendril.dev
  timeout: 30
tunnel:
  enabled: false
  provider: cloudflare
vault:
  id: v-12345
  name: main-vault
  enabled: true
vaults:
  - id: v-12345
    name: main-vault
shareTunnel:
  enabled: false
  port: 5011
codingAgents:
  custom-agent:
    command: agent-cli
desktopNotifications: true
sidebarOpen: false
themeMode: dark
dismissedUpdateVersion: 1.2.0
customSetting1: foo
customSetting2:
  nestedField: bar
customSetting3: [1, 2, 3]
"##;

#[test]
fn test_config_unknown_keys_survive_load_and_save() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-config-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");

    std::fs::write(&config_path, SAMPLE_IVY_CONFIG).unwrap();

    // Load config
    let mut settings = load_config(&config_path).expect("load_config should succeed");

    // Check modeled fields
    assert_eq!(settings.coding_agent, "claude");
    assert_eq!(settings.job_timeout, 30);

    // Verify unmodeled keys are in extra
    assert!(settings.extra.contains_key("editor"));
    assert!(settings.extra.contains_key("llm"));
    assert!(settings.extra.contains_key("auth"));
    assert!(settings.extra.contains_key("api"));
    assert!(settings.extra.contains_key("tunnel"));
    assert!(settings.extra.contains_key("vault"));
    assert!(settings.extra.contains_key("vaults"));
    assert!(settings.extra.contains_key("shareTunnel"));
    // `codingAgents` is a modeled field now, so `#[serde(flatten)] extra` can no longer claim it.
    assert!(!settings.extra.contains_key("codingAgents"));
    assert_eq!(settings.coding_agents.len(), 1);
    assert_eq!(settings.coding_agents[0].name, "custom-agent");
    assert!(settings.extra.contains_key("desktopNotifications"));
    assert!(settings.extra.contains_key("sidebarOpen"));
    assert!(settings.extra.contains_key("themeMode"));
    assert!(settings.extra.contains_key("dismissedUpdateVersion"));
    assert!(settings.extra.contains_key("customSetting1"));
    assert!(settings.extra.contains_key("customSetting2"));
    assert!(settings.extra.contains_key("customSetting3"));

    // Modify a modeled field and save
    settings.job_timeout = 45;
    save_config(&config_path, &settings).expect("save_config should succeed");

    // Re-load and verify all unmodeled sections survived structurally identical
    let reloaded: TendrilSettings = load_config(&config_path).expect("reload should succeed");
    assert_eq!(reloaded.job_timeout, 45);
    assert_eq!(reloaded.coding_agent, "claude");

    // All unmodeled keys preserved
    assert_eq!(
        reloaded.extra.get("customSetting1"),
        settings.extra.get("customSetting1")
    );
    assert_eq!(
        reloaded.extra.get("customSetting2"),
        settings.extra.get("customSetting2")
    );
    assert_eq!(
        reloaded.extra.get("customSetting3"),
        settings.extra.get("customSetting3")
    );
    assert_eq!(reloaded.extra.get("vault"), settings.extra.get("vault"));
    assert_eq!(reloaded.extra.get("editor"), settings.extra.get("editor"));

    // Clean up
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_update_config_raw_preserves_untouched_keys() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-config-update-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");

    std::fs::write(&config_path, SAMPLE_IVY_CONFIG).unwrap();

    // Partial update JSON
    let partial_update = serde_json::json!({
        "jobTimeout": 60,
        "theme": "light"
    });

    update_config_raw(&config_path, &partial_update).expect("update_config_raw should succeed");

    // Verify updated values and preserved keys
    let updated = load_config(&config_path).expect("load updated config");
    assert_eq!(updated.job_timeout, 60);
    assert_eq!(updated.theme, "light");

    // Verify untouched modeled and unmodeled keys
    assert_eq!(updated.coding_agent, "claude");
    assert!(updated.extra.contains_key("editor"));
    assert!(updated.extra.contains_key("llm"));
    assert!(updated.extra.contains_key("vault"));
    assert!(updated.extra.contains_key("desktopNotifications"));
    assert_eq!(
        updated.extra.get("customSetting1"),
        Some(&serde_json::Value::String("foo".to_string()))
    );

    let _ = std::fs::remove_dir_all(&temp_dir);
}
