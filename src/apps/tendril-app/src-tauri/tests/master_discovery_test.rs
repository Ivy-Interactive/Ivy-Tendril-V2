use tendril_app_lib::daemon::{parse_master_json, MasterInfo};
use tendril_app_lib::service::MasterDiscovery;

#[test]
fn test_parse_master_json_valid_and_invalid() {
    let valid_json = r#"{
        "port": 5055,
        "pid": 99999,
        "secret": "super-secret-token",
        "startedAt": "2026-09-06T08:00:00Z",
        "host": "127.0.0.1",
        "scheme": "http",
        "version": "0.1.0",
        "apiVersion": 1,
        "capabilities": ["plans", "jobs", "config"]
    }"#;

    let info = parse_master_json(valid_json).expect("valid json must parse");
    assert_eq!(info.port, 5055);
    assert_eq!(info.secret, "super-secret-token");
    assert_eq!(info.api_version, 1);
    assert_eq!(info.capabilities, vec!["plans", "jobs", "config"]);

    let invalid_json = "{ bad json }";
    assert!(parse_master_json(invalid_json).is_err());
}

#[tokio::test]
async fn test_master_discovery_missing_file_handling() {
    let temp_dir = tempfile::tempdir().expect("tempdir creation");
    let discovery = MasterDiscovery::with_home(temp_dir.path());

    // Reading missing master file should fail gracefully
    let read_res = discovery.read_master();
    assert!(read_res.is_err());
    assert!(read_res.unwrap_err().contains("Master file not found"));

    // Service info for missing master
    let info = discovery.get_service_info().await;
    assert_eq!(info.state, "NotRunning");
    assert!(info.port.is_none());
    assert!(info.message.contains("not found"));

    // Health check for missing master
    let health = discovery.check_service_health().await;
    assert!(health.is_err());
}

#[tokio::test]
async fn test_master_discovery_port_and_secret_extraction() {
    let temp_dir = tempfile::tempdir().expect("tempdir creation");
    let discovery = MasterDiscovery::with_home(temp_dir.path());

    let master_info = MasterInfo {
        port: 41234,
        pid: std::process::id(),
        secret: "token-abc-123".to_string(),
        started_at: "2026-09-06T08:00:00Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.2.0".to_string(),
        api_version: 2,
        capabilities: vec!["plans".to_string()],
    };

    let json = serde_json::to_string_pretty(&master_info).unwrap();
    std::fs::write(discovery.master_path(), json).unwrap();

    let extracted = discovery.read_master().expect("read master must succeed");
    assert_eq!(extracted.port, 41234);
    assert_eq!(extracted.secret, "token-abc-123");
    assert_eq!(extracted.api_version, 2);
    assert_eq!(extracted.pid, std::process::id());
}

#[tokio::test]
async fn test_master_discovery_foreign_ivy_shape() {
    let temp_dir = tempfile::tempdir().expect("tempdir creation");
    let discovery = MasterDiscovery::with_home(temp_dir.path());

    // Real Ivy shape from live system
    let ivy_json = r#"{
        "pid": 31677,
        "port": 5010,
        "scheme": "https",
        "startedAt": "2026-09-07T10:14:00.318863Z",
        "heartbeat": "2026-09-07T11:50:00.375398Z"
    }"#;
    std::fs::write(discovery.master_path(), ivy_json).unwrap();

    // read_master should reject foreign master
    let read_res = discovery.read_master();
    assert!(read_res.is_err());
    assert!(read_res.unwrap_err().contains("Foreign daemon detected"));

    // get_service_info should report ForeignMaster state with clear actionable message
    let info = discovery.get_service_info().await;
    assert_eq!(info.state, "ForeignMaster");
    assert!(info.message.contains("Foreign or legacy daemon detected"));
    assert!(info.message.contains("Ivy Tendril"));

    // check_service_health should report ForeignMaster and not healthy
    let health = discovery
        .check_service_health()
        .await
        .expect("health check should return response");
    assert!(!health.is_healthy);
    assert!(health.status.contains("ForeignMaster"));
}
