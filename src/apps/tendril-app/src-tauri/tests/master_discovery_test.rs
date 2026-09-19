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

/// A V2 daemon's own claim carries a `heartbeat` field — deliberately, because that is the name V1's
/// reaper ages a claim by, and a claim without it was deleted by any V1 CLI on the machine. That made
/// the field useless as a "this is V1" marker, and while it was still treated as one the app refused
/// every daemon it had itself just launched. `schemaVersion` is the discriminator: V1 wrote none.
#[tokio::test]
async fn a_v2_claim_with_a_heartbeat_is_not_foreign() {
    let temp_dir = tempfile::tempdir().expect("tempdir creation");
    let discovery = MasterDiscovery::with_home(temp_dir.path());

    // The shape `tendril run` writes today (`MasterClaim::for_this_process`).
    let claim = serde_json::json!({
        "port": 5123,
        "pid": std::process::id(),
        "secret": "v2-secret",
        "startedAt": "2026-09-16T16:08:56.771157+00:00",
        "host": "127.0.0.1",
        "version": "0.1.0",
        "apiVersion": 1,
        "capabilities": ["jobs", "plans"],
        "scheme": "http",
        "heartbeat": "2026-09-16T16:09:56.777Z",
        "schemaVersion": 2,
        "pidStartedAt": "Wed Sep 16 18:08:56 2026"
    });
    std::fs::write(discovery.master_path(), claim.to_string()).unwrap();

    let master = discovery
        .read_master()
        .expect("a V2 claim must not read as a foreign daemon");
    assert_eq!(master.port, 5123);
    assert_eq!(master.secret, "v2-secret");
}
