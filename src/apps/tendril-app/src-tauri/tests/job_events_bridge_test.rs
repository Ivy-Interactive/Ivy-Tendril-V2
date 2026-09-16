//! The native job-event bridge: the credential goes on the request, and the stream is consumed.
//!
//! This is the consumer half of #143. The desktop app used to subscribe to `/api/jobs/:id/events`
//! from the webview, which has no bearer secret — the route is in the daemon's protected router, so
//! every subscription was answered with a 401 and the job session view never showed live output. The
//! stub daemon here refuses an unauthenticated request exactly as the real one does, so a bridge that
//! forgot the header could not pass these tests by assembling a header string it never sent.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Listener;
use tendril_app_lib::service::{job_events_bridge, MasterDiscovery};
use tokio::net::TcpListener;

const SECRET: &str = "bridge-test-secret";

/// What the stub daemon saw. Recorded so a test can assert on the request the bridge actually made,
/// not on what it intended to make.
#[derive(Debug, Default)]
struct Seen {
    authorized: Vec<bool>,
    since_lines: Vec<Option<String>>,
    kinds: Vec<Option<String>>,
    job_ids: Vec<String>,
}

type Shared = Arc<Mutex<Seen>>;

async fn events(
    State(seen): State<Shared>,
    Path(job_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    let authorized = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == format!("Bearer {SECRET}"))
        .unwrap_or(false);

    {
        let mut seen = seen.lock().unwrap();
        seen.authorized.push(authorized);
        seen.since_lines.push(query.get("since_line").cloned());
        seen.kinds.push(query.get("kinds").cloned());
        seen.job_ids.push(job_id);
    }

    if !authorized {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }

    // The line ids are what a resume point is expressed in, so they are part of the contract this
    // bridge is tested against.
    let body = concat!(
        "id: 0\nevent: event\ndata: {\"kind\":\"text\",\"text\":\"alpha\"}\n\n",
        ": keep-alive\n\n",
        "id: 1\nevent: event\ndata: {\"kind\":\"text\",\"text\":\"beta\"}\n\n",
        "event: end\ndata: {\"status\":\"Completed\"}\n\n",
    );

    (
        StatusCode::OK,
        [("content-type", "text/event-stream")],
        body,
    )
        .into_response()
}

async fn spawn_stub_daemon(seen: Shared) -> SocketAddr {
    let app = Router::new()
        .route("/api/jobs/{id}/events", get(events))
        .with_state(seen);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    addr
}

/// A temp home holding a `.master` that points at `addr`. This is where the bridge is meant to find
/// the credential; nothing in the test hands it one directly.
fn home_with_master(addr: SocketAddr, secret: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(".master"),
        serde_json::json!({
            "port": addr.port(),
            "pid": std::process::id(),
            "secret": secret,
            "startedAt": "2026-01-01T00:00:00Z",
            "host": "127.0.0.1",
            "scheme": "http",
            "version": "0.1.0",
            "apiVersion": 1,
            "capabilities": ["jobs"],
        })
        .to_string(),
    )
    .unwrap();
    dir
}

#[tokio::test]
async fn the_bridge_authenticates_from_master_and_re_emits_every_frame() {
    let seen: Shared = Arc::new(Mutex::new(Seen::default()));
    let addr = spawn_stub_daemon(seen.clone()).await;
    let home = home_with_master(addr, SECRET);

    let app = tauri::test::mock_app();
    let frames: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
    let collected = frames.clone();
    app.handle().listen("job-stream-event", move |event| {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            collected.lock().unwrap().push(value);
        }
    });

    job_events_bridge::subscribe(
        app.handle().clone(),
        MasterDiscovery::with_home(home.path()),
        "00777".to_string(),
        Some("text".to_string()),
        None,
    )
    .await
    .expect("the subscription must succeed against a daemon that accepts the credential");

    // The reader runs on a spawned task; give it long enough to drain a four-frame response.
    for _ in 0..40 {
        if frames.lock().unwrap().len() >= 3 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    {
        let seen = seen.lock().unwrap();
        assert_eq!(
            seen.authorized,
            vec![true],
            "the request must carry the bearer secret from .master, and must be made exactly once"
        );
        assert_eq!(seen.job_ids, vec!["00777".to_string()]);
        assert_eq!(seen.kinds, vec![Some("text".to_string())]);
        assert_eq!(seen.since_lines, vec![None]);
    }

    let frames = frames.lock().unwrap();
    assert_eq!(
        frames.len(),
        3,
        "two payload frames and the end frame, with the keep-alive comment dropped: {frames:?}"
    );

    assert_eq!(frames[0]["jobId"], "00777");
    assert_eq!(frames[0]["event"], "event");
    assert_eq!(frames[0]["line"], 0);
    assert_eq!(
        frames[0]["data"], r#"{"kind":"text","text":"alpha"}"#,
        "the payload must arrive verbatim; re-encoding a log line is a way to corrupt it"
    );

    assert_eq!(frames[1]["line"], 1);
    assert_eq!(frames[2]["event"], "end");
    assert_eq!(frames[2]["data"], r#"{"status":"Completed"}"#);
    assert!(
        frames[2]["line"].is_null(),
        "the terminator is not a log line and must not be mistaken for a resume point"
    );
}

#[tokio::test]
async fn a_refused_credential_is_reported_instead_of_silently_never_streaming() {
    let seen: Shared = Arc::new(Mutex::new(Seen::default()));
    let addr = spawn_stub_daemon(seen.clone()).await;
    // A `.master` whose secret the daemon does not accept: the same 401 the webview used to get.
    let home = home_with_master(addr, "wrong-secret");

    let app = tauri::test::mock_app();

    let err = job_events_bridge::subscribe(
        app.handle().clone(),
        MasterDiscovery::with_home(home.path()),
        "00778".to_string(),
        None,
        None,
    )
    .await
    .expect_err("a 401 must reach the caller");

    let rendered = format!("{err:?}");
    assert!(
        rendered.contains("401"),
        "the failure must name what happened: {rendered}"
    );
    assert_eq!(seen.lock().unwrap().authorized, vec![false]);
}

#[tokio::test]
async fn a_missing_daemon_is_reported_as_disconnected() {
    let dir = tempfile::tempdir().unwrap();
    let app = tauri::test::mock_app();

    let err = job_events_bridge::subscribe(
        app.handle().clone(),
        MasterDiscovery::with_home(dir.path()),
        "00779".to_string(),
        None,
        None,
    )
    .await
    .expect_err("no .master means no stream");

    assert!(format!("{err:?}").contains("DISCONNECTED"), "{err:?}");
}

#[tokio::test]
async fn a_resumed_subscription_asks_the_daemon_to_skip_the_prefix() {
    let seen: Shared = Arc::new(Mutex::new(Seen::default()));
    let addr = spawn_stub_daemon(seen.clone()).await;
    let home = home_with_master(addr, SECRET);

    let app = tauri::test::mock_app();

    job_events_bridge::subscribe(
        app.handle().clone(),
        MasterDiscovery::with_home(home.path()),
        "00780".to_string(),
        None,
        Some(12),
    )
    .await
    .expect("subscribe");

    assert_eq!(
        seen.lock().unwrap().since_lines,
        vec![Some("12".to_string())],
        "a remounted view must not be sent the run it already holds"
    );
}

#[tokio::test]
async fn unsubscribing_a_job_that_was_never_subscribed_is_not_an_error() {
    assert!(!job_events_bridge::unsubscribe("00781"));
}
