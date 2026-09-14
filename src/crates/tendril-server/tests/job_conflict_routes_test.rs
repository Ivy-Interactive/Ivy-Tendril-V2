//! The HTTP half of the duplicate-submission gate: a refused submission is a 409 that names the job
//! already doing the work, and `force` is how an operator overrides it.
//!
//! Both routes previously turned a refusal into something unusable — `POST /api/jobs` into a 400 and
//! `POST /api/inbox` into a 500 with no way to say "yes, again" at all.
//!
//! The predecessor is written straight into the server's database rather than submitted first. A
//! submission that is accepted here terminates on its own (the fixture home has no `Promptwares`
//! folder, so a job stops at the promptware gate before any process is spawned), which would make
//! "is it still in flight?" a race; a seeded row makes it a fact. It is also the shape the in-memory
//! conflict check cannot see, which is exactly what the persisted dedupe key is for.

use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_database_path, MasterGuard};
use tendril_core::db::jobs::insert_job;
use tendril_core::db::open_database;
use tendril_core::models::{CreatePlanArgs, ExecutePlanArgs, JobArgs, JobItem, JobStatus};
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

/// A router on a loopback port with its own throwaway `TENDRIL_HOME`, as in `server_contract_test`.
/// No maintenance loop runs here — that belongs to `run_server` — so a seeded row stays as seeded.
async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-conflict-routes-{}",
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

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    TestServer {
        tendril_home,
        port,
        secret,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

impl TestServer {
    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }

    /// The plan folder a job body points at. It is never created: none of these submissions gets far
    /// enough to need it, and a missing folder simply skips the dependency gate.
    fn plan_folder(&self, name: &str) -> String {
        self.tendril_home
            .join("Plans")
            .join(name)
            .to_string_lossy()
            .to_string()
    }

    /// Seeds an in-flight job row keyed exactly as the submission path would have keyed it.
    fn seed_inflight(&self, id: &str, args: &JobArgs) {
        let mut job = JobItem::new(
            id.to_string(),
            args.job_type().to_string(),
            args.plan_folder().unwrap_or("").to_string(),
            "FixtureProject".to_string(),
        );
        job.status = JobStatus::Running;
        job.args = Some(serde_json::to_string(args).expect("serialize job args"));
        job.typed_args = Some(args.clone());
        job.dedupe_key = args.dedupe_key();
        assert!(
            job.dedupe_key.is_some(),
            "the seeded row needs a dedupe key"
        );

        let conn = open_database(&get_database_path(&self.tendril_home)).expect("open database");
        insert_job(&conn, &job).expect("insert seeded job row");
    }
}

async fn post(
    server: &TestServer,
    path: &str,
    body: serde_json::Value,
) -> (u16, serde_json::Value) {
    let resp = reqwest::Client::new()
        .post(server.url(path))
        .bearer_auth(&server.secret)
        .json(&body)
        .send()
        .await
        .expect("post");
    let status = resp.status().as_u16();
    let json: serde_json::Value = resp.json().await.unwrap_or_default();
    (status, json)
}

fn execute_args(folder: &str) -> JobArgs {
    JobArgs::ExecutePlan(ExecutePlanArgs {
        folder_path: folder.to_string(),
        note: None,
    })
}

fn create_plan_args(project: &str, description: &str) -> JobArgs {
    JobArgs::CreatePlan(CreatePlanArgs {
        description: description.to_string(),
        project: project.to_string(),
        priority: 0,
        force: false,
        source_path: None,
        upload_session_id: None,
    })
}

#[tokio::test]
async fn post_jobs_returns_409_naming_the_existing_job() {
    let server = start_test_server().await;
    let folder = server.plan_folder("00001-Busy");
    server.seed_inflight("00900", &execute_args(&folder));

    let (status, body) = post(
        &server,
        "/api/jobs",
        serde_json::json!({ "type": "ExecutePlan", "folderPath": folder }),
    )
    .await;

    assert_eq!(status, 409, "body: {}", body);
    assert_eq!(body["status"], "Conflict");
    let error = body["error"].as_str().unwrap_or_default();
    assert!(
        error.contains("00900"),
        "the 409 must name the job holding the work: {}",
        error
    );
}

#[tokio::test]
async fn post_inbox_returns_409_naming_the_existing_job() {
    let server = start_test_server().await;
    server.seed_inflight("00900", &create_plan_args("Widgets", "Add a login form"));

    // Differs from the seeded description only in whitespace and case, which is not a difference.
    let (status, body) = post(
        &server,
        "/api/inbox",
        serde_json::json!({ "description": "  Add   a LOGIN form ", "project": "Widgets" }),
    )
    .await;

    assert_eq!(status, 409, "body: {}", body);
    assert_eq!(body["status"], "Conflict");
    let error = body["error"].as_str().unwrap_or_default();
    assert!(
        error.contains("00900"),
        "the 409 must name the job holding the work: {}",
        error
    );
}

/// A materially different request on the same project is not a duplicate, so the inbox still works.
#[tokio::test]
async fn post_inbox_accepts_a_different_description() {
    let server = start_test_server().await;
    server.seed_inflight("00900", &create_plan_args("Widgets", "Add a login form"));

    let (status, body) = post(
        &server,
        "/api/inbox",
        serde_json::json!({ "description": "Add a logout form", "project": "Widgets" }),
    )
    .await;

    assert_eq!(status, 200, "body: {}", body);
    assert_ne!(body["jobId"].as_str().unwrap_or_default(), "00900");
}

#[tokio::test]
async fn post_inbox_force_creates_a_second_job() {
    let server = start_test_server().await;
    server.seed_inflight("00900", &create_plan_args("Widgets", "Add a login form"));

    let (status, body) = post(
        &server,
        "/api/inbox",
        serde_json::json!({
            "description": "Add a login form",
            "project": "Widgets",
            "force": true
        }),
    )
    .await;

    assert_eq!(status, 200, "body: {}", body);
    let job_id = body["jobId"].as_str().unwrap_or_default();
    assert!(!job_id.is_empty(), "body: {}", body);
    assert_ne!(
        job_id, "00900",
        "force starts a second job, it does not adopt the first"
    );
}

#[tokio::test]
async fn post_jobs_with_force_creates_a_second_job() {
    let server = start_test_server().await;
    let folder = server.plan_folder("00002-Again");
    server.seed_inflight("00900", &execute_args(&folder));

    let (status, body) = post(
        &server,
        "/api/jobs?force=true",
        serde_json::json!({ "type": "ExecutePlan", "folderPath": folder }),
    )
    .await;

    assert_eq!(status, 200, "body: {}", body);
    assert_eq!(body["status"], "Started");
    assert_ne!(body["jobId"].as_str().unwrap_or_default(), "00900");
}
