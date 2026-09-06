use axum::{routing::get, Json, Router};
use serde_json::json;
use std::net::SocketAddr;
use tendril_app_lib::daemon::{
    discover_daemon_status, probe_daemon_health, read_master, DaemonConnectionState, MasterInfo,
};
use tokio::net::TcpListener;

async fn spawn_mock_daemon(secret: &'static str) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let app = Router::new()
        .route(
            "/api/ping",
            get(|| async { "pong" }),
        )
        .route(
            "/api/health",
            get(move |headers: axum::http::HeaderMap| async move {
                if let Some(auth) = headers.get(axum::http::header::AUTHORIZATION) {
                    if let Ok(auth_str) = auth.to_str() {
                        if auth_str == format!("Bearer {secret}") {
                            return (
                                axum::http::StatusCode::OK,
                                Json(json!({
                                    "status": "ok",
                                    "version": "0.1.0",
                                    "apiVersion": 1,
                                    "capabilities": ["plans", "jobs", "realtime"]
                                })),
                            );
                        }
                    }
                }
                (
                    axum::http::StatusCode::UNAUTHORIZED,
                    Json(json!({ "error": "Unauthorized" })),
                )
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind mock server");
    let addr = listener.local_addr().expect("Failed to get local addr");

    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    (addr, handle)
}

#[tokio::test]
async fn test_mock_daemon_discovery_flow() {
    let secret = "mock-daemon-secret-12345";
    let (addr, _server_handle) = spawn_mock_daemon(secret).await;

    // Test probe_daemon_health with valid secret
    let health_res = probe_daemon_health("http", "127.0.0.1", addr.port(), secret).await;
    assert!(health_res.is_ok(), "Probe health should succeed with valid secret");
    let (api_version, capabilities) = health_res.unwrap();
    assert_eq!(api_version, 1);
    assert_eq!(capabilities, vec!["plans", "jobs", "realtime"]);

    // Test probe_daemon_health with wrong secret
    let unauth_res = probe_daemon_health("http", "127.0.0.1", addr.port(), "wrong-secret").await;
    assert_eq!(unauth_res, Err(DaemonConnectionState::Unauthenticated));

    // Test with temporary directory and .master file
    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let master_info = MasterInfo {
        port: addr.port(),
        pid: std::process::id(),
        secret: secret.to_string(),
        started_at: "2026-09-06T07:00:00Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec!["plans".to_string(), "jobs".to_string(), "realtime".to_string()],
    };

    let master_json = serde_json::to_string_pretty(&master_info).unwrap();
    std::fs::write(temp_dir.path().join(".master"), master_json).unwrap();

    let read_info = read_master(temp_dir.path()).expect("read_master must find file");
    assert_eq!(read_info.port, addr.port());
    assert_eq!(read_info.pid, std::process::id());

    // Test full discovery via TENDRIL_HOME env var
    std::env::set_var("TENDRIL_HOME", temp_dir.path().to_str().unwrap());
    let status = discover_daemon_status().await;
    assert_eq!(status.state, DaemonConnectionState::Connected);
    assert_eq!(status.port, Some(addr.port()));
    assert_eq!(status.secret, Some(secret.to_string()));
    assert_eq!(status.capabilities, vec!["plans", "jobs", "realtime"]);
}

#[tokio::test]
async fn test_offline_daemon_discovery() {
    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let master_info = MasterInfo {
        port: 59999, // inactive port
        pid: std::process::id(),
        secret: "offline-secret".to_string(),
        started_at: "2026-09-06T07:00:00Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec![],
    };

    let master_json = serde_json::to_string_pretty(&master_info).unwrap();
    std::fs::write(temp_dir.path().join(".master"), master_json).unwrap();

    std::env::set_var("TENDRIL_HOME", temp_dir.path().to_str().unwrap());
    let status = discover_daemon_status().await;
    assert_eq!(status.state, DaemonConnectionState::Disconnected);
}
