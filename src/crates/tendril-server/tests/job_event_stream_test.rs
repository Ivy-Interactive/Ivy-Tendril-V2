//! The job event stream over the wire: authentication, line numbering, and resuming.
//!
//! The harness is the one from `change_events_test.rs`: a temp Tendril home, a loopback listener on
//! port 0, a real `MasterGuard`, and state built with `AppState::with_plans_dir`.
//!
//! The authentication test is the producer half of #143. The desktop app subscribed to this route
//! from the webview with no `Authorization` header at all, so every job subscription it made was
//! answered with a 401 and live agent output never appeared. Pinning the 401 here is what stops the
//! route being "fixed" by moving it out of the protected router — the credential belongs on the
//! request, and on the desktop that means the native bridge sends it.

use reqwest::header::AUTHORIZATION;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_server::{create_router, AppState};

struct TestServer {
    tendril_home: PathBuf,
    port: u16,
    host: String,
    secret: String,
    _guard: MasterGuard,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl TestServer {
    fn url(&self, path: &str) -> String {
        format!("http://{}:{}{}", self.host, self.port, path)
    }

    /// Appends a line to a job's eventwire log, which is also what makes the job "exist" as far as the
    /// stream route is concerned.
    fn append_eventwire(&self, job_id: &str, line: &str) {
        let dir = self.tendril_home.join("Logs").join("Jobs");
        std::fs::create_dir_all(&dir).unwrap();
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(format!("{job_id}.eventwire.jsonl")))
            .unwrap();
        writeln!(f, "{line}").unwrap();
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
        "tendril-job-events-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
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
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

/// Reads an SSE response until `needle` appears or the stream ends.
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
            // This stream *does* end, at the `end` frame, so a clean close without the needle is a
            // failure rather than something to keep waiting on.
            Ok(None) | Err(_) => return None,
        }
    }
}

#[tokio::test]
async fn job_event_stream_requires_bearer_token() {
    let server = start_test_server().await;
    server.append_eventwire("00101", r#"{"kind":"text","text":"hello"}"#);

    let resp = reqwest::Client::new()
        .get(server.url("/api/jobs/00101/events"))
        .send()
        .await
        .expect("request sent");

    assert_eq!(
        resp.status(),
        reqwest::StatusCode::UNAUTHORIZED,
        "an unauthenticated job subscription must be refused; a client that cannot send the \
         credential has to stream through something that can"
    );
}

#[tokio::test]
async fn an_authenticated_subscriber_receives_numbered_frames_and_the_end_frame() {
    let server = start_test_server().await;
    server.append_eventwire("00102", r#"{"kind":"text","text":"first"}"#);
    server.append_eventwire("00102", r#"{"kind":"text","text":"second"}"#);

    let mut resp = reqwest::Client::new()
        .get(server.url("/api/jobs/00102/events"))
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

    let body = read_until(&mut resp, "event: end", Duration::from_secs(5))
        .await
        .expect("no end frame arrived");

    assert!(
        body.contains(r#""text":"first""#),
        "unexpected body: {body}"
    );
    assert!(
        body.contains(r#""text":"second""#),
        "unexpected body: {body}"
    );
    // The line index in the SSE `id:` is what makes a resume point expressible; without it a client
    // has nothing to put in `since_line` and every reconnect replays the run.
    assert!(body.contains("id: 0"), "unexpected body: {body}");
    assert!(body.contains("id: 1"), "unexpected body: {body}");
}

#[tokio::test]
async fn since_line_resumes_where_the_client_left_off() {
    let server = start_test_server().await;
    for i in 0..4 {
        server.append_eventwire("00103", &format!(r#"{{"kind":"text","text":"line-{i}"}}"#));
    }

    let mut resp = reqwest::Client::new()
        .get(server.url("/api/jobs/00103/events?since_line=2"))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .expect("request sent");
    assert_eq!(resp.status(), reqwest::StatusCode::OK);

    let body = read_until(&mut resp, "event: end", Duration::from_secs(5))
        .await
        .expect("no end frame arrived");

    assert!(
        !body.contains("line-0") && !body.contains("line-1"),
        "the prefix the client already holds must not be replayed: {body}"
    );
    assert!(body.contains("line-2") && body.contains("line-3"), "{body}");
    assert!(
        body.contains("id: 2"),
        "the ids must keep counting log lines: {body}"
    );
}

#[tokio::test]
async fn the_kinds_filter_still_reports_true_log_line_numbers() {
    let server = start_test_server().await;
    server.append_eventwire("00104", r#"{"kind":"text","text":"kept"}"#);
    server.append_eventwire("00104", r#"{"kind":"tool_call","tool_name":"git"}"#);
    server.append_eventwire("00104", r#"{"kind":"text","text":"also-kept"}"#);

    let mut resp = reqwest::Client::new()
        .get(server.url("/api/jobs/00104/events?kinds=text"))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .expect("request sent");

    let body = read_until(&mut resp, "event: end", Duration::from_secs(5))
        .await
        .expect("no end frame arrived");

    assert!(
        !body.contains("tool_call"),
        "the filter did not apply: {body}"
    );
    // Line 2, not "the second frame I sent you": a resume point that counted delivered frames would
    // skip the wrong lines the moment a filter was in play.
    assert!(
        body.contains("id: 0") && body.contains("id: 2") && !body.contains("id: 1"),
        "unexpected ids: {body}"
    );
}
