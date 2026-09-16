use futures_util::StreamExt;
use reqwest::header::AUTHORIZATION;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::agents::providers::AgentProcessSpec;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_server::{create_router, AppState};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

#[allow(dead_code)]
struct TestServer {
    pub tendril_home: PathBuf,
    pub port: u16,
    pub host: String,
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

async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-chat-server-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str, "http").unwrap();

    let mut state = AppState::new(tendril_home.clone(), secret.clone());
    // Custom mock spec builder for fast tests
    let chat_mgr = Arc::new(
        tendril_core::chat::execution::ChatExecutionManager::new(tendril_home.clone())
            .with_spec_builder(Arc::new(|_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    "echo '{\"delta\": \"RouteChunk\"}'; echo '{\"delta\": \"Done\"}'".to_string(),
                ],
                environment: HashMap::new(),
                working_directory: config.working_directory.clone(),
                stdin_content: None,
                redirect_stdin: false,
                temp_files: vec![],
            })),
    );
    // Forward events to ws_tx
    let mut chat_rx = chat_mgr.subscribe_events();
    let ws_tx_clone = state.ws_tx.clone();
    tokio::spawn(async move {
        while let Ok(evt) = chat_rx.recv().await {
            if let Ok(json) = serde_json::to_string(&evt) {
                let _ = ws_tx_clone.send(json);
            }
        }
    });
    state.chat_manager = chat_mgr;
    let state = Arc::new(state);

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
        host: host_str,
        secret,
        state,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

#[tokio::test]
async fn test_chat_routes_auth_required() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}/api/chat/sessions", server.host, server.port);

    // Unauthenticated GET
    let resp = client.get(&base_url).send().await.unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);

    // Unauthenticated POST
    let resp = client
        .post(&base_url)
        .json(&json!({ "title": "Unauthorized Chat" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_chat_routes_crud_and_queue() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", server.host, server.port);

    // 1. Create session
    let create_resp = client
        .post(format!("{}/api/chat/sessions", base_url))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({
            "title": "My Test Chat",
            "agentId": "claude",
            "modelId": "opus"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(create_resp.status(), reqwest::StatusCode::CREATED);
    let session_val: serde_json::Value = create_resp.json().await.unwrap();
    let session_id = session_val["id"].as_str().unwrap();
    assert_eq!(session_val["title"], "My Test Chat");

    // 2. Get session
    let get_resp = client
        .get(format!("{}/api/chat/sessions/{}", base_url, session_id))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();
    assert_eq!(get_resp.status(), reqwest::StatusCode::OK);
    let loaded: serde_json::Value = get_resp.json().await.unwrap();
    assert_eq!(loaded["id"], session_id);

    // 3. List sessions
    let list_resp = client
        .get(format!("{}/api/chat/sessions", base_url))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();
    assert_eq!(list_resp.status(), reqwest::StatusCode::OK);
    let list_val: Vec<serde_json::Value> = list_resp.json().await.unwrap();
    assert_eq!(list_val.len(), 1);

    // 4. Update session
    let update_resp = client
        .put(format!("{}/api/chat/sessions/{}", base_url, session_id))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "title": "Renamed Chat..." }))
        .send()
        .await
        .unwrap();
    assert_eq!(update_resp.status(), reqwest::StatusCode::OK);
    let updated: serde_json::Value = update_resp.json().await.unwrap();
    assert_eq!(updated["title"], "Renamed Chat");

    // 5. Enqueue item
    let queue_post = client
        .post(format!(
            "{}/api/chat/sessions/{}/queue",
            base_url, session_id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "prompt": "Queued prompt 1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(queue_post.status(), reqwest::StatusCode::CREATED);
    let queue_item: serde_json::Value = queue_post.json().await.unwrap();
    let item_id = queue_item["id"].as_str().unwrap();

    // 6. Get queue
    let queue_get = client
        .get(format!(
            "{}/api/chat/sessions/{}/queue",
            base_url, session_id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();
    assert_eq!(queue_get.status(), reqwest::StatusCode::OK);
    let queue_list: Vec<serde_json::Value> = queue_get.json().await.unwrap();
    assert_eq!(queue_list.len(), 1);
    assert_eq!(queue_list[0]["id"], item_id);

    // 7. Edit the queued item in place
    let queue_put = client
        .put(format!(
            "{}/api/chat/sessions/{}/queue/{}",
            base_url, session_id, item_id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "prompt": "Queued prompt 1 (edited)" }))
        .send()
        .await
        .unwrap();
    assert_eq!(queue_put.status(), reqwest::StatusCode::OK);
    let edited: serde_json::Value = queue_put.json().await.unwrap();
    assert_eq!(edited["id"], item_id);
    assert_eq!(edited["prompt"], "Queued prompt 1 (edited)");

    let missing_put = client
        .put(format!(
            "{}/api/chat/sessions/{}/queue/does-not-exist",
            base_url, session_id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "prompt": "nope" }))
        .send()
        .await
        .unwrap();
    assert_eq!(missing_put.status(), reqwest::StatusCode::NOT_FOUND);

    // 8. Delete queued item
    let queue_del = client
        .delete(format!(
            "{}/api/chat/sessions/{}/queue/{}",
            base_url, session_id, item_id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();
    assert_eq!(queue_del.status(), reqwest::StatusCode::OK);

    // 9. Delete session
    let del_resp = client
        .delete(format!("{}/api/chat/sessions/{}", base_url, session_id))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();
    assert_eq!(del_resp.status(), reqwest::StatusCode::OK);
}

#[tokio::test]
async fn test_chat_question_answering_endpoint() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", server.host, server.port);

    // Create session
    let create_resp = client
        .post(format!("{}/api/chat/sessions", base_url))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "title": "Question Chat" }))
        .send()
        .await
        .unwrap();
    let session_val: serde_json::Value = create_resp.json().await.unwrap();
    let session_id = session_val["id"].as_str().unwrap();

    // Directly put a message with a question block into session
    let msg_id = "msg-with-questions";
    let q_content = r#"Here is a question:
```questions
id: db-choice
title: Database Choice?
options:
  - title: Postgres
    value: postgres
  - title: SQLite
    value: sqlite
```
"#;
    server
        .state
        .chat_manager
        .add_message(
            session_id,
            tendril_core::chat::models::ChatMessage {
                id: msg_id.to_string(),
                role: "assistant".to_string(),
                content: q_content.to_string(),
                timestamp: chrono::Utc::now(),
                agent_id: None,
                model_id: None,
                raw_stream: None,
                effort: None,
            },
        )
        .await
        .unwrap();

    // Call answer questions endpoint
    let mut answers = HashMap::new();
    answers.insert("db-choice".to_string(), vec!["sqlite".to_string()]);

    let ans_resp = client
        .post(format!(
            "{}/api/chat/sessions/{}/messages/{}/answers",
            base_url, session_id, msg_id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "answers": answers }))
        .send()
        .await
        .unwrap();

    assert_eq!(ans_resp.status(), reqwest::StatusCode::OK);
    let updated_session: serde_json::Value = ans_resp.json().await.unwrap();
    let updated_msg = &updated_session["messages"][0];
    let content_str = updated_msg["content"].as_str().unwrap();
    assert!(content_str.contains("answer: sqlite"));
}

