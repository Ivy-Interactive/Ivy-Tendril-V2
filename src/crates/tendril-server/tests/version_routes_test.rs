use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::MasterGuard;
use tendril_core::version_check::VersionInfo;
use tendril_server::{create_router, AppState};

#[allow(dead_code)]
struct TestServer {
    pub tendril_home: PathBuf,
    pub port: u16,
    pub secret: String,
    pub state: Arc<AppState>,
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

/// Mirrors `server_contract_test`'s harness, plus an optional cache file seeded on disk before
/// `AppState` (and therefore `version_check::load_cache`) ever runs.
async fn start_test_server(seed_cache: Option<VersionInfo>) -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-version-routes-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    if let Some(info) = seed_cache {
        tendril_core::version_check::save_cache(&tendril_home, &info).unwrap();
    }

    let tokio_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = tendril_core::config::generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, "127.0.0.1", "http").unwrap();

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
        state,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

/// Restores a process-global env var to its prior value on drop, even on panic. Only
/// `post_version_check_offline_returns_200_not_5xx` below touches process env, and it's the only
/// test in this file that makes an outbound HTTPS call, so there's nothing else in this binary for
/// the mutation to race with.
struct EnvGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

#[tokio::test]
async fn get_version_returns_current_with_no_cache() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("http://127.0.0.1:{}/api/version", server.port))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);

    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["currentVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(body["hasUpdate"], false);
    assert!(body["lastChecked"].is_null());
    // Never checked yet: nothing to compare `currentVersion` against.
    assert!(body["latestVersion"].is_null());
    // The backoff counter is an internal implementation detail, never on the wire.
    assert!(body.get("consecutiveFailures").is_none());
}

#[tokio::test]
async fn get_version_reflects_seeded_cache() {
    let seeded = VersionInfo {
        current_version: "1.0.0".to_string(),
        latest_version: Some("cli-v1.2.0".to_string()),
        has_update: true,
        last_checked: Some(chrono::Utc::now()),
        consecutive_failures: 0,
    };
    let server = start_test_server(Some(seeded)).await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("http://127.0.0.1:{}/api/version", server.port))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);

    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["currentVersion"], "1.0.0");
    assert_eq!(body["latestVersion"], "cli-v1.2.0");
    assert_eq!(body["hasUpdate"], true);
    assert!(!body["lastChecked"].is_null());
}

#[tokio::test]
async fn get_version_requires_auth() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("http://127.0.0.1:{}/api/version", server.port))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn post_version_check_offline_returns_200_not_5xx() {
    // A closed local port: bind then drop, so nothing answers on it. Set as the HTTPS proxy so the
    // handler's outbound call to the (https) releases endpoint fails deterministically, without
    // depending on this sandbox's actual network reachability.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    let closed_port = listener.local_addr().expect("local addr").port();
    drop(listener);
    let _proxy_guard = EnvGuard::set("HTTPS_PROXY", &format!("http://127.0.0.1:{closed_port}"));

    let server = start_test_server(None).await;
    // The test's own request to the local server is plain http://, which HTTPS_PROXY doesn't
    // touch — only the handler's internal https:// call to the releases endpoint is affected.
    let client = reqwest::Client::new();

    let resp = client
        .post(format!(
            "http://127.0.0.1:{}/api/version/check",
            server.port
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(!body["currentVersion"].as_str().unwrap_or("").is_empty());
    // A failed check must never fabricate an update.
    assert_eq!(body["hasUpdate"], false);
}

#[tokio::test]
async fn server_starts_with_version_check_spawned() {
    // `run_server` itself isn't `Send` end-to-end (a pre-existing trait-object in the job
    // recovery path it calls during startup isn't `Sync`), so it can only ever be run on the
    // process's top-level task, not spawned inside a test alongside other work — not something
    // this plan's scope extends to fixing. What's actually worth covering here is the wiring
    // `run_server` adds: a `spawn_version_check` task running alongside a live `AppState` must not
    // crash or interfere with request handling, which this exercises directly against the state
    // `start_test_server` already stood up.
    let server = start_test_server(None).await;
    let handle = tendril_server::tasks::spawn_version_check(server.state.clone());
    assert!(!handle.is_finished());

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://127.0.0.1:{}/api/version", server.port))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(!body["currentVersion"].as_str().unwrap_or("").is_empty());

    handle.abort();
}
