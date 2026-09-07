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
async fn test_recommendations_mutation_endpoints() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    // 1. Create a plan to test on
    let create_resp = client
        .post(format!("http://127.0.0.1:{}/api/plans", server.port))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "title": "Rec Test Plan",
            "project": "RecTestProject",
            "level": "Feature",
            "verifications": []
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(create_resp.status(), reqwest::StatusCode::CREATED);
    let plan_data: serde_json::Value = create_resp.json().await.unwrap();
    let plan_id = format!("{:05}", plan_data["metadata"]["id"].as_i64().unwrap());

    // 2. Unauthenticated request must return 401
    let unauth_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/recommendations",
            server.port, plan_id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(unauth_resp.status(), reqwest::StatusCode::UNAUTHORIZED);

    // 3. GET recommendations on new plan returns empty list
    let list_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/recommendations",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(list_resp.status(), reqwest::StatusCode::OK);
    let recs: Vec<serde_json::Value> = list_resp.json().await.unwrap();
    assert!(recs.is_empty());

    // 4. POST recommendation creates new recommendation
    let add_resp = client
        .post(format!(
            "http://127.0.0.1:{}/api/plans/{}/recommendations",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "title": "Add Database Index",
            "description": "Add index for performance",
            "impact": "High"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(add_resp.status(), reqwest::StatusCode::CREATED);
    let added: serde_json::Value = add_resp.json().await.unwrap();
    assert_eq!(added["title"], "Add Database Index");
    assert_eq!(added["state"], "Pending");

    // 5. PUT updates state and optional declineReason
    let update_resp = client
        .put(format!(
            "http://127.0.0.1:{}/api/plans/{}/recommendations/Add%20Database%20Index",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "state": "Accepted",
            "declineReason": null
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(update_resp.status(), reqwest::StatusCode::OK);

    // Verify updated state
    let list_resp2 = client
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/recommendations",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    let recs2: Vec<serde_json::Value> = list_resp2.json().await.unwrap();
    assert_eq!(recs2.len(), 1);
    assert_eq!(recs2[0]["state"], "Accepted");

    // 6. DELETE removes recommendation
    let del_resp = client
        .delete(format!(
            "http://127.0.0.1:{}/api/plans/{}/recommendations/Add%20Database%20Index",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(del_resp.status(), reqwest::StatusCode::OK);

    let list_resp3 = client
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/recommendations",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    let recs3: Vec<serde_json::Value> = list_resp3.json().await.unwrap();
    assert!(recs3.is_empty());
}

#[tokio::test]
async fn test_per_plan_verifications_mutation_endpoints() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    // 1. Create a plan with a seeded verification
    let create_resp = client
        .post(format!("http://127.0.0.1:{}/api/plans", server.port))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "title": "Verif Test Plan",
            "project": "VerifTestProject",
            "level": "Feature",
            "verifications": [
                { "name": "RustBuild", "status": "Pending" }
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(create_resp.status(), reqwest::StatusCode::CREATED);
    let plan_data: serde_json::Value = create_resp.json().await.unwrap();
    let plan_id = format!("{:05}", plan_data["metadata"]["id"].as_i64().unwrap());

    // 2. GET returns seeded verifications
    let list_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/verifications",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(list_resp.status(), reqwest::StatusCode::OK);
    let verifs: Vec<serde_json::Value> = list_resp.json().await.unwrap();
    assert_eq!(verifs.len(), 1);
    assert_eq!(verifs[0]["name"], "RustBuild");
    assert_eq!(verifs[0]["status"], "Pending");

    // 3. PUT updates status to Pass
    let put_resp = client
        .put(format!(
            "http://127.0.0.1:{}/api/plans/{}/verifications/RustBuild",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "status": "Pass"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(put_resp.status(), reqwest::StatusCode::OK);

    let list_resp2 = client
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/verifications",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    let verifs2: Vec<serde_json::Value> = list_resp2.json().await.unwrap();
    assert_eq!(verifs2[0]["status"], "Pass");

    // 4. PUT with invalid status returns 400 Bad Request
    let bad_put = client
        .put(format!(
            "http://127.0.0.1:{}/api/plans/{}/verifications/RustBuild",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "status": "NotAValidStatus"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_put.status(), reqwest::StatusCode::BAD_REQUEST);

    // 5. PUT legacy format verification.<name> works
    let legacy_resp = client
        .put(format!(
            "http://127.0.0.1:{}/api/plans/{}",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "field": "verification.RustBuild",
            "value": "Skipped"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(legacy_resp.status(), reqwest::StatusCode::OK);

    let list_resp3 = client
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/verifications",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    let verifs3: Vec<serde_json::Value> = list_resp3.json().await.unwrap();
    assert_eq!(verifs3[0]["status"], "Skipped");

    // 6. POST adds a new verification
    let post_resp = client
        .post(format!(
            "http://127.0.0.1:{}/api/plans/{}/verifications",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "name": "RustTest",
            "status": "Pending"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(post_resp.status(), reqwest::StatusCode::CREATED);

    // 7. DELETE removes verification
    let del_resp = client
        .delete(format!(
            "http://127.0.0.1:{}/api/plans/{}/verifications/RustTest",
            server.port, plan_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(del_resp.status(), reqwest::StatusCode::OK);
}

#[tokio::test]
async fn test_job_logs_retrieval_and_streaming_endpoints() {
    let server = start_test_server(None).await;
    let client = reqwest::Client::new();

    let job_id = "00999";
    let logs_dir = server.tendril_home.join("Logs").join("Jobs");
    std::fs::create_dir_all(&logs_dir).unwrap();

    let md_content = "# Job 00999 Narrative Log\nStep 1: Done\nStep 2: Done";
    std::fs::write(logs_dir.join(format!("{}.md", job_id)), md_content).unwrap();

    let raw_content = "{\"line\":1}\n{\"line\":2}\n{\"line\":3}\n";
    std::fs::write(logs_dir.join(format!("{}.raw.jsonl", job_id)), raw_content).unwrap();

    // 1. GET markdown log
    let md_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/jobs/{}/logs",
            server.port, job_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(md_resp.status(), reqwest::StatusCode::OK);
    let md_json: serde_json::Value = md_resp.json().await.unwrap();
    assert_eq!(md_json["jobId"], job_id);
    assert_eq!(md_json["format"], "markdown");
    assert_eq!(md_json["content"], md_content);
    assert_eq!(md_json["exists"], true);

    // 2. GET raw jsonl log
    let raw_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/jobs/{}/logs?format=raw",
            server.port, job_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(raw_resp.status(), reqwest::StatusCode::OK);
    let raw_json: serde_json::Value = raw_resp.json().await.unwrap();
    assert_eq!(raw_json["format"], "raw");
    assert_eq!(
        raw_json["content"],
        "{\"line\":1}\n{\"line\":2}\n{\"line\":3}"
    );
    assert_eq!(raw_json["exists"], true);

    // 3. GET nonexistent job returns 404
    let not_found_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/jobs/nonexistent/logs",
            server.port
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(not_found_resp.status(), reqwest::StatusCode::NOT_FOUND);

    // 4. GET stream SSE endpoint
    let stream_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/jobs/{}/logs/stream?format=raw",
            server.port, job_id
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(stream_resp.status(), reqwest::StatusCode::OK);

    let stream_text = stream_resp.text().await.unwrap();
    assert!(stream_text.contains("event: log"));
    assert!(stream_text.contains("data: {\"line\":1}"));
    assert!(stream_text.contains("event: end"));
    assert!(stream_text.contains("data: Job finished"));
}
