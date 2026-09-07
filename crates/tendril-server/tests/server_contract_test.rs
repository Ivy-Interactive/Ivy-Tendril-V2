use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{read_master, MasterGuard};
use tendril_server::{create_router, AppState};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

#[allow(dead_code)]
struct TestServer {
    pub tendril_home: PathBuf,
    pub port: u16,
    pub host: String,
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

async fn start_test_server(host: Option<String>) -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-server-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = tendril_core::config::generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str).unwrap();

    let state = Arc::new(AppState::new(tendril_home.clone(), secret.clone()));
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
        host: host_str,
        secret,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

#[tokio::test]
async fn test_default_bind_is_loopback() {
    let server = start_test_server(None).await;
    let master = read_master(&server.tendril_home).expect("master file exists");
    assert_eq!(master.host, "127.0.0.1");

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://127.0.0.1:{}/api/ping", server.port))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    assert_eq!(resp.text().await.unwrap(), "pong");
}

#[tokio::test]
async fn test_unauthenticated_readiness_probe() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    let ping_resp = client
        .get(format!("http://127.0.0.1:{}/api/ping", server.port))
        .send()
        .await
        .unwrap();
    assert_eq!(ping_resp.status(), reqwest::StatusCode::OK);
    assert_eq!(ping_resp.text().await.unwrap(), "pong");

    let health_resp = client
        .get(format!("http://127.0.0.1:{}/api/health", server.port))
        .send()
        .await
        .unwrap();
    assert_eq!(health_resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = health_resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert!(body["pid"].as_u64().unwrap_or(0) > 0);
    assert_eq!(body["apiVersion"], 1);
    assert!(!body["version"].as_str().unwrap_or("").is_empty());

    let capabilities = body["capabilities"].as_array().expect("capabilities array");
    assert!(capabilities.iter().any(|c| c == "jobs"));
    assert!(capabilities.iter().any(|c| c == "plans"));
    assert!(capabilities.iter().any(|c| c == "auth_bearer"));
}

#[tokio::test]
async fn test_protected_routes_require_auth() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    let endpoints = [
        "/api/jobs",
        "/api/plans",
        "/api/config",
        "/api/projects",
        "/api/verifications",
    ];
    for endpoint in endpoints {
        let resp = client
            .get(format!("http://127.0.0.1:{}{}", server.port, endpoint))
            .send()
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            reqwest::StatusCode::UNAUTHORIZED,
            "Endpoint {} should require auth",
            endpoint
        );
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["error"], "Unauthorized");
        assert_eq!(body["message"], "Missing or invalid bearer token");

        let bad_auth_resp = client
            .get(format!("http://127.0.0.1:{}{}", server.port, endpoint))
            .header("Authorization", "Bearer invalid-token-xyz")
            .send()
            .await
            .unwrap();
        assert_eq!(bad_auth_resp.status(), reqwest::StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn test_protected_routes_accept_valid_bearer_token() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    let endpoints = [
        "/api/jobs",
        "/api/plans",
        "/api/config",
        "/api/projects",
        "/api/verifications",
    ];
    for endpoint in endpoints {
        let resp = client
            .get(format!("http://127.0.0.1:{}{}", server.port, endpoint))
            .bearer_auth(&server.secret)
            .send()
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            reqwest::StatusCode::OK,
            "Endpoint {} should succeed with valid bearer token",
            endpoint
        );
    }
}

#[tokio::test]
async fn test_websocket_auth_header_and_query_param() {
    let server = start_test_server(None).await;

    // 1. WebSocket upgrade without token must be rejected
    let unauth_url = format!("ws://127.0.0.1:{}/api/ws", server.port);
    let unauth_res = tokio_tungstenite::connect_async(&unauth_url).await;
    assert!(
        unauth_res.is_err(),
        "WebSocket upgrade without auth should fail"
    );

    // 2. WebSocket upgrade with invalid query token must be rejected
    let bad_query_url = format!("ws://127.0.0.1:{}/api/ws?token=bad-token", server.port);
    let bad_query_res = tokio_tungstenite::connect_async(&bad_query_url).await;
    assert!(
        bad_query_res.is_err(),
        "WebSocket upgrade with bad token should fail"
    );

    // 3. WebSocket upgrade with valid query param token must succeed
    let query_url = format!(
        "ws://127.0.0.1:{}/api/ws?token={}",
        server.port, server.secret
    );
    let query_conn = tokio_tungstenite::connect_async(&query_url).await;
    assert!(
        query_conn.is_ok(),
        "WebSocket upgrade with ?token= query parameter should succeed"
    );

    // 4. WebSocket upgrade with valid Authorization header must succeed
    let mut req = format!("ws://127.0.0.1:{}/api/ws", server.port)
        .into_client_request()
        .unwrap();
    req.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", server.secret).parse().unwrap(),
    );
    let header_conn = tokio_tungstenite::connect_async(req).await;
    assert!(
        header_conn.is_ok(),
        "WebSocket upgrade with Bearer header should succeed"
    );
}

