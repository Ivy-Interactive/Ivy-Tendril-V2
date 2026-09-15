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

    fn annotations_file(&self, plan_id: &str) -> PathBuf {
        let folder = tendril_core::plans::resolve_plan_folder(plan_id, &self.state.plans_dir)
            .expect("plan folder must resolve");
        tendril_core::plans::annotations_path(&folder)
    }
}

async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-annotation-routes-test-{}",
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

fn annotation_body(id: &str, comment: &str) -> Value {
    json!({
        "id": id,
        "startOffset": 10,
        "endOffset": 30,
        "selectedText": "public void Execute()",
        "comment": comment,
        "author": "Calm Niels",
        "isResolved": false,
    })
}

#[tokio::test]
async fn test_get_returns_empty_list_and_404_for_an_unknown_plan() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Empty");
    let client = reqwest::Client::new();

    let resp = client
        .get(server.url(&format!("/api/plans/{plan_id}/annotations")))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body, json!([]));

    let resp = client
        .get(server.url("/api/plans/99999/annotations"))
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
async fn test_every_verb_404s_on_an_unknown_plan() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();
    let url = server.url("/api/plans/99999/annotations");

    let post = client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&annotation_body("ann-1", "One"))
        .send()
        .await
        .unwrap();
    assert_eq!(post.status(), 404);

    let put = client
        .put(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&json!({ "annotations": [] }))
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), 404);

    let delete = client
        .delete(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();
    assert_eq!(delete.status(), 404);
}

#[tokio::test]
async fn test_requests_without_a_bearer_token_are_rejected() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Auth");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    let resp = client.get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 401);

    let resp = client
        .post(&url)
        .json(&annotation_body("ann-1", "One"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);

    // A wrong secret is no better than none.
    let resp = client
        .get(&url)
        .header(AUTHORIZATION, "Bearer not-the-secret")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn test_post_then_get_round_trips_camel_case_keys() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Post");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    let resp = client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&annotation_body("ann-1", "Should this be async?"))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["id"], "ann-1");
    assert_eq!(body[0]["startOffset"], 10);
    assert_eq!(body[0]["endOffset"], 30);
    assert_eq!(body[0]["selectedText"], "public void Execute()");
    assert_eq!(body[0]["isResolved"], false);
    assert_eq!(body[0]["author"], "Calm Niels");

    let body: Value = client
        .get(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body[0]["comment"], "Should this be async?");

    // The on-disk file is the legacy location and spelling.
    let raw = std::fs::read_to_string(server.annotations_file(&plan_id)).unwrap();
    assert!(raw.contains("id: ann-1"), "got: {raw}");
    assert!(raw.contains("startOffset: 10"), "got: {raw}");
    assert!(
        raw.contains("selectedText: public void Execute()"),
        "got: {raw}"
    );
}

#[tokio::test]
async fn test_post_with_the_same_id_updates_in_place() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Upsert");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    for comment in ["First take", "Second take"] {
        client
            .post(&url)
            .header(AUTHORIZATION, server.bearer())
            .json(&annotation_body("ann-1", comment))
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
    assert_eq!(body[0]["comment"], "Second take");
}

#[tokio::test]
async fn test_put_replaces_the_list_in_both_body_shapes() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Put");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    let wrapped = json!({
        "annotations": [
            annotation_body("ann-1", "One"),
            annotation_body("ann-2", "Two"),
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
    let bare = json!([annotation_body("ann-3", "Three")]);
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
    assert_eq!(body[0]["id"], "ann-3");

    let stored: Value = client
        .get(&url)
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(stored, body);
}

