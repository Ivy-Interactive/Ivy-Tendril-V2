//! `POST /api/jobs/query`, `POST /api/tables/{table}/query` and friends over real HTTP.
//!
//! The unit tests in `tendril_core::db::query` cover the SQL; these cover the contract a table widget
//! actually depends on — that a page is a page, that the total is the filtered total, that a bad
//! column is a 400 rather than a 500, and that asking for Arrow gets an honest 406 instead of JSON
//! mislabelled as a columnar stream.

use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_database_path, MasterGuard};
use tendril_core::db::{insert_job, open_database, sync_plan};
use tendril_core::models::{JobItem, JobStatus, PlanFile, PlanMetadata, PlanStatus};
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
        "tendril-table-query-server-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = tendril_core::config::generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str, "http").unwrap();

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
        let _ = axum::serve(tokio_listener, app)
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

/// Twenty-five jobs: odd ids `Completed` on project `alpha`, even ids `Queued` on `beta`.
fn seed_jobs(server: &TestServer) {
    let conn = open_database(&get_database_path(&server.tendril_home)).expect("open database");
    let base = chrono::Utc::now();
    for n in 1..=25 {
        let id = format!("{n:05}");
        let mut job = JobItem::new(
            id.clone(),
            "ExecutePlan".to_string(),
            format!("Plans/{id}"),
            if n % 2 == 0 { "beta" } else { "alpha" }.to_string(),
        );
        job.status = if n % 2 == 0 {
            JobStatus::Queued
        } else {
            JobStatus::Completed
        };
        job.started_at = Some(base);
        job.completed_at = if n % 2 == 0 {
            None
        } else {
            Some(base + chrono::Duration::minutes(i64::from(n)))
        };
        job.cost = Some(f64::from(n));
        insert_job(&conn, &job).expect("insert job");
    }
}

fn seed_plan(server: &TestServer, id: i32) {
    let conn = open_database(&get_database_path(&server.tendril_home)).expect("open database");
    let now = chrono::Utc::now();
    let plan = PlanFile {
        metadata: PlanMetadata {
            id,
            project: "TableProject".to_string(),
            level: "Feature".to_string(),
            title: format!("Plan {id}"),
            state: PlanStatus::Draft,
            repos: Vec::new(),
            commits: Vec::new(),
            prs: Vec::new(),
            verifications: Vec::new(),
            related_plans: Vec::new(),
            depends_on: Vec::new(),
            created: now,
            updated: now + chrono::Duration::minutes(i64::from(id)),
            initial_prompt: None,
            source_url: None,
            partial_delivery: false,
            chat_session_id: None,
            recommendations: None,
        },
        latest_revision_content: "a very long revision body ".repeat(64),
        folder_path: format!("/plans/{id:05}-Plan"),
        folder_name: format!("{id:05}-Plan"),
        yaml_raw: "yaml: raw".to_string(),
        revision_count: 1,
    };
    sync_plan(&conn, &plan).expect("insert plan");
}

async fn post(
    server: &TestServer,
    path: &str,
    body: serde_json::Value,
) -> (reqwest::StatusCode, serde_json::Value) {
    let resp = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{}{path}", server.port))
        .header("Authorization", format!("Bearer {}", server.secret))
        .json(&body)
        .send()
        .await
        .expect("request");
    let status = resp.status();
    let json = resp.json().await.unwrap_or(serde_json::Value::Null);
    (status, json)
}

fn row_ids(body: &serde_json::Value) -> Vec<String> {
    body["rows"]
        .as_array()
        .unwrap_or_else(|| panic!("expected rows, got {body}"))
        .iter()
        .map(|row| row["id"].as_str().expect("row id").to_string())
        .collect()
}

#[tokio::test]
async fn an_empty_body_is_the_first_page_of_the_jobs_list() {
    let server = start_test_server().await;
    seed_jobs(&server);

    let (status, body) = post(&server, "/api/jobs/query", serde_json::json!({})).await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    assert_eq!(body["totalRows"], 25);
    assert_eq!(body["encoding"], "application/json");
    // Unfinished first, then finished newest-first — the same order `GET /api/jobs` uses.
    let ids = row_ids(&body);
    assert_eq!(ids.len(), 25);
    assert_eq!(&ids[..3], &["00024", "00022", "00020"]);
}

