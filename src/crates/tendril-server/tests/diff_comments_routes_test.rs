use reqwest::header::AUTHORIZATION;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_core::plans::{create_plan, CreatePlanOptions};
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

impl TestServer {
    fn url(&self, path: &str) -> String {
        format!("http://{}:{}{}", self.host, self.port, path)
    }

    fn bearer(&self) -> String {
        format!("Bearer {}", self.secret)
    }

    /// Create a plan and return the zero-padded id the API addresses it by.
    fn create_plan(&self, title: &str) -> String {
        let opts = CreatePlanOptions {
            title: title.to_string(),
            project: "TestProject".to_string(),
            level: None,
            initial_prompt: None,
            source_url: None,
            execution_profile: None,
            priority: None,
            repos: vec![],
            verifications: vec![],
            depends_on: vec![],
            related_plans: vec![],
            chat_session_id: None,
        };
        let created = create_plan(&self.state.plans_dir, opts).unwrap();
        format!("{:05}", created.id())
    }

    fn comments_file(&self, plan_id: &str) -> PathBuf {
        let folder = tendril_core::plans::resolve_plan_folder(plan_id, &self.state.plans_dir)
            .expect("plan folder must resolve");
        tendril_core::plans::diff_comments_path(&folder)
    }
}

async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-diff-comment-routes-test-{}",
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

fn comment_body(file_path: &str, change_key: &str, content: &str) -> Value {
    json!({
        "filePath": file_path,
        "changeKey": change_key,
        "content": content,
        "lineNumber": 12,
        "author": "Calm Niels",
        "isResolved": false,
    })
}

#[tokio::test]
async fn test_get_returns_empty_list_and_404_for_an_unknown_plan() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Empty");
    let client = reqwest::Client::new();

    let resp = client
        .get(server.url(&format!("/api/plans/{plan_id}/diff-comments")))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body, json!([]));

    let resp = client
        .get(server.url("/api/plans/99999/diff-comments"))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].as_str().unwrap().contains("not found"),
        "got: {body}"
    );
}

#[tokio::test]
async fn test_post_then_get_round_trips_camel_case_keys() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Post");
    let client = reqwest::Client::new();

    let resp = client
        .post(server.url(&format!("/api/plans/{plan_id}/diff-comments")))
        .header(AUTHORIZATION, server.bearer())
        .json(&comment_body(
            "plan.md@1-2",
            "I10",
            "Should this be null-safe?",
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["filePath"], "plan.md@1-2");
    assert_eq!(body[0]["changeKey"], "I10");
    assert_eq!(body[0]["lineNumber"], 12);
    assert_eq!(body[0]["isResolved"], false);
    assert_eq!(body[0]["author"], "Calm Niels");

    let body: Value = client
        .get(server.url(&format!("/api/plans/{plan_id}/diff-comments")))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(body[0]["content"], "Should this be null-safe?");

    // The on-disk file is the legacy location and spelling.
    let raw = std::fs::read_to_string(server.comments_file(&plan_id)).unwrap();
    assert!(raw.contains("filePath: plan.md@1-2"), "got: {raw}");
    assert!(raw.contains("changeKey: I10"), "got: {raw}");
}

#[tokio::test]
async fn test_post_with_the_same_key_updates_in_place() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Upsert");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/diff-comments"));

    for content in ["First take", "Second take"] {
        client
            .post(&url)
            .header(AUTHORIZATION, server.bearer())
            .json(&comment_body("plan.md", "I10", content))
            .send()
            .await
            .unwrap();
    }

    let body: Value = client
        .get(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(body.as_array().unwrap().len(), 1, "got: {body}");
    assert_eq!(body[0]["content"], "Second take");
}

#[tokio::test]
async fn test_put_replaces_the_list_in_both_body_shapes() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Put");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/diff-comments"));

    let wrapped = json!({
        "comments": [
            comment_body("plan.md", "I1", "One"),
            comment_body("plan.md", "I2", "Two"),
        ]
    });
    let body: Value = client
        .put(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&wrapped)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body.as_array().unwrap().len(), 2);

    // A bare array is accepted too, and replaces rather than appends.
    let bare = json!([comment_body("plan.md", "I3", "Three")]);
    let body: Value = client
        .put(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&bare)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["changeKey"], "I3");
}