#[tokio::test]
async fn test_put_with_an_empty_list_removes_the_file() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Put Empty");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&annotation_body("ann-1", "One"))
        .send()
        .await
        .unwrap();
    assert!(server.annotations_file(&plan_id).exists());

    let resp = client
        .put(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&json!({ "annotations": [] }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    assert!(
        !server.annotations_file(&plan_id).exists(),
        "an empty list must leave no artifact behind"
    );
}

#[tokio::test]
async fn test_delete_removes_one_or_clears_all() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Delete");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    client
        .put(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&json!({
            "annotations": [
                annotation_body("ann-1", "One"),
                annotation_body("ann-2", "Two"),
            ]
        }))
        .send()
        .await
        .unwrap();

    let body: Value = client
        .delete(format!("{url}?id=ann-1"))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["id"], "ann-2");

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
    assert!(!server.annotations_file(&plan_id).exists());
}

#[tokio::test]
async fn test_delete_of_an_unknown_id_is_a_no_op_rather_than_clearing_everything() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Delete Missing");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&annotation_body("ann-1", "One"))
        .send()
        .await
        .unwrap();

    let resp = client
        .delete(format!("{url}?id=nope"))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let body: Value = resp.json().await.unwrap();
    assert_eq!(body.as_array().unwrap().len(), 1, "got: {body}");
    assert_eq!(body[0]["id"], "ann-1");
}

#[tokio::test]
async fn test_mutations_broadcast_a_plan_annotations_changed_event() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Broadcast");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    // Subscribe before the write, or the broadcast is sent to nobody and dropped.
    let mut rx = server.state.ws_tx.subscribe();

    client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&annotation_body("ann-1", "Live update, please"))
        .send()
        .await
        .unwrap();

    let raw = tokio::time::timeout(tokio::time::Duration::from_secs(5), rx.recv())
        .await
        .expect("a broadcast must arrive within 5s")
        .expect("the broadcast channel must stay open");

    let event: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(event["type"], "plan.annotations_changed");
    assert_eq!(event["planId"], plan_id);
    assert_eq!(event["count"], 1);
    assert!(
        event["folderName"]
            .as_str()
            .unwrap()
            .starts_with(&format!("{plan_id}-")),
        "got: {event}"
    );

    // The clear-to-empty case broadcasts too, as the original fires with an empty list.
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
    assert_eq!(event["type"], "plan.annotations_changed");
    assert_eq!(event["count"], 0);
}

#[tokio::test]
async fn test_a_legacy_file_on_disk_is_served_untouched() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Legacy File");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    // Exactly what the original Tendril writes, planted before the API is ever called.
    let path = server.annotations_file(&plan_id);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        "- id: legacy-1\n  startOffset: 5\n  endOffset: 9\n  selectedText: async\n  comment: Written by legacy.\n",
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
    assert_eq!(body[0]["id"], "legacy-1");
    assert_eq!(body[0]["comment"], "Written by legacy.");
    // `author` was absent on disk and stays absent, rather than becoming null.
    assert!(body[0].get("author").is_none(), "got: {body}");
    assert_eq!(body[0]["isResolved"], false);

    // Adding an annotation leaves the legacy entry's fields alone.
    client
        .post(&url)
        .header(AUTHORIZATION, server.bearer())
        .json(&annotation_body("ann-1", "Written by V2."))
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
    assert_eq!(body[0]["id"], "legacy-1");
    assert_eq!(body[0]["startOffset"], 5);
    assert!(body[0].get("author").is_none(), "got: {body}");
}

#[tokio::test]
async fn test_concurrent_posts_lose_no_annotations() {
    let server = start_test_server().await;
    let plan_id = server.create_plan("Annotations Concurrent");
    let client = reqwest::Client::new();
    let url = server.url(&format!("/api/plans/{plan_id}/annotations"));

    let mut set = tokio::task::JoinSet::new();
    for i in 0..16 {
        let client = client.clone();
        let url = url.clone();
        let bearer = server.bearer();
        set.spawn(async move {
            client
                .post(&url)
                .header(AUTHORIZATION, bearer)
                .json(&annotation_body(&format!("ann-{i}"), &format!("Note {i}")))
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