#[tokio::test]
async fn test_chat_websocket_broadcast() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", server.host, server.port);

    // Create session
    let create_resp = client
        .post(format!("{}/api/chat/sessions", base_url))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "title": "WS Chat" }))
        .send()
        .await
        .unwrap();
    let session_val: serde_json::Value = create_resp.json().await.unwrap();
    let session_id = session_val["id"].as_str().unwrap();

    // Connect WebSocket
    let ws_url = format!("ws://{}:{}/api/ws", server.host, server.port);
    let mut req = ws_url.into_client_request().unwrap();
    req.headers_mut().insert(
        AUTHORIZATION,
        format!("Bearer {}", server.secret).parse().unwrap(),
    );

    let (ws_stream, _) = connect_async(req).await.expect("Failed to connect WS");
    let (_, mut read) = ws_stream.split();

    // Trigger execute turn
    let exec_resp = client
        .post(format!(
            "{}/api/chat/sessions/{}/execute",
            base_url, session_id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "prompt": "Hello WebSocket" }))
        .send()
        .await
        .unwrap();
    assert_eq!(exec_resp.status(), reqwest::StatusCode::OK);

    // Read WS frames and check for chat events
    let mut received_delta = false;
    let mut received_generating_state = false;

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        if let Ok(Some(Ok(tokio_tungstenite::tungstenite::Message::Text(txt)))) =
            tokio::time::timeout(std::time::Duration::from_millis(500), read.next()).await
        {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&txt) {
                if let Some(t) = val.get("type").and_then(|v| v.as_str()) {
                    if t == "chat.stream_delta" {
                        received_delta = true;
                    }
                    if t == "chat.generating_state" {
                        received_generating_state = true;
                    }
                }
            }
            if received_delta && received_generating_state {
                break;
            }
        }
    }

    assert!(received_delta, "Should receive chat.stream_delta over WS");
    assert!(
        received_generating_state,
        "Should receive chat.generating_state over WS"
    );
}

/// The terminal half of V1's chat modes. Two things matter here and neither is about the agent: the
/// session id is what authorises the spawn, and the stream announces the pty before any output — a
/// client cannot type into a session it has no id for.
#[tokio::test]
async fn test_chat_terminal_requires_a_real_session() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", server.host, server.port);

    // An unknown session is a 404 and spawns nothing. This is the whole of the authorisation: a route
    // carrying the daemon's authority must not become a way to run a process of the caller's choosing.
    let resp = client
        .post(format!(
            "{}/api/chat/sessions/not-a-session/terminal",
            base_url
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::NOT_FOUND);

    // Input and resize for a pty that never existed are 404s rather than panics, which is what a
    // client racing the `end` frame will see.
    let create = client
        .post(format!("{}/api/chat/sessions", base_url))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "title": "Terminal", "agentId": "claude" }))
        .send()
        .await
        .unwrap();
    let session: serde_json::Value = create.json().await.unwrap();
    let session_id = session["id"].as_str().unwrap();

    for endpoint in ["terminal/input", "terminal/resize"] {
        let resp = client
            .post(format!(
                "{}/api/chat/sessions/{}/{}",
                base_url, session_id, endpoint
            ))
            .header(AUTHORIZATION, format!("Bearer {}", server.secret))
            .json(&json!({ "sessionId": "no-such-pty", "data": "", "rows": 24, "cols": 80 }))
            .send()
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            reqwest::StatusCode::NOT_FOUND,
            "endpoint: {}",
            endpoint
        );
    }

    // Closing a pty that is already gone is not an error: a pane unmounting twice must not raise.
    let resp = client
        .delete(format!(
            "{}/api/chat/sessions/{}/terminal",
            base_url, session_id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({ "sessionId": "no-such-pty" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["closed"], false);
}
