//! The change stream: authentication, delivery, and the mirror-before-broadcast ordering.
//!
//! The harness is the one from `plan_events_test.rs`: a temp Tendril home, a loopback listener on
//! port 0, a real `MasterGuard`, and state built with `AppState::with_plans_dir`.

use reqwest::header::AUTHORIZATION;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_core::plans::{create_plan, CreatePlanOptions};
use tendril_core::watcher::{ChangeEvent, ChangeTarget};
use tendril_server::{create_router, spawn_change_watcher, AppState};

struct TestServer {
    tendril_home: PathBuf,
    port: u16,
    host: String,
    secret: String,
    state: Arc<AppState>,
    _guard: MasterGuard,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl TestServer {
    fn url(&self, path: &str) -> String {
        format!("http://{}:{}{}", self.host, self.port, path)
    }
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
        "tendril-change-events-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    // The watcher canonicalises its own paths; the home is canonicalised here too so a `FolderPath`
    // round-tripped through the database compares equal on macOS, where the temp dir is a symlink.
    let tendril_home = std::fs::canonicalize(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();

    let secret = generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str, "http").unwrap();

    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();

    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));

    let app = create_router(state.clone());
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    TestServer {
        tendril_home,
        port,
        host: host_str,
        secret,
        state,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

fn plan_options(title: &str) -> CreatePlanOptions {
    CreatePlanOptions {
        title: title.to_string(),
        project: "test-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    }
}

/// Reads from an SSE response until `needle` appears in the accumulated body, or the budget expires.
async fn read_until(
    resp: &mut reqwest::Response,
    needle: &str,
    budget: Duration,
) -> Option<String> {
    let deadline = tokio::time::Instant::now() + budget;
    let mut body = String::new();
    loop {
        let remaining = deadline.checked_duration_since(tokio::time::Instant::now())?;
        let chunk = tokio::time::timeout(remaining, resp.chunk()).await.ok()?;
        match chunk {
            Ok(Some(bytes)) => {
                body.push_str(&String::from_utf8_lossy(&bytes));
                if body.contains(needle) {
                    return Some(body);
                }
            }
            // The stream never ends on its own, so either of these means something is wrong.
            Ok(None) | Err(_) => return None,
        }
    }
}

#[tokio::test]
async fn change_stream_requires_bearer_token() {
    let server = start_test_server().await;

    let resp = reqwest::Client::new()
        .get(server.url("/api/changes/events"))
        .send()
        .await
        .expect("request sent");

    assert_eq!(
        resp.status(),
        reqwest::StatusCode::UNAUTHORIZED,
        "the change stream must sit behind the same bearer auth as every other route"
    );
}

#[tokio::test]
async fn change_stream_delivers_broadcast_event() {
    let server = start_test_server().await;

    let mut resp = reqwest::Client::new()
        .get(server.url("/api/changes/events"))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .expect("request sent");
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    assert_eq!(
        resp.headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.starts_with("text/event-stream")),
        Some(true)
    );

    // The subscription is created when the handler runs, so publish only once the response is live.
    tokio::time::sleep(Duration::from_millis(100)).await;
    server
        .state
        .change_tx
        .send(ChangeEvent::new(ChangeTarget::Plans {
            folder: Some("00576-Foo".to_string()),
        }))
        .expect("a live subscriber exists");

    let body = read_until(&mut resp, "00576-Foo", Duration::from_secs(5))
        .await
        .expect("no change frame arrived");

    assert!(body.contains("event: change"), "unexpected frame: {body}");
    assert!(
        body.contains(r#"{"type":"fs.change","target":{"kind":"plans","folder":"00576-Foo"}}"#),
        "the frame must carry the wire contract verbatim: {body}"
    );
}

#[tokio::test]
async fn plans_change_syncs_database_before_broadcast() {
    let server = start_test_server().await;

    // The plan exists on disk but has no database row: `create_plan` writes the folder, and only the
    // routes that call `sync_plan` mirror it. That gap is what the watcher closes.
    let pf = create_plan(&server.state.plans_dir, plan_options("Ordering Guarantee"))
        .expect("create plan");
    let client = reqwest::Client::new();
    let before: serde_json::Value = client
        .get(server.url("/api/plans"))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        before.as_array().map(|a| a.len()),
        Some(0),
        "the plan must start un-mirrored for this test to mean anything"
    );

    let mut change_rx = server.state.change_tx.subscribe();
    let _watcher = spawn_change_watcher(server.state.clone()).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    // A foreign write: `create_plan` went through the locked write path and left a self-write note,
    // which the watcher correctly ignores. Clearing it and rewriting makes this look exactly like a
    // CLI in another process editing the file.
    tendril_core::watcher::self_writes::clear_self_writes();
    let yaml_path = server
        .state
        .plans_dir
        .join(&pf.folder_name)
        .join("plan.yaml");
    let raw = std::fs::read_to_string(&yaml_path).unwrap();
    std::fs::write(&yaml_path, raw).unwrap();

    let event = tokio::time::timeout(Duration::from_secs(5), change_rx.recv())
        .await
        .expect("no event within the budget")
        .expect("channel stayed open");
    assert!(matches!(event.target, ChangeTarget::Plans { .. }));

    // The ordering guarantee from §4.3: the mirror is already updated by the time the event is
    // observable, so a client that refetches immediately cannot read a row older than its wake-up.
    let after: serde_json::Value = client
        .get(server.url("/api/plans"))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let plans = after.as_array().expect("array of plans");
    assert_eq!(
        plans.len(),
        1,
        "the database was not synced before the event was broadcast: {after}"
    );
    assert_eq!(plans[0]["metadata"]["title"], "Ordering Guarantee");
}
