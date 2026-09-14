use reqwest::header::AUTHORIZATION;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_core::plans::{create_plan, CreatePlanOptions};
use tendril_server::routes::plans::{broadcast_pr_created, broadcast_pr_merged};
use tendril_server::{create_router, AppState};

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
        "tendril-plan-events-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str).unwrap();

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

    // Wait briefly for server to bind
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

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
async fn test_post_plan_event_broadcasts_to_attached_sessions() {
    let server = start_test_server().await;

    // 1. Create general chat session
    let general_session = server
        .state
        .chat_manager
        .create_session(
            Some("General Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create general session");

    // 2. Create plan linked to general session via chat_session_id
    let opts = CreatePlanOptions {
        title: "Test Plan Broadcast".to_string(),
        project: "test-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: Some("Broadcast testing".to_string()),
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: Some(general_session.id.clone()),
    };
    let pf = create_plan(&server.state.plans_dir, opts).expect("Failed to create plan");

    // 3. Create side-panel session attached to this plan folder
    let side_panel_session = server
        .state
        .chat_manager
        .create_session(
            Some("Side Panel".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            Some(pf.folder_name.clone()),
        )
        .await
        .expect("Failed to create side panel session");

    // 4. Create an unlinked session
    let unlinked_session = server
        .state
        .chat_manager
        .create_session(
            Some("Unlinked".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create unlinked session");

    // 5. Post plan event originating from side_panel_session
    let client = reqwest::Client::new();
    let url = format!(
        "http://{}:{}/api/plans/{}/events",
        server.host,
        server.port,
        pf.id()
    );

    let resp = client
        .post(&url)
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({
            "summary": "title set to New Title",
            "reason": "user requested update",
            "sourceChatSessionId": side_panel_session.id
        }))
        .send()
        .await
        .expect("Failed to post event");

    assert_eq!(resp.status(), reqwest::StatusCode::OK);

    // 6. Assert non-originating session received the message
    let general_after = server
        .state
        .chat_manager
        .get_session(&general_session.id)
        .await
        .unwrap();
    assert_eq!(general_after.messages.len(), 1);
    assert_eq!(general_after.messages[0].role, "system");
    assert!(general_after.messages[0].content.contains("[System Event]"));
    assert!(general_after.messages[0]
        .content
        .contains("title set to New Title"));
    assert!(general_after.messages[0]
        .content
        .contains("Reason: user requested update."));

    // 7. Assert originating session did not receive duplicate self-notification
    let side_after = server
        .state
        .chat_manager
        .get_session(&side_panel_session.id)
        .await
        .unwrap();
    assert_eq!(side_after.messages.len(), 0);

    // 8. Assert unlinked session did not receive message
    let unlinked_after = server
        .state
        .chat_manager
        .get_session(&unlinked_session.id)
        .await
        .unwrap();
    assert_eq!(unlinked_after.messages.len(), 0);
}

#[tokio::test]
async fn test_post_plan_event_reason_formatting() {
    let server = start_test_server().await;

    let general_session = server
        .state
        .chat_manager
        .create_session(
            Some("General Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let opts = CreatePlanOptions {
        title: "Reason Formatting Plan".to_string(),
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
        chat_session_id: Some(general_session.id.clone()),
    };
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();

    let client = reqwest::Client::new();
    let url = format!(
        "http://{}:{}/api/plans/{}/events",
        server.host,
        server.port,
        pf.id()
    );

    // Without reason
    let resp1 = client
        .post(&url)
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({
            "summary": "state set to Executing",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp1.status(), reqwest::StatusCode::OK);

    let session1 = server
        .state
        .chat_manager
        .get_session(&general_session.id)
        .await
        .unwrap();
    assert_eq!(session1.messages.len(), 1);
    let expected1 = format!(
        "[System Event] Plan 'Reason Formatting Plan' (#{id:05}) was edited directly: state set to Executing. Check whether this changes your understanding of the plan, and tell the user if anything needs follow-up.",
        id = pf.id()
    );
    assert_eq!(session1.messages[0].content, expected1);

    // With reason
    let resp2 = client
        .post(&url)
        .header(AUTHORIZATION, format!("Bearer {}", server.secret))
        .json(&json!({
            "summary": "level set to Bug",
            "reason": "user clarified priority"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.status(), reqwest::StatusCode::OK);

    let session2 = server
        .state
        .chat_manager
        .get_session(&general_session.id)
        .await
        .unwrap();
    assert_eq!(session2.messages.len(), 2);
    let expected2 = format!(
        "[System Event] Plan 'Reason Formatting Plan' (#{id:05}) was edited directly: level set to Bug. Reason: user clarified priority. Check whether this changes your understanding of the plan, and tell the user if anything needs follow-up.",
        id = pf.id()
    );
    assert_eq!(session2.messages[1].content, expected2);
}

#[tokio::test]
async fn test_pr_notification_broadcast() {
    let server = start_test_server().await;

    let general_session = server
        .state
        .chat_manager
        .create_session(
            Some("General Chat".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    let opts = CreatePlanOptions {
        title: "PR Notification Plan".to_string(),
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
        chat_session_id: Some(general_session.id.clone()),
    };
    let pf = create_plan(&server.state.plans_dir, opts).unwrap();

    let side_panel_session = server
        .state
        .chat_manager
        .create_session(
            Some("Side Panel".to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            Some(pf.folder_name.clone()),
        )
        .await
        .unwrap();

    // 1. Test PR created broadcast
    let pr_url = "https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/42";
    let recs_created = broadcast_pr_created(
        &server.state.chat_manager,
        &pf.metadata.title,
        pf.id(),
        &pf.folder_name,
        Some(&general_session.id),
        pr_url,
    )
    .await
    .unwrap();
    assert_eq!(recs_created.len(), 2);

    let gen1 = server
        .state
        .chat_manager
        .get_session(&general_session.id)
        .await
        .unwrap();
    let side1 = server
        .state
        .chat_manager
        .get_session(&side_panel_session.id)
        .await
        .unwrap();

    let expected_created = format!(
        "[System Event] Pull request for plan 'PR Notification Plan' (#{id:05}) has been created: {pr_url}. Please review the pull request and next steps.",
        id = pf.id()
    );
    assert_eq!(gen1.messages.len(), 1);
    assert_eq!(gen1.messages[0].content, expected_created);
    assert_eq!(side1.messages.len(), 1);
    assert_eq!(side1.messages[0].content, expected_created);

    // 2. Test PR merged broadcast
    let recs_merged = broadcast_pr_merged(
        &server.state.chat_manager,
        &pf.metadata.title,
        pf.id(),
        &pf.folder_name,
        Some(&general_session.id),
    )
    .await
    .unwrap();
    assert_eq!(recs_merged.len(), 2);

    let gen2 = server
        .state
        .chat_manager
        .get_session(&general_session.id)
        .await
        .unwrap();
    let side2 = server
        .state
        .chat_manager
        .get_session(&side_panel_session.id)
        .await
        .unwrap();

    let expected_merged = format!(
        "[System Event] Pull request for plan 'PR Notification Plan' (#{id:05}) has been merged. Plan execution is complete.",
        id = pf.id()
    );
    assert_eq!(gen2.messages.len(), 2);
    assert_eq!(gen2.messages[1].content, expected_merged);
    assert_eq!(side2.messages.len(), 2);
    assert_eq!(side2.messages[1].content, expected_merged);
}
