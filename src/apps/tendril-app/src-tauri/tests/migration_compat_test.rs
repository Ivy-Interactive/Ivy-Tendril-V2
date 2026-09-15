use std::path::Path;
use tendril_app_lib::daemon::{discover_daemon_status, DaemonConnectionState};
use tendril_app_lib::models::TendrilConfigDto;
use tendril_app_lib::service::MasterDiscovery;

const FIXTURES_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/migration");

#[tokio::test]
async fn test_ivy_master_reports_foreign_master_state() {
    let fixture_path = Path::new(FIXTURES_DIR).join("ivy_master.json");
    let content = std::fs::read_to_string(&fixture_path).expect("read ivy_master.json");

    let temp_dir = tempfile::tempdir().expect("tempdir creation");
    std::fs::write(temp_dir.path().join(".master"), &content).expect("write .master");

    let discovery = MasterDiscovery::with_home(temp_dir.path());

    // MasterDiscovery read_master rejects foreign master
    let read_res = discovery.read_master();
    assert!(
        read_res.is_err(),
        "Foreign master must not parse as valid Rust MasterInfo"
    );
    assert!(read_res.unwrap_err().contains("Foreign daemon detected"));

    // MasterDiscovery get_service_info reports ForeignMaster
    let info = discovery.get_service_info().await;
    assert_eq!(info.state, "ForeignMaster");
    assert!(info.message.contains("Foreign or legacy daemon detected"));
    assert!(info.message.contains("Ivy Tendril"));

    // daemon discover_daemon_status reports ForeignMaster
    std::env::set_var("TENDRIL_HOME", temp_dir.path().to_str().unwrap());
    let daemon_status = discover_daemon_status().await;
    assert_eq!(daemon_status.state, DaemonConnectionState::ForeignMaster);
    assert!(daemon_status
        .message
        .contains("Foreign or legacy daemon detected"));
}

#[test]
fn test_legacy_v0_plan_yaml_compatibility() {
    let fixture_path = Path::new(FIXTURES_DIR).join("legacy_v0_plan.yaml");
    let content = std::fs::read_to_string(&fixture_path).expect("read legacy_v0_plan.yaml");

    let parsed: serde_yaml::Value = serde_yaml::from_str(&content).expect("parse legacy plan yaml");
    assert_eq!(
        parsed.get("state").and_then(|s| s.as_str()),
        Some("ReadyForReview")
    );
    assert_eq!(
        parsed.get("project").and_then(|p| p.as_str()),
        Some("ivy-tendril")
    );
    assert!(
        parsed.get("schemaVersion").is_none(),
        "v0 plans lack schemaVersion"
    );
}

#[test]
fn test_chat_session_id_plan_yaml_preservation() {
    let fixture_path = Path::new(FIXTURES_DIR).join("chat_session_id_plan.yaml");
    let content = std::fs::read_to_string(&fixture_path).expect("read chat_session_id_plan.yaml");

    let parsed: serde_yaml::Value =
        serde_yaml::from_str(&content).expect("parse chatSessionId plan yaml");
    assert_eq!(
        parsed.get("chatSessionId").and_then(|c| c.as_str()),
        Some("381b81c0e24045a5a95ec513d7dddab2")
    );

    // Assert round-trip through Value retains chatSessionId
    let roundtripped = serde_yaml::to_string(&parsed).expect("serialize plan yaml");
    assert!(roundtripped.contains("chatSessionId: 381b81c0e24045a5a95ec513d7dddab2"));
}

#[test]
fn test_pascal_case_chat_session_compatibility() {
    let fixture_path = Path::new(FIXTURES_DIR).join("pascal_case_chat.json");
    let content = std::fs::read_to_string(&fixture_path).expect("read pascal_case_chat.json");

    let val: serde_json::Value =
        serde_json::from_str(&content).expect("parse pascal case chat json");
    assert_eq!(val["Id"].as_str(), Some("381b81c0e24045a5a95ec513d7dddab2"));
    assert_eq!(
        val["Title"].as_str(),
        Some("Chat Input and Sidebar Stability")
    );
    assert_eq!(val["AgentId"].as_str(), Some("antigravity"));
    assert!(val["SpawnedJobIds"].as_array().is_some());
    assert_eq!(val["SpawnedJobIds"].as_array().unwrap().len(), 2);

    let messages = val["Messages"].as_array().expect("Messages array");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["Role"].as_str(), Some("user"));
    assert_eq!(messages[1]["Role"].as_str(), Some("assistant"));
    assert!(messages[1]["RawStream"].as_str().is_some());
}

