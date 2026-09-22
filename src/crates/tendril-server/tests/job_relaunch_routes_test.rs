use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_database_path, MasterGuard};
use tendril_core::db::jobs::insert_job;
use tendril_core::db::open_database;
use tendril_core::models::{ExecutePlanArgs, JobArgs, JobItem, JobStatus};
use tendril_server::{create_router, AppState};

struct TestServer {
    pub tendril_home: PathBuf,
    pub port: u16,
    pub secret: String,
    _guard: MasterGuard,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-relaunch-routes-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let secret = tendril_core::config::generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, "127.0.0.1", "http").unwrap();

    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));
    let app = create_router(state);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .unwrap();
    });

    TestServer {
        tendril_home,
        port,
        secret,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

#[tokio::test]
async fn test_relaunch_and_retry_routes() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{}", server.port);

    // 1. Non-existent job returns 404
    let res = client
        .post(format!("{}/api/jobs/nonexistent/relaunch", base))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({ "feedback": "please fix" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NOT_FOUND);

    let res = client
        .post(format!("{}/api/jobs/nonexistent/retry", base))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({ "feedback": "please fix" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NOT_FOUND);

    // 2. Seed a stopped job
    let conn = open_database(&get_database_path(&server.tendril_home)).unwrap();
    let args = JobArgs::ExecutePlan(ExecutePlanArgs {
        folder_path: server.tendril_home.join("Plans").join("00100").to_string_lossy().to_string(),
        note: Some("Initial execution".to_string()),
    });
    let mut job = JobItem::new(
        "00100".to_string(),
        args.job_type().to_string(),
        args.plan_folder().unwrap_or("").to_string(),
        "FixtureProject".to_string(),
    );
    job.status = JobStatus::Stopped;
    job.args = Some(serde_json::to_string(&args).unwrap());
    job.typed_args = Some(args);
    insert_job(&conn, &job).unwrap();

    // 3. Relaunch stopped job with feedback
    let res = client
        .post(format!("{}/api/jobs/00100/relaunch", base))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({ "feedback": "relaunch with updated prompt" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["status"], "Started");
    assert!(body["jobId"].is_string());

    // 4. Retry stopped job with feedback
    let res = client
        .post(format!("{}/api/jobs/00100/retry", base))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({ "feedback": "retry step 2" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["status"], "Started");
    assert!(body["jobId"].is_string());
}