#[tokio::test]
async fn the_rows_are_the_same_job_shape_the_list_route_returns() {
    // A view moving from `GET /api/jobs` to this route must not need a second DTO.
    let server = start_test_server().await;
    seed_jobs(&server);

    let listed: serde_json::Value = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{}/api/jobs", server.port))
        .header("Authorization", format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let (_, queried) = post(&server, "/api/jobs/query", serde_json::json!({})).await;

    let first_listed = &listed.as_array().expect("array")[0];
    let first_queried = &queried["rows"].as_array().expect("rows")[0];
    assert_eq!(first_listed, first_queried);
}

#[tokio::test]
async fn a_window_carries_the_filtered_total_not_its_own_size() {
    let server = start_test_server().await;
    seed_jobs(&server);

    let (status, body) = post(
        &server,
        "/api/jobs/query",
        serde_json::json!({
            "filter": { "condition": { "column": "status", "function": "inSet",
                                       "args": ["Queued"] } },
            "sort": [{ "column": "id", "direction": "Ascending" }],
            "offset": 4,
            "limit": 3
        }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    assert_eq!(row_ids(&body), vec!["00010", "00012", "00014"]);
    assert_eq!(body["rowCount"], 3);
    assert_eq!(body["totalRows"], 12, "12 of the 25 jobs are Queued");
    assert_eq!(body["offset"], 4);
    assert_eq!(body["limit"], 3);
}

#[tokio::test]
async fn a_sort_the_client_could_not_do_itself() {
    let server = start_test_server().await;
    seed_jobs(&server);

    // The three most expensive jobs, without the client seeing the other 22.
    let (_, body) = post(
        &server,
        "/api/jobs/query",
        serde_json::json!({
            "sort": [{ "column": "cost", "direction": "Descending" }],
            "limit": 3,
            "aggregations": [{ "column": "cost", "function": "sum" }]
        }),
    )
    .await;
    assert_eq!(row_ids(&body), vec!["00025", "00024", "00023"]);
    // The footer describes all 25 rows even though three crossed the wire.
    assert_eq!(body["aggregations"][0]["value"], 325.0);
}

#[tokio::test]
async fn select_columns_narrows_the_row_but_always_keeps_the_id() {
    let server = start_test_server().await;
    seed_jobs(&server);

    let (status, body) = post(
        &server,
        "/api/jobs/query",
        serde_json::json!({ "selectColumns": ["status", "project"], "limit": 1 }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    let row = &body["rows"][0];
    let keys: Vec<&str> = row
        .as_object()
        .expect("row object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, vec!["id", "project", "status"]);
}

#[tokio::test]
async fn a_column_that_does_not_exist_is_a_400_that_says_so() {
    let server = start_test_server().await;
    seed_jobs(&server);

    for column in ["nope", "Status; DROP TABLE Jobs", "(SELECT 1)"] {
        let (status, body) = post(
            &server,
            "/api/jobs/query",
            serde_json::json!({
                "filter": { "condition": { "column": column, "function": "isNotNull" } }
            }),
        )
        .await;
        assert_eq!(
            status,
            reqwest::StatusCode::BAD_REQUEST,
            "column {column:?} should be a bad request, got {body}"
        );
        assert!(body["error"].is_string(), "{body}");
    }

    // The table is intact, which is the point of the previous assertion.
    let (_, body) = post(&server, "/api/jobs/query", serde_json::json!({})).await;
    assert_eq!(body["totalRows"], 25);
}

#[tokio::test]
async fn an_unknown_filter_function_is_a_400() {
    let server = start_test_server().await;
    seed_jobs(&server);

    let (status, _) = post(
        &server,
        "/api/jobs/query",
        serde_json::json!({
            "filter": { "condition": { "column": "status", "function": "sqlInject",
                                       "args": ["x"] } }
        }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn asking_for_arrow_is_a_406_that_names_what_is_missing() {
    let server = start_test_server().await;
    seed_jobs(&server);

    for path in ["/api/jobs/query", "/api/tables/jobs/query"] {
        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{}{path}", server.port))
            .header("Authorization", format!("Bearer {}", server.secret))
            .header("Accept", "application/vnd.apache.arrow.stream")
            .json(&serde_json::json!({}))
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), reqwest::StatusCode::NOT_ACCEPTABLE, "{path}");
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["supported"], serde_json::json!(["application/json"]));
    }
}

#[tokio::test]
async fn the_generic_route_pages_plans_with_no_dto_of_its_own() {
    let server = start_test_server().await;
    for id in 1..=5 {
        seed_plan(&server, id);
    }

    let (status, body) = post(
        &server,
        "/api/tables/plans/query",
        serde_json::json!({
            "selectColumns": ["id", "title", "state"],
            "sort": [{ "column": "id", "direction": "Descending" }],
            "limit": 2
        }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    assert_eq!(body["totalRows"], 5);
    assert_eq!(body["rows"][0]["id"], 5);
    assert_eq!(body["rows"][0]["title"], "Plan 5");
    // The projection is the `SELECT` list here, so the 1.6 kB revision body was never read.
    let keys: Vec<&str> = body["rows"][0]
        .as_object()
        .expect("row object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, vec!["id", "state", "title"]);
}

#[tokio::test]
async fn a_table_nobody_exposed_is_a_404_listing_the_ones_that_exist() {
    let server = start_test_server().await;

    let (status, body) = post(&server, "/api/tables/Metadata/query", serde_json::json!({})).await;
    assert_eq!(status, reqwest::StatusCode::NOT_FOUND, "{body}");
    assert_eq!(body["tables"], serde_json::json!(["jobs", "plans"]));

    let (status, _) = post(
        &server,
        "/api/tables/sqlite_master/query",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_schema_route_publishes_the_allowlist_a_filter_ui_needs() {
    let server = start_test_server().await;
    seed_jobs(&server);

    let resp = reqwest::Client::new()
        .get(format!(
            "http://127.0.0.1:{}/api/tables/jobs/schema",
            server.port
        ))
        .header("Authorization", format!("Bearer {}", server.secret))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();

    let columns = body["columns"].as_array().expect("columns");
    assert!(columns.iter().any(|c| c["name"] == "Status"));
    assert!(columns.iter().any(|c| c["declaredType"] == "REAL"));
    let functions = body["filterFunctions"].as_array().expect("functions");
    assert!(functions.contains(&serde_json::json!("inSet")));
}

#[tokio::test]
async fn a_facet_can_list_a_columns_values_without_fetching_rows() {
    let server = start_test_server().await;
    seed_jobs(&server);

    let (status, body) = post(
        &server,
        "/api/tables/jobs/values",
        serde_json::json!({ "column": "project" }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    assert_eq!(body["values"], serde_json::json!(["alpha", "beta"]));
    assert_eq!(body["totalValues"], 2);

    let (status, _) = post(
        &server,
        "/api/tables/jobs/values",
        serde_json::json!({ "column": "not_a_column" }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_client_is_told_when_the_page_it_holds_has_shifted() {
    let server = start_test_server().await;
    seed_jobs(&server);

    let (_, first) = post(&server, "/api/jobs/query", serde_json::json!({})).await;
    let token = first["versionToken"].as_str().expect("token").to_string();

    let (_, unchanged) = post(
        &server,
        "/api/jobs/query",
        serde_json::json!({ "versionToken": token.clone() }),
    )
    .await;
    assert_eq!(unchanged["stale"], false);

    let conn = open_database(&get_database_path(&server.tendril_home)).expect("open database");
    let mut extra = JobItem::new(
        "00099".to_string(),
        "ExecutePlan".to_string(),
        "Plans/00099".to_string(),
        "alpha".to_string(),
    );
    extra.status = JobStatus::Queued;
    insert_job(&conn, &extra).expect("insert job");

    let (_, after) = post(
        &server,
        "/api/jobs/query",
        serde_json::json!({ "versionToken": token }),
    )
    .await;
    assert_eq!(after["stale"], true);
    assert_eq!(after["totalRows"], 26);
}

#[tokio::test]
async fn a_limit_larger_than_the_ceiling_is_clamped_rather_than_refused() {
    let server = start_test_server().await;
    seed_jobs(&server);

    let (status, body) = post(
        &server,
        "/api/jobs/query",
        serde_json::json!({ "limit": 10_000_000 }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    assert_eq!(body["limit"], 5000);
}

#[tokio::test]
async fn the_query_routes_require_the_bearer_token() {
    let server = start_test_server().await;

    for path in [
        "/api/jobs/query",
        "/api/tables/jobs/query",
        "/api/tables/jobs/values",
    ] {
        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{}{path}", server.port))
            .json(&serde_json::json!({}))
            .send()
            .await
            .expect("request");
        assert_eq!(
            resp.status(),
            reqwest::StatusCode::UNAUTHORIZED,
            "{path} must be behind auth"
        );
    }
}