#[test]
fn test_ivy_config_yaml_preserves_unknown_keys_on_app_mapping() {
    let fixture_path = Path::new(FIXTURES_DIR).join("ivy_config.yaml");
    let content = std::fs::read_to_string(&fixture_path).expect("read ivy_config.yaml");

    let parsed_yaml: serde_yaml::Value =
        serde_yaml::from_str(&content).expect("parse ivy_config.yaml");

    // Check ivy-only keys exist in the fixture
    let ivy_keys = [
        "editor",
        "promptwares",
        "codingAgents",
        "shareTunnel",
        "vault",
        "vaults",
        "llm",
        "auth",
        "api",
        "tunnel",
        "desktopNotifications",
        "sidebarOpen",
        "themeMode",
        "dismissedUpdateVersion",
    ];

    for key in ivy_keys {
        assert!(
            parsed_yaml.get(key).is_some(),
            "Ivy-specific key '{key}' must be present in ivy_config.yaml fixture"
        );
    }

    // Deserializing into TendrilConfigDto via raw preservation
    let json_val: serde_json::Value =
        serde_yaml::from_str(&content).expect("convert to json value");
    let config_dto = TendrilConfigDto {
        coding_agent: json_val
            .get("codingAgent")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        job_timeout: json_val.get("jobTimeout").and_then(|v| v.as_u64()),
        max_concurrent_jobs: json_val
            .get("maxConcurrentJobs")
            .and_then(|v| v.as_u64())
            .map(|u| u as usize),
        plan_template: json_val
            .get("planTemplate")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        theme: json_val
            .get("theme")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        desktop_notifications: json_val.get("desktopNotifications").and_then(|v| v.as_bool()),
        raw: json_val.clone(),
    };

    assert_eq!(config_dto.coding_agent.as_deref(), Some("antigravity"));
    assert_eq!(config_dto.job_timeout, Some(120));
    assert_eq!(config_dto.desktop_notifications, Some(true));

    // Assert that raw contains every ivy key so nothing is dropped on app write/roundtrip
    for key in ivy_keys {
        assert!(
            config_dto.raw.get(key).is_some(),
            "TendrilConfigDto.raw must preserve key '{key}'"
        );
    }
}

/// `desktopNotifications` is a tri-state on the wire: present and true, present and false, or absent.
/// The DTO must keep absent distinct from false — the frontend store defaults an absent key to *on*,
/// matching the legacy shell's `DesktopNotifications != false`, so collapsing the two here would
/// silently switch notifications off for every config that has never been toggled.
#[test]
fn test_desktop_notifications_absent_is_distinct_from_false() {
    let enabled: TendrilConfigDto =
        serde_json::from_str(r#"{"desktopNotifications":true}"#).expect("deserialize enabled");
    assert_eq!(enabled.desktop_notifications, Some(true));

    let disabled: TendrilConfigDto =
        serde_json::from_str(r#"{"desktopNotifications":false}"#).expect("deserialize disabled");
    assert_eq!(disabled.desktop_notifications, Some(false));

    let absent: TendrilConfigDto =
        serde_json::from_str(r#"{"theme":"dark"}"#).expect("deserialize absent");
    assert_eq!(absent.desktop_notifications, None);

    // Absent stays absent on the way back out, so a GET/PUT round trip never writes the key the
    // operator has not set.
    let round_tripped = serde_json::to_string(&absent).expect("serialize absent");
    assert!(
        !round_tripped.contains("desktopNotifications"),
        "an unset desktopNotifications must not be serialized, got {round_tripped}"
    );
}
