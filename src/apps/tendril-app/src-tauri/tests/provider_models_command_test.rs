//! `cmd_fetch_provider_models`, the webview's only way to ask the daemon what a BYO endpoint serves.
//!
//! What matters here is not the discovery itself — the daemon's own tests cover that. It is that the
//! request reaches `POST /api/agents/models` with the bearer secret attached, that the outcome comes
//! back whole (including the "the provider said no" outcomes, which are answers and not failures), and
//! above all that **the API key travels one way**: it may go out with the request and must not appear in
//! anything this command returns.
//!
//! Commands resolve `TENDRIL_HOME` from the process environment, which is global, so every test takes
//! `env_lock()` for its duration.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use tempfile::TempDir;
use tendril_app_lib::commands::agents::cmd_fetch_provider_models;
use tendril_app_lib::daemon::MasterInfo;
use tokio::net::TcpListener;

const SECRET: &str = "provider-models-command-test-secret";
/// The value that must never come back. Distinctive so a substring search over the reply is meaningful.
const API_KEY: &str = "sk-test-DO-NOT-ECHO-8f21c";

async fn env_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

#[derive(Debug, Default)]
struct Observed {
    /// The bodies this route was asked with, in order.
    requests: Vec<serde_json::Value>,
    /// Any other path the command reached. Must stay empty: this command targets exactly one route.
    other_paths: Vec<String>,
    unauthorized: usize,
    /// When set, the route answers this status instead of an outcome.
    fail_with: Option<u16>,
}

type Shared = Arc<Mutex<Observed>>;

struct MockDaemon {
    addr: SocketAddr,
    observed: Shared,
    _server: tokio::task::JoinHandle<()>,
}

impl MockDaemon {
    fn observed(&self) -> MutexGuard<'_, Observed> {
        self.observed.lock().expect("observed lock")
    }
}

fn is_authorized(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == format!("Bearer {SECRET}"))
        .unwrap_or(false)
}

/// A daemon standing in for `fetch_provider_models_handler`.
///
/// It reproduces the property the real route is built around: the reply is derived from the *outcome*,
/// never from the request, so no arm of it can carry the key back. A base URL naming `unreachable`
/// answers the `baseUrlError` outcome — with `200`, as the real route does, because a provider that
/// refused is something the settings page renders rather than a transport failure.
async fn spawn_mock_daemon() -> MockDaemon {
    let observed: Shared = Arc::new(Mutex::new(Observed::default()));

    let app = Router::new()
        .route(
            "/api/agents/models",
            post(
                |State(state): State<Shared>,
                 headers: HeaderMap,
                 Json(body): Json<serde_json::Value>| async move {
                    if !is_authorized(&headers) {
                        state.lock().expect("lock").unauthorized += 1;
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(json!({ "error": "unauthorized" })),
                        );
                    }

                    let failure = {
                        let mut guard = state.lock().expect("lock");
                        guard.requests.push(body.clone());
                        guard.fail_with
                    };
                    if let Some(code) = failure {
                        return (
                            StatusCode::from_u16(code).expect("status"),
                            Json(json!({ "error": "no route matched" })),
                        );
                    }

                    let base_url = body
                        .get("baseUrl")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    if base_url.contains("unreachable") {
                        return (
                            StatusCode::OK,
                            Json(json!({
                                "status": "baseUrlError",
                                "message": "The endpoint did not answer.",
                            })),
                        );
                    }

                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": "models",
                            "provider": "openaiproxy",
                            "models": [
                                { "id": "gpt-5.6-sol", "displayName": "GPT-5.6 Sol" },
                                { "id": "house-blend-1", "displayName": "House Blend 1" },
                            ],
                            "defaults": { "model": "gpt-5.6-sol", "effort": "default" },
                        })),
                    )
                },
            ),
        )
        // Present so a test can show the command never reaches anything but its one route.
        .route(
            "/api/config",
            post(|State(state): State<Shared>| async move {
                state
                    .lock()
                    .expect("lock")
                    .other_paths
                    .push("/api/config".to_string());
                (StatusCode::OK, Json(json!({ "codingAgent": "claude" })))
            }),
        )
        .with_state(observed.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("local addr");
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    MockDaemon {
        addr,
        observed,
        _server: server,
    }
}

fn write_master(home: &std::path::Path, port: u16) {
    let master = MasterInfo {
        port,
        pid: std::process::id(),
        secret: SECRET.to_string(),
        started_at: "2026-09-16T10:41:11Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec!["plans".to_string(), "jobs".to_string()],
    };
    std::fs::write(
        home.join(".master"),
        serde_json::to_string_pretty(&master).expect("serialize master"),
    )
    .expect("write master");
}