#[tokio::test]
async fn test_cors_rejection_for_unauthorized_origins() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    // Unauthorized non-local origin
    let evil_resp = client
        .request(
            reqwest::Method::OPTIONS,
            format!("http://127.0.0.1:{}/api/ping", server.port),
        )
        .header("Origin", "http://evil.com")
        .header("Access-Control-Request-Method", "GET")
        .send()
        .await
        .unwrap();
    assert!(
        evil_resp
            .headers()
            .get("access-control-allow-origin")
            .is_none(),
        "Origin http://evil.com should be rejected by CORS"
    );

    // Authorized Tauri origin
    let tauri_resp = client
        .request(
            reqwest::Method::OPTIONS,
            format!("http://127.0.0.1:{}/api/ping", server.port),
        )
        .header("Origin", "tauri://localhost")
        .header("Access-Control-Request-Method", "GET")
        .send()
        .await
        .unwrap();
    assert_eq!(
        tauri_resp
            .headers()
            .get("access-control-allow-origin")
            .unwrap(),
        "tauri://localhost"
    );

    // Authorized localhost development port
    let local_resp = client
        .request(
            reqwest::Method::OPTIONS,
            format!("http://127.0.0.1:{}/api/ping", server.port),
        )
        .header("Origin", "http://localhost:1420")
        .header("Access-Control-Request-Method", "GET")
        .send()
        .await
        .unwrap();
    assert_eq!(
        local_resp
            .headers()
            .get("access-control-allow-origin")
            .unwrap(),
        "http://localhost:1420"
    );
}

#[tokio::test]
async fn test_cli_client_authenticates_successfully() {
    let server = start_test_server(None).await;
    let master = read_master(&server.tendril_home).expect("master discovery exists");

    let client = reqwest::Client::new();
    let url = format!("http://{}:{}/api/jobs", master.host, master.port);
    let resp = client
        .get(&url)
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
}

#[tokio::test]
async fn test_put_config_preserves_unknown_keys() {
    let server = start_test_server(None).await;
    let master = read_master(&server.tendril_home).expect("master discovery exists");

    // Write initial config with unmodeled keys
    let config_path = server.tendril_home.join("config.yaml");
    let initial_yaml = r#"
codingAgent: claude
jobTimeout: 30
theme: default
vault:
  id: test-vault
  enabled: true
customSection:
  nestedField: "hello"
"#;
    std::fs::write(&config_path, initial_yaml).unwrap();

    let client = reqwest::Client::new();
    let url = format!("http://{}:{}/api/config", master.host, master.port);

    // Issue partial update PUT
    let payload = serde_json::json!({
        "jobTimeout": 60,
        "theme": "dark"
    });

    let resp = client
        .put(&url)
        .bearer_auth(&master.secret)
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);

    // Read back config and verify unmodeled keys are intact
    let raw = std::fs::read_to_string(&config_path).unwrap();
    assert!(raw.contains("jobTimeout: 60"));
    assert!(raw.contains("theme: dark"));
    assert!(raw.contains("vault:"));
    assert!(raw.contains("id: test-vault"));
    assert!(raw.contains("customSection:"));
    assert!(raw.contains("nestedField: hello"));

    // Check GET /api/config returns all keys
    let get_resp = client
        .get(&url)
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(get_resp.status(), reqwest::StatusCode::OK);
    let json_body: serde_json::Value = get_resp.json().await.unwrap();
    assert_eq!(json_body.get("jobTimeout").unwrap(), 60);
    assert_eq!(json_body.get("theme").unwrap(), "dark");
    assert!(json_body.get("vault").is_some());
    assert!(json_body.get("customSection").is_some());
}
