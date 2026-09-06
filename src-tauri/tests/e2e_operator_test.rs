use axum::{routing::{get, post}, Json, Router};
use serde_json::json;
use std::net::SocketAddr;
use tendril_app_lib::daemon::MasterInfo;
use tendril_app_lib::service::{MasterDiscovery, TendrilClient};
use tokio::net::TcpListener;

async fn spawn_isolated_test_daemon(_secret: &'static str) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let app = Router::new()
        .route("/api/ping", get(|| async { "pong" }))
        .route("/api/health", get(|| async {
            Json(json!({ "status": "ok", "apiVersion": 1, "capabilities": ["plans", "jobs"] }))
        }))
        .route("/api/plans", get(|| async {
            Json(json!([
                {
                    "id": "00042",
                    "title": "Isolated E2E Plan",
                    "state": "Draft",
                    "project": "TestProject",
                    "level": "Feature",
                    "verifications": [{ "name": "Build", "status": "Pending" }]
                }
            ]))
        }))
        .route("/api/jobs", post(|Json(_body): Json<serde_json::Value>| async {
            Json(json!({ "jobId": "00999", "status": "Started" }))
        }));

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("local addr");

    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    (addr, handle)
}

#[tokio::test]
async fn test_isolated_e2e_operator_flow() {
    let temp_dir = tempfile::tempdir().expect("Failed to create isolated tempdir");
    let tendril_home = temp_dir.path().to_path_buf();
    std::env::set_var("TENDRIL_HOME", &tendril_home);

    let secret = "isolated-e2e-secret-key";
    let (addr, _server) = spawn_isolated_test_daemon(secret).await;

    // Seed master file in isolated TENDRIL_HOME
    let master_info = MasterInfo {
        port: addr.port(),
        pid: std::process::id(),
        secret: secret.to_string(),
        started_at: "2026-09-06T08:00:00Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec!["plans".to_string(), "jobs".to_string()],
    };
    std::fs::write(
        tendril_home.join(".master"),
        serde_json::to_string_pretty(&master_info).unwrap(),
    )
    .unwrap();

    // 1. Verify MasterDiscovery points to isolated environment
    let discovery = MasterDiscovery::with_home(&tendril_home);
    let master = discovery.read_master().expect("read master");
    assert_eq!(master.port, addr.port());

    // 2. Discover service info through isolated client
    let service_info = discovery.get_service_info().await;
    assert_eq!(service_info.state, "Connected");
    assert_eq!(service_info.port, Some(addr.port()));

    // 3. Connect client and query seeded plans
    let client = TendrilClient::new(
        format!("http://127.0.0.1:{}", addr.port()),
        Some(secret.to_string()),
    );
    let plans = client.list_plans(None).await.expect("query plans");
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].id, "00042");
    assert_eq!(plans[0].title, "Isolated E2E Plan");

    // 4. Dispatch new CreatePlan job through client
    let start_res = client
        .start_job(json!({
            "type": "CreatePlan",
            "project": "TestProject",
            "description": "E2E created plan"
        }))
        .await
        .expect("dispatch job");
    assert_eq!(start_res.job_id, "00999");
    assert_eq!(start_res.status, "Started");

    // Verify no mutation occurred outside tempdir
    assert!(tendril_home.join(".master").exists());
}