async fn isolated_env() -> (TempDir, MockDaemon) {
    let temp = tempfile::tempdir().expect("tempdir");
    let daemon = spawn_mock_daemon().await;
    write_master(temp.path(), daemon.addr.port());
    std::env::set_var("TENDRIL_HOME", temp.path());
    (temp, daemon)
}

#[tokio::test]
async fn the_request_reaches_the_models_route_with_the_daemons_credential() {
    let _guard = env_lock().await;
    let (_temp, daemon) = isolated_env().await;

    let request = json!({
        "agent": "openaiproxy",
        "baseUrl": "https://llm.example/v1",
        "apiKey": API_KEY,
    });

    let outcome = cmd_fetch_provider_models(request.clone())
        .await
        .expect("discovery must reach the daemon");

    // Forwarded whole: the daemon decides which credential to use, so the command cannot get that
    // decision wrong by filtering fields on the way.
    let observed = daemon.observed();
    assert_eq!(observed.requests, vec![request]);
    assert_eq!(observed.unauthorized, 0, "the secret went with the request");
    assert!(
        observed.other_paths.is_empty(),
        "this command has one route and must not reach another"
    );

    // And the reply is handed back untouched.
    assert_eq!(outcome["status"], "models");
    assert_eq!(outcome["models"][1]["id"], "house-blend-1");
    assert_eq!(outcome["defaults"]["model"], "gpt-5.6-sol");
}

/// The one-way rule. A key may go out with the request; nothing that comes back may contain it.
#[tokio::test]
async fn the_api_key_never_comes_back_out() {
    let _guard = env_lock().await;
    let (_temp, _daemon) = isolated_env().await;

    let outcome = cmd_fetch_provider_models(json!({
        "agent": "openaiproxy",
        "baseUrl": "https://llm.example/v1",
        "apiKey": API_KEY,
    }))
    .await
    .expect("discovery");

    assert!(
        !outcome.to_string().contains(API_KEY),
        "the outcome must not carry the key: {outcome}"
    );

    // Nor may a failure. This one is answered as an outcome rather than an error, which is exactly the
    // case where a hand-written "could not reach {request}" message would have leaked it.
    let refused = cmd_fetch_provider_models(json!({
        "agent": "openaiproxy",
        "baseUrl": "https://unreachable.example/v1",
        "apiKey": API_KEY,
    }))
    .await
    .expect("a provider that refused is an outcome, not a transport failure");

    assert_eq!(refused["status"], "baseUrlError");
    assert!(!refused.to_string().contains(API_KEY));
}

/// A daemon that predates the route answers 404, and the operator has to be told that rather than shown
/// an empty model list. The error must still not repeat the request back.
#[tokio::test]
async fn a_daemon_without_the_route_is_reported_without_echoing_the_request() {
    let _guard = env_lock().await;
    let (_temp, daemon) = isolated_env().await;
    daemon.observed().fail_with = Some(404);

    let err = cmd_fetch_provider_models(json!({
        "agent": "openaiproxy",
        "baseUrl": "https://llm.example/v1",
        "apiKey": API_KEY,
    }))
    .await
    .expect_err("a 404 must not read as 'no models'");

    assert_eq!(err.code, "FETCH_PROVIDER_MODELS_FAILED");
    assert!(err.message.contains("404"), "{}", err.message);
    let rendered = format!("{} {} {:?}", err.code, err.message, err.details);
    assert!(!rendered.contains(API_KEY), "{rendered}");
}

#[tokio::test]
async fn a_wrong_secret_is_a_refusal_rather_than_an_empty_list() {
    let _guard = env_lock().await;
    let temp = tempfile::tempdir().expect("tempdir");
    let daemon = spawn_mock_daemon().await;

    let master = MasterInfo {
        port: daemon.addr.port(),
        pid: std::process::id(),
        secret: "not-the-secret".to_string(),
        started_at: "2026-09-16T10:41:11Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec![],
    };
    std::fs::write(
        temp.path().join(".master"),
        serde_json::to_string_pretty(&master).expect("serialize"),
    )
    .expect("write master");
    std::env::set_var("TENDRIL_HOME", temp.path());

    let err = cmd_fetch_provider_models(json!({ "agent": "openaiproxy" }))
        .await
        .expect_err("an unauthorized call must not report success");
    assert_eq!(err.code, "FETCH_PROVIDER_MODELS_FAILED");
    assert_eq!(daemon.observed().unauthorized, 1);
}
