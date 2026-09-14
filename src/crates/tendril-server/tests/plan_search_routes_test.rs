//! `GET /api/plans?q=` — the search box's route. What matters here is that FTS5 syntax the user
//! never meant to type cannot produce a 500, and that relevance order survives serialization.

use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_database_path, MasterGuard};
use tendril_core::db::{open_database, sync_plan};
use tendril_core::models::{PlanFile, PlanMetadata, PlanStatus};
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
        "tendril-plan-search-server-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = tendril_core::config::generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str).unwrap();

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

fn plan(id: i32, title: &str, content: &str) -> PlanFile {
    let now = chrono::Utc::now();
    PlanFile {
        metadata: PlanMetadata {
            id,
            project: "SearchProject".to_string(),
            level: "Feature".to_string(),
            title: title.to_string(),
            state: PlanStatus::Draft,
            repos: Vec::new(),
            commits: Vec::new(),
            prs: Vec::new(),
            verifications: Vec::new(),
            related_plans: Vec::new(),
            depends_on: Vec::new(),
            created: now,
            updated: now,
            initial_prompt: None,
            source_url: None,
            partial_delivery: false,
            chat_session_id: None,
        },
        latest_revision_content: content.to_string(),
        folder_path: format!("/plans/{:05}-Plan", id),
        folder_name: format!("{:05}-Plan", id),
        yaml_raw: String::new(),
        revision_count: 1,
    }
}

async fn search_ids(server: &TestServer, query: &str) -> Vec<i64> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://127.0.0.1:{}/api/plans", server.port))
        .query(&[("q", query)])
        .header("Authorization", format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        reqwest::StatusCode::OK,
        "query {:?} must not fail the request",
        query
    );

    let body: serde_json::Value = resp.json().await.unwrap();
    let array = body
        .as_array()
        .unwrap_or_else(|| panic!("query {:?} must return a JSON array, got {}", query, body));

    array
        .iter()
        .map(|p| p["metadata"]["id"].as_i64().expect("plan id"))
        .collect()
}

#[tokio::test]
async fn plans_search_route_handles_malformed_query() {
    let server = start_test_server().await;
    let conn = open_database(&get_database_path(&server.tendril_home)).expect("open database");
    sync_plan(&conn, &plan(1, "Ordinary plan", "")).expect("insert plan");

    for query in ["\"", "NEAR(", "AND", "*", "a:b", "(("] {
        // 200 with an array, empty or not — never a 500 from a search box.
        search_ids(&server, query).await;
    }
}

#[tokio::test]
async fn plans_search_route_returns_relevance_order() {
    let server = start_test_server().await;
    let conn = open_database(&get_database_path(&server.tendril_home)).expect("open database");

    sync_plan(&conn, &plan(1, "Worktree isolation", "")).expect("insert plan");
    let buried_content = format!(
        "{} the worktree is mentioned exactly once here. {}",
        "Filler prose about many other concerns. ".repeat(40),
        "More filler prose to dilute the term. ".repeat(40)
    );
    sync_plan(&conn, &plan(2, "Unrelated title", &buried_content)).expect("insert plan");

    // Plan 2 is the newer id, so an unranked query would put it first.
    assert_eq!(search_ids(&server, "worktree").await, vec![1, 2]);
}
