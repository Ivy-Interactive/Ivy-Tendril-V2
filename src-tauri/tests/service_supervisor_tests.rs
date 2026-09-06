use axum::{routing::get, Json, Router};
use serde_json::json;
use std::fs::File;
use std::io::Write;
use std::time::{Duration, Instant};
use tempfile::tempdir;

use tendril_app_lib::service::supervisor::{
    calculate_backoff_secs, redact_sensitive_tokens, CircuitBreaker, ServiceOwnership,
    ServiceSupervisor, SupervisorStatus,
};

#[tokio::test]
async fn test_adoption_of_mock_external_daemon() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();

    let app = Router::new()
        .route(
            "/api/health",
            get(|| async {
                Json(json!({
                    "apiVersion": 1,
                    "capabilities": ["plans", "jobs"]
                }))
            }),
        )
        .route("/api/ping", get(|| async { "pong" }));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let port = listener.local_addr().expect("port").port();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let current_pid = std::process::id();
    let master_content = json!({
        "port": port,
        "pid": current_pid,
        "secret": "test-secret-token",
        "startedAt": "2026-09-06T12:00:00Z",
        "host": "127.0.0.1",
        "scheme": "http",
        "version": "0.1.0",
        "apiVersion": 1,
        "capabilities": ["plans", "jobs"]
    });
    std::fs::write(tendril_home.join(".master"), master_content.to_string()).expect("write master");

    let mut supervisor = ServiceSupervisor::new(tendril_home.clone(), None);

    let res = supervisor.discover_and_adopt().await.expect("adopt");
    assert!(res.is_some(), "Should adopt running daemon");
    let info = res.unwrap();
    assert_eq!(info.status, SupervisorStatus::Connected);
    assert_eq!(info.ownership, Some(ServiceOwnership::AdoptedExternal));
    assert_eq!(info.port, Some(port));
    assert_eq!(info.pid, Some(current_pid));

    assert!(supervisor.stop_managed_service().is_ok());
    assert!(tendril_home.join(".master").exists());
}

#[test]
fn test_detection_and_atomic_cleanup_of_stale_master() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();
    let master_file = tendril_home.join(".master");

    let stale_content = json!({
        "port": 58999,
        "pid": 9999999,
        "secret": "stale-secret",
        "startedAt": "2026-01-01T00:00:00Z"
    });
    std::fs::write(&master_file, stale_content.to_string()).expect("write stale master");
    assert!(master_file.exists());

    let supervisor = ServiceSupervisor::new(tendril_home.clone(), None);
    let cleaned = supervisor.atomic_remove_stale_master().expect("cleanup");
    assert!(cleaned);
    assert!(!master_file.exists());
}

#[test]
fn test_clean_startup_of_mock_managed_daemon() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();

    let mock_bin = temp.path().join("mock_daemon.sh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut f = File::create(&mock_bin).expect("create mock daemon");
        writeln!(f, "#!/bin/sh\nsleep 5").expect("write script");
        let mut perms = f.metadata().expect("meta").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&mock_bin, perms).expect("chmod");
    }

    let mut supervisor = ServiceSupervisor::new(tendril_home.clone(), Some(mock_bin.clone()));
    let start_res = supervisor
        .start_managed_service(&mock_bin, &[])
        .expect("start managed");

    assert_eq!(start_res.status, SupervisorStatus::Starting);
    assert_eq!(start_res.ownership, Some(ServiceOwnership::Managed));
    assert!(start_res.pid.is_some());

    let lock_file = tendril_home.join(".managed_service.lock");
    assert!(lock_file.exists());

    let log_file = tendril_home.join("Logs").join("service.log");
    assert!(log_file.exists());

    supervisor.stop_managed_service().expect("stop managed");
    assert!(!lock_file.exists());
}

#[test]
fn test_crash_loop_detection_and_circuit_breaker() {
    let mut breaker = CircuitBreaker::new(5, Duration::from_secs(60));
    let now = Instant::now();

    for _ in 0..5 {
        assert!(!breaker.record_crash(now));
        assert!(!breaker.is_tripped());
    }

    assert!(breaker.record_crash(now));
    assert!(breaker.is_tripped());

    assert_eq!(calculate_backoff_secs(0), 0);
    assert_eq!(calculate_backoff_secs(1), 1);
    assert_eq!(calculate_backoff_secs(2), 2);
    assert_eq!(calculate_backoff_secs(3), 4);
    assert_eq!(calculate_backoff_secs(4), 8);
    assert_eq!(calculate_backoff_secs(5), 16);
    assert_eq!(calculate_backoff_secs(6), 30);
    assert_eq!(calculate_backoff_secs(10), 30);
}

#[test]
fn test_sensitive_token_redaction() {
    let log1 = "2026-09-06T12:00:00Z [INFO] Incoming request Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz finished";
    let redacted1 = redact_sensitive_tokens(log1);
    assert!(!redacted1.contains("eyJhbGciOiJIUzI1NiJ9.abc.xyz"));
    assert!(redacted1.contains("Bearer [REDACTED_BEARER_TOKEN]"));

    let log2 = r#"{"level":"info","secret":"my_super_secret_master_token","message":"ready"}"#;
    let redacted2 = redact_sensitive_tokens(log2);
    assert!(!redacted2.contains("my_super_secret_master_token"));
    assert!(redacted2.contains("[REDACTED_SECRET]"));
}
