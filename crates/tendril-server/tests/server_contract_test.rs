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

#[tokio::test]
async fn test_project_issues_routes_not_found() {
    let server = start_test_server(None).await;
    let master = read_master(&server.tendril_home).unwrap();
    let client = reqwest::Client::new();

    // GET /api/projects/NonExistentProject/issues -> 404
    let issues_url = format!(
        "http://{}:{}/api/projects/NonExistentProject/issues",
        master.host, master.port
    );
    let resp = client
        .get(&issues_url)
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::NOT_FOUND);

    // GET /api/projects/NonExistentProject/issues/metadata -> 404
    let metadata_url = format!(
        "http://{}:{}/api/projects/NonExistentProject/issues/metadata",
        master.host, master.port
    );
    let resp = client
        .get(&metadata_url)
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_project_crud_lifecycle_and_unknown_keys_preservation() {
    let server = start_test_server(None).await;
    let master = read_master(&server.tendril_home).expect("master discovery exists");

    // Write initial config with unmodeled keys
    let config_path = server.tendril_home.join("config.yaml");
    let initial_yaml = r#"
codingAgent: claude
jobTimeout: 30
editor:
  command: code
  args: ["-n"]
customSettings:
  nestedKey: 42
projects: []
"#;
    std::fs::write(&config_path, initial_yaml).unwrap();

    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", master.host, master.port);

    // 1. Register a new project via POST /api/projects
    let create_payload = serde_json::json!({
        "name": "WidgetService",
        "color": "Green",
        "repos": [
            { "path": "/repos/widget-service", "baseBranch": "main" }
        ],
        "verifications": [
            { "name": "RustBuild", "required": true }
        ],
        "context": "Context description",
        "stackHash": "rs:axum",
        "reviewActions": [
            { "name": "TestRun", "condition": "", "command": "echo test" }
        ],
        "buildDependencies": ["dep-a"]
    });

    let create_resp = client
        .post(format!("{}/api/projects", base_url))
        .bearer_auth(&master.secret)
        .json(&create_payload)
        .send()
        .await
        .unwrap();

    assert_eq!(create_resp.status(), reqwest::StatusCode::CREATED);
    let created_json: serde_json::Value = create_resp.json().await.unwrap();
    assert_eq!(created_json["name"], "WidgetService");
    assert_eq!(created_json["color"], "Green");
    assert_eq!(created_json["repos"][0]["path"], "/repos/widget-service");
    assert_eq!(created_json["repos"][0]["baseBranch"], "main");
    assert_eq!(created_json["verifications"][0]["name"], "RustBuild");
    assert_eq!(created_json["reviewActions"][0]["name"], "TestRun");

    // 2. Attempt to register the same project name again -> 409 Conflict
    let dup_resp = client
        .post(format!("{}/api/projects", base_url))
        .bearer_auth(&master.secret)
        .json(&create_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(dup_resp.status(), reqwest::StatusCode::CONFLICT);

    // 3. Query GET /api/projects and GET /api/projects/:name
    let list_resp = client
        .get(format!("{}/api/projects", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(list_resp.status(), reqwest::StatusCode::OK);
    let projects: Vec<serde_json::Value> = list_resp.json().await.unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0]["name"], "WidgetService");

    let get_resp = client
        .get(format!("{}/api/projects/WidgetService", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(get_resp.status(), reqwest::StatusCode::OK);
    let proj: serde_json::Value = get_resp.json().await.unwrap();
    assert_eq!(proj["name"], "WidgetService");
    assert_eq!(proj["color"], "Green");

    // 4. Update the project using PUT /api/projects/:name
    let update_payload = serde_json::json!({
        "color": "Purple",
        "repos": [
            { "path": "/repos/widget-service-updated", "baseBranch": "dev" }
        ],
        "verifications": [
            { "name": "RustClippy", "required": true },
            { "name": "RustTest", "required": false }
        ],
        "context": "Updated context",
        "reviewActions": [
            { "name": "EchoAction", "condition": "", "command": "echo updated" }
        ]
    });

    let update_resp = client
        .put(format!("{}/api/projects/WidgetService", base_url))
        .bearer_auth(&master.secret)
        .json(&update_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(update_resp.status(), reqwest::StatusCode::OK);
    let updated_json: serde_json::Value = update_resp.json().await.unwrap();
    assert_eq!(updated_json["color"], "Purple");
    assert_eq!(
        updated_json["repos"][0]["path"],
        "/repos/widget-service-updated"
    );
    assert_eq!(updated_json["verifications"].as_array().unwrap().len(), 2);
    assert_eq!(updated_json["reviewActions"][0]["name"], "EchoAction");

    // 5. Verify unmodeled keys in config.yaml remain intact after mutations
    let raw_config = std::fs::read_to_string(&config_path).unwrap();
    assert!(raw_config.contains("editor:"));
    assert!(raw_config.contains("command: code"));
    assert!(raw_config.contains("customSettings:"));
    assert!(raw_config.contains("nestedKey: 42"));

    // 6. Deregister the project using DELETE /api/projects/:name
    let del_resp = client
        .delete(format!("{}/api/projects/WidgetService", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(del_resp.status(), reqwest::StatusCode::OK);
    let del_json: serde_json::Value = del_resp.json().await.unwrap();
    assert_eq!(del_json["message"], "Project 'WidgetService' removed");

    // 7. Query GET /api/projects/:name -> 404 Not Found
    let get_after_del = client
        .get(format!("{}/api/projects/WidgetService", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(get_after_del.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_review_action_execution_streaming() {
    let server = start_test_server(None).await;
    let master = read_master(&server.tendril_home).expect("master discovery exists");

    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", master.host, master.port);

    // 1. Register a project with a review action
    let project_payload = serde_json::json!({
        "name": "StreamingProject",
        "color": "Blue",
        "repos": [],
        "verifications": [],
        "reviewActions": [
            {
                "name": "EchoOutput",
                "condition": "",
                "command": "echo line1 && echo line2"
            }
        ]
    });

    let create_proj_resp = client
        .post(format!("{}/api/projects", base_url))
        .bearer_auth(&master.secret)
        .json(&project_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(create_proj_resp.status(), reqwest::StatusCode::CREATED);

    // 2. Create a test plan folder in plans_dir
    let plan_dir = server.tendril_home.join("Plans").join("00001-TestPlan");
    std::fs::create_dir_all(&plan_dir).unwrap();
    let plan_yaml_content = r#"
title: Test Plan
project: StreamingProject
level: Feature
"#;
    std::fs::write(plan_dir.join("plan.yaml"), plan_yaml_content).unwrap();

    // 3. Trigger review action execution via POST /api/projects/:name/review-actions/:action/execute
    let exec_resp = client
        .post(format!(
            "{}/api/projects/StreamingProject/review-actions/EchoOutput/execute",
            base_url
        ))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({
            "plan_id": "00001"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(exec_resp.status(), reqwest::StatusCode::OK);
    let sse_text = exec_resp.text().await.unwrap();

    // 4. Verify SSE stream contains log events and end event
    assert!(sse_text.contains("event: log"), "Should contain log event");
    assert!(sse_text.contains("line1"), "Should contain stdout line 1");
    assert!(sse_text.contains("line2"), "Should contain stdout line 2");
    assert!(sse_text.contains("event: end"), "Should contain end event");
    assert!(
        sse_text.contains("Process exited with code 0"),
        "Should indicate success code 0"
    );
}

#[tokio::test]
async fn test_verification_crud_lifecycle_and_unknown_keys_preservation() {
    let server = start_test_server(None).await;
    let master = read_master(&server.tendril_home).expect("master discovery exists");

    // Write initial config with unmodeled keys and empty verifications
    let config_path = server.tendril_home.join("config.yaml");
    let initial_yaml = r#"
codingAgent: claude
jobTimeout: 30
editor:
  command: code
  args: ["-n"]
customSettings:
  nestedKey: 42
verifications: []
"#;
    std::fs::write(&config_path, initial_yaml).unwrap();

    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", master.host, master.port);

    // 1. Query GET /api/verifications and assert list
    let list_resp = client
        .get(format!("{}/api/verifications", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(list_resp.status(), reqwest::StatusCode::OK);
    let verifications: Vec<serde_json::Value> = list_resp.json().await.unwrap();
    assert!(verifications.is_empty());

    // 2. Post new verification POST /api/verifications and assert 201 Created
    let create_payload = serde_json::json!({
        "name": "CustomCheck",
        "prompt": "Run custom verification script"
    });

    let create_resp = client
        .post(format!("{}/api/verifications", base_url))
        .bearer_auth(&master.secret)
        .json(&create_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(create_resp.status(), reqwest::StatusCode::CREATED);
    let created_json: serde_json::Value = create_resp.json().await.unwrap();
    assert_eq!(created_json["name"], "CustomCheck");
    assert_eq!(created_json["prompt"], "Run custom verification script");

    // 3. Post duplicate verification POST /api/verifications and assert 409 Conflict
    let dup_resp = client
        .post(format!("{}/api/verifications", base_url))
        .bearer_auth(&master.secret)
        .json(&create_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(dup_resp.status(), reqwest::StatusCode::CONFLICT);

    // 4. Query GET /api/verifications/:name and verify name and prompt match
    let get_resp = client
        .get(format!("{}/api/verifications/CustomCheck", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(get_resp.status(), reqwest::StatusCode::OK);
    let get_json: serde_json::Value = get_resp.json().await.unwrap();
    assert_eq!(get_json["name"], "CustomCheck");
    assert_eq!(get_json["prompt"], "Run custom verification script");

    // Also verify case-insensitivity on GET
    let get_ci_resp = client
        .get(format!("{}/api/verifications/customcheck", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(get_ci_resp.status(), reqwest::StatusCode::OK);

    // 4a. PUT /api/verifications/:name with a new prompt returns 200 and the updated body
    let put_resp = client
        .put(format!("{}/api/verifications/CustomCheck", base_url))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({ "prompt": "Run updated verification script" }))
        .send()
        .await
        .unwrap();
    assert_eq!(put_resp.status(), reqwest::StatusCode::OK);
    let put_json: serde_json::Value = put_resp.json().await.unwrap();
    assert_eq!(put_json["name"], "CustomCheck");
    assert_eq!(put_json["prompt"], "Run updated verification script");

    // A follow-up GET returns the new prompt
    let get_after_put = client
        .get(format!("{}/api/verifications/CustomCheck", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(get_after_put.status(), reqwest::StatusCode::OK);
    let get_after_put_json: serde_json::Value = get_after_put.json().await.unwrap();
    assert_eq!(
        get_after_put_json["prompt"],
        "Run updated verification script"
    );

    // PUT with a lowercase path name succeeds, and the stored name keeps its original casing
    let put_ci_resp = client
        .put(format!("{}/api/verifications/customcheck", base_url))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({ "prompt": "Run case-insensitive update" }))
        .send()
        .await
        .unwrap();
    assert_eq!(put_ci_resp.status(), reqwest::StatusCode::OK);
    let put_ci_json: serde_json::Value = put_ci_resp.json().await.unwrap();
    assert_eq!(put_ci_json["name"], "CustomCheck");
    assert_eq!(put_ci_json["prompt"], "Run case-insensitive update");

    // PUT /api/verifications/DoesNotExist returns 404
    let put_missing = client
        .put(format!("{}/api/verifications/DoesNotExist", base_url))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({ "prompt": "irrelevant" }))
        .send()
        .await
        .unwrap();
    assert_eq!(put_missing.status(), reqwest::StatusCode::NOT_FOUND);

    // PUT with a body name that doesn't match the path name returns 400
    let put_rename = client
        .put(format!("{}/api/verifications/CustomCheck", base_url))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({ "name": "Other", "prompt": "x" }))
        .send()
        .await
        .unwrap();
    assert_eq!(put_rename.status(), reqwest::StatusCode::BAD_REQUEST);

    // 5. Query non-existent verification GET /api/verifications/DoesNotExist and assert 404 Not Found
    let get_missing = client
        .get(format!("{}/api/verifications/DoesNotExist", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(get_missing.status(), reqwest::StatusCode::NOT_FOUND);

    // 6. Delete verification DELETE /api/verifications/:name and assert 200 OK
    let del_resp = client
        .delete(format!("{}/api/verifications/CustomCheck", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(del_resp.status(), reqwest::StatusCode::OK);
    let del_json: serde_json::Value = del_resp.json().await.unwrap();
    assert_eq!(del_json["message"], "Verification 'CustomCheck' removed");

    // 7. Delete non-existent verification and assert 404 Not Found
    let del_missing = client
        .delete(format!("{}/api/verifications/DoesNotExist", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(del_missing.status(), reqwest::StatusCode::NOT_FOUND);

    // 8. Confirm unmodeled configuration keys in config.yaml are preserved across mutations
    let raw_config = std::fs::read_to_string(&config_path).unwrap();
    assert!(raw_config.contains("editor:"));
    assert!(raw_config.contains("command: code"));
    assert!(raw_config.contains("customSettings:"));
    assert!(raw_config.contains("nestedKey: 42"));

    // 9. Query GET after delete and assert 404 Not Found
    let get_after_del = client
        .get(format!("{}/api/verifications/CustomCheck", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(get_after_del.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_dedicated_project_repo_and_verification_endpoints() {
    let server = start_test_server(None).await;
    let master = read_master(&server.tendril_home).expect("master discovery exists");
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", master.host, master.port);

    // 1. Create a project
    let create_payload = serde_json::json!({
        "name": "DedicatedTestProject",
        "repos": [],
        "verifications": []
    });

    let create_resp = client
        .post(format!("{}/api/projects", base_url))
        .bearer_auth(&master.secret)
        .json(&create_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(create_resp.status(), reqwest::StatusCode::CREATED);

    // 2. Test 404 on all 4 endpoints for non-existent project
    let non_existent = "NonExistentProject";
    let post_repo_404 = client
        .post(format!("{}/api/projects/{}/repos", base_url, non_existent))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({ "path": "/some/path" }))
        .send()
        .await
        .unwrap();
    assert_eq!(post_repo_404.status(), reqwest::StatusCode::NOT_FOUND);

    let delete_repo_404 = client
        .delete(format!("{}/api/projects/{}/repos", base_url, non_existent))
        .bearer_auth(&master.secret)
        .query(&[("path", "/some/path")])
        .send()
        .await
        .unwrap();
    assert_eq!(delete_repo_404.status(), reqwest::StatusCode::NOT_FOUND);

    let post_ver_404 = client
        .post(format!(
            "{}/api/projects/{}/verifications",
            base_url, non_existent
        ))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({ "name": "RustBuild", "required": true }))
        .send()
        .await
        .unwrap();
    assert_eq!(post_ver_404.status(), reqwest::StatusCode::NOT_FOUND);

    let delete_ver_404 = client
        .delete(format!(
            "{}/api/projects/{}/verifications/RustBuild",
            base_url, non_existent
        ))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(delete_ver_404.status(), reqwest::StatusCode::NOT_FOUND);

    // 3. POST /api/projects/:name/repos: test adding new repo
    let add_repo_resp = client
        .post(format!(
            "{}/api/projects/DedicatedTestProject/repos",
            base_url
        ))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({
            "path": "/repos/main-service",
            "baseBranch": "main"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(add_repo_resp.status(), reqwest::StatusCode::CREATED);
    let added_repo_json: serde_json::Value = add_repo_resp.json().await.unwrap();
    assert_eq!(added_repo_json["path"], "/repos/main-service");
    assert_eq!(added_repo_json["baseBranch"], "main");

    // Verify idempotency when adding duplicate path (case-insensitive)
    let dup_repo_resp = client
        .post(format!(
            "{}/api/projects/DedicatedTestProject/repos",
            base_url
        ))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({
            "path": "/REPOS/MAIN-SERVICE",
            "baseBranch": "main"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(dup_repo_resp.status(), reqwest::StatusCode::OK);

    // Verify project only has 1 repo
    let get_proj_resp = client
        .get(format!("{}/api/projects/DedicatedTestProject", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    let proj_json: serde_json::Value = get_proj_resp.json().await.unwrap();
    assert_eq!(proj_json["repos"].as_array().unwrap().len(), 1);

    // Add another repo as string
    let add_repo2_resp = client
        .post(format!(
            "{}/api/projects/DedicatedTestProject/repos",
            base_url
        ))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!("/repos/secondary-service"))
        .send()
        .await
        .unwrap();
    assert_eq!(add_repo2_resp.status(), reqwest::StatusCode::CREATED);

    // 4. DELETE /api/projects/:name/repos: test removing repo by query parameter
    let del_repo_resp = client
        .delete(format!(
            "{}/api/projects/DedicatedTestProject/repos",
            base_url
        ))
        .bearer_auth(&master.secret)
        .query(&[("path", "/repos/main-service")])
        .send()
        .await
        .unwrap();
    assert_eq!(del_repo_resp.status(), reqwest::StatusCode::OK);

    // Verify repo was removed and secondary-service remains
    let get_proj_resp2 = client
        .get(format!("{}/api/projects/DedicatedTestProject", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    let proj_json2: serde_json::Value = get_proj_resp2.json().await.unwrap();
    let repos = proj_json2["repos"].as_array().unwrap();
    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0]["path"], "/repos/secondary-service");

    // 5. POST /api/projects/:name/verifications: test adding verification, verify required status
    let add_ver_resp = client
        .post(format!(
            "{}/api/projects/DedicatedTestProject/verifications",
            base_url
        ))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({
            "name": "RustClippy",
            "required": true
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(add_ver_resp.status(), reqwest::StatusCode::CREATED);
    let added_ver_json: serde_json::Value = add_ver_resp.json().await.unwrap();
    assert_eq!(added_ver_json["name"], "RustClippy");
    assert_eq!(added_ver_json["required"], true);

    // Update required status
    let update_ver_resp = client
        .post(format!(
            "{}/api/projects/DedicatedTestProject/verifications",
            base_url
        ))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({
            "name": "RustClippy",
            "required": false
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(update_ver_resp.status(), reqwest::StatusCode::OK);
    let updated_ver_json: serde_json::Value = update_ver_resp.json().await.unwrap();
    assert_eq!(updated_ver_json["name"], "RustClippy");
    assert_eq!(updated_ver_json["required"], false);

    // Add a second verification as string
    let add_ver2_resp = client
        .post(format!(
            "{}/api/projects/DedicatedTestProject/verifications",
            base_url
        ))
        .bearer_auth(&master.secret)
        .json(&serde_json::json!("RustBuild"))
        .send()
        .await
        .unwrap();
    assert_eq!(add_ver2_resp.status(), reqwest::StatusCode::CREATED);

    // 6. DELETE /api/projects/:name/verifications/:verification: test removing verification by route parameter
    let del_ver_resp = client
        .delete(format!(
            "{}/api/projects/DedicatedTestProject/verifications/RustClippy",
            base_url
        ))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(del_ver_resp.status(), reqwest::StatusCode::OK);

    // Verify verification was removed and RustBuild remains
    let get_proj_resp3 = client
        .get(format!("{}/api/projects/DedicatedTestProject", base_url))
        .bearer_auth(&master.secret)
        .send()
        .await
        .unwrap();
    let proj_json3: serde_json::Value = get_proj_resp3.json().await.unwrap();
    let vers = proj_json3["verifications"].as_array().unwrap();
    assert_eq!(vers.len(), 1);
    assert_eq!(vers[0]["name"], "RustBuild");
}