#[tokio::test]
async fn test_put_with_an_empty_list_removes_the_file() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Put Empty");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/diff-comments"));

    client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&comment_body("plan.md", "I1", "One"))
        .send()
        .await
        .unwrap();
    assert!(server.comments_file(&plan_id).exists());

    let resp = client
        .put(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&json!({ "comments": [] }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    assert!(
        !server.comments_file(&plan_id).exists(),
        "an empty list must leave no artifact behind"
    );
}

#[tokio::test]
async fn test_delete_removes_one_or_clears_all() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Delete");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/diff-comments"));

    client
        .put(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&json!({
            "comments": [
                comment_body("plan.md", "I1", "One"),
                comment_body("plan.md", "I2", "Two"),
            ]
        }))
        .send()
        .await
        .unwrap();

    let body: Value = client
        .delete(format!("{url}?filePath=plan.md&changeKey=I1"))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["changeKey"], "I2");

    let body: Value = client
        .delete(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body, json!([]));
    assert!(!server.comments_file(&plan_id).exists());
}

#[tokio::test]
async fn test_delete_with_half_a_key_is_rejected_rather_than_clearing_everything() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Delete Half");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/diff-comments"));

    client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&comment_body("plan.md", "I1", "One"))
        .send()
        .await
        .unwrap();

    let resp = client
        .delete(format!("{url}?filePath=plan.md"))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 400);
    // The comment is still there: a client bug must not destroy the review.
    let body: Value = client
        .get(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn test_mutations_broadcast_a_plan_diff_comments_changed_event() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Broadcast");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/diff-comments"));

    // Subscribe before the write, or the broadcast is sent to nobody and dropped.
    let mut rx = server.state.ws_tx.subscribe();

    client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&comment_body("plan.md@1-2", "I10", "Live update, please"))
        .send()
        .await
        .unwrap();

    let raw = tokio::time::timeout(tokio::time::Duration::from_secs(5), rx.recv())
        .await
        .expect("a broadcast must arrive within 5s")
        .expect("the broadcast channel must stay open");

    let event: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(event["type"], "plan.diff_comments_changed");
    assert_eq!(event["planId"], plan_id);
    assert_eq!(event["count"], 1);
    assert!(
        event["folderName"]
            .as_str()
            .unwrap()
            .starts_with(&format!("{plan_id}-")),
        "got: {event}"
    );

    // A delete broadcasts too, with the new count.
    client
        .delete(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();

    let raw = tokio::time::timeout(tokio::time::Duration::from_secs(5), rx.recv())
        .await
        .expect("a broadcast must arrive within 5s")
        .expect("the broadcast channel must stay open");
    let event: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(event["type"], "plan.diff_comments_changed");
    assert_eq!(event["count"], 0);
}

#[tokio::test]
async fn test_concurrent_posts_lose_no_comments() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Concurrent");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/diff-comments"));

    let mut set = tokio::task::JoinSet::new();
    for i in 0..16 {
        let client = client.clone();
        let url = url.clone();
        let bearer = server.bearer();
        set.spawn(async move {
            client
                .post(&url)
                .header(AUTHORIZATION, bearer)
                .json(&comment_body(
                    "plan.md",
                    &format!("I{i}"),
                    &format!("Comment {i}"),
                ))
                .send()
                .await
                .unwrap()
                .status()
        });
    }

    while let Some(result) = set.join_next().await {
        assert_eq!(result.unwrap(), 200);
    }

    let body: Value = client
        .get(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(
        body.as_array().unwrap().len(),
        16,
        "every concurrent POST must survive"
    );
}

#[tokio::test]
async fn test_a_legacy_file_on_disk_is_served_untouched() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Diff Comments Legacy File");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/diff-comments"));

    // Exactly what the original Tendril writes, planted before the API is ever called.
    let path = server.comments_file(&plan_id);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        "- filePath: plan.md\n  changeKey: I10\n  content: Written by legacy.\n  lineNumber: 10\n",
    )
    .unwrap();

    let body: Value = client
        .get(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["filePath"], "plan.md");
    assert_eq!(body[0]["content"], "Written by legacy.");
    // `author` was absent on disk and stays absent, rather than becoming null.
    assert!(body[0].get("author").is_none(), "got: {body}");

    // Adding a scoped comment leaves the legacy entry's fields alone.
    client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&comment_body("plan.md@1-2", "I10", "Written by V2."))
        .send()
        .await
        .unwrap();

    let body: Value = client
        .get(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body.as_array().unwrap().len(), 2);
    assert_eq!(body[0]["filePath"], "plan.md");
    assert_eq!(body[0]["content"], "Written by legacy.");
    assert_eq!(body[0]["lineNumber"], 10);
    assert!(body[0].get("author").is_none(), "got: {body}");
}
