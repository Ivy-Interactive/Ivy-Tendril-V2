//! The two revision-writing endpoints, and the difference between them.
//!
//! `POST /api/plans/{id}/revisions` **appends** a revision: that is what an agent producing a new
//! draft of the plan does. `PUT /api/plans/{id}/revisions/latest` **overwrites the newest one in
//! place**: that is what answering a question does, because an answer is not a new revision of the
//! plan, it is filling in a blank the plan left.
//!
//! The distinction is not cosmetic. The app's unfolded-answer execute guard is defined as
//! `state === "Draft" && revisionCount === 1`, so if an answer arrived as a new revision the guard
//! would switch itself off and nobody would be warned that their answer had not been folded in. Every
//! case below therefore asserts the revision count as well as the content.
//!
//! Every case goes over real HTTP against a real router, so a handler that exists but was never
//! registered still fails these tests.

use reqwest::header::AUTHORIZATION;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_core::models::PlanFile;
use tendril_core::plans::{create_plan, read_plan_file, CreatePlanOptions};
use tendril_server::{create_router, AppState};

/// A plan body with one `questions` fence, the shape an answer is written into.
const UNANSWERED: &str = "# Answerable Plan\n\n## Problem\n\n```questions\nquestions:\n  - id: store\n    title: Which store should hold the answers?\n    options:\n      - title: SQLite\n        value: sqlite\n      - title: Files\n        value: files\n```\n";

struct TestServer {
    tendril_home: PathBuf,
    port: u16,
    host: String,
    secret: String,
    state: Arc<AppState>,
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
        "tendril-plan-revision-test-{}",
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

impl TestServer {
    fn url(&self, plan_ref: &str, suffix: &str) -> String {
        format!(
            "http://{}:{}/api/plans/{}{}",
            self.host, self.port, plan_ref, suffix
        )
    }

    fn plan(&self, title: &str) -> PlanFile {
        let opts = CreatePlanOptions {
            title: title.to_string(),
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
            chat_session_id: None,
        };
        create_plan(&self.state.plans_dir, opts).expect("create plan")
    }

    /// The plan as the app reads it: the revision count and the latest body.
    fn reread(&self, pf: &PlanFile) -> PlanFile {
        read_plan_file(&self.state.plans_dir.join(&pf.folder_name)).expect("read plan file")
    }

    async fn send(&self, method: reqwest::Method, url: &str, body: Value) -> (u16, Value) {
        let resp = reqwest::Client::new()
            .request(method, url)
            .header(AUTHORIZATION, format!("Bearer {}", self.secret))
            .json(&body)
            .send()
            .await
            .expect("request failed");
        let status = resp.status().as_u16();
        let json = resp.json::<Value>().await.expect("response was not JSON");
        (status, json)
    }

    async fn post(&self, url: &str, body: Value) -> (u16, Value) {
        self.send(reqwest::Method::POST, url, body).await
    }

    async fn put(&self, url: &str, body: Value) -> (u16, Value) {
        self.send(reqwest::Method::PUT, url, body).await
    }

    /// The revision body the plan currently serves, straight off `GET /revisions`.
    async fn latest(&self, plan_ref: &str) -> String {
        let resp = reqwest::Client::new()
            .get(self.url(plan_ref, "/revisions"))
            .header(AUTHORIZATION, format!("Bearer {}", self.secret))
            .send()
            .await
            .expect("get revision failed");
        assert_eq!(resp.status().as_u16(), 200);
        resp.text().await.expect("revision body")
    }
}

fn answered(source: &str) -> String {
    source.replace(
        "    title: Which store should hold the answers?",
        "    title: Which store should hold the answers?\n    answer: sqlite",
    )
}

/// The invariant the whole route exists for: the answer lands, and the count does not move.
#[tokio::test]
async fn a_put_to_revisions_latest_overwrites_in_place_without_appending() {
    let server = start_test_server().await;
    let pf = server.plan("Answerable");
    let id = pf.id().to_string();

    // Two appends, so "the newest" is a number that had to be found rather than assumed.
    for _ in 0..2 {
        let (status, _) = server
            .post(
                &server.url(&id, "/revisions"),
                json!({ "content": UNANSWERED }),
            )
            .await;
        assert_eq!(status, 200);
    }
    assert_eq!(server.reread(&pf).revision_count, 2);

    let (status, body) = server
        .put(
            &server.url(&id, "/revisions/latest"),
            json!({ "content": answered(UNANSWERED) }),
        )
        .await;

    assert_eq!(status, 200, "{body}");
    // The number comes back unchanged so a caller can assert nothing moved.
    assert_eq!(body["revision"].as_i64(), Some(2));

    let after = server.reread(&pf);
    assert_eq!(
        after.revision_count, 2,
        "an answer must not append a revision"
    );
    assert!(after.latest_revision_content.contains("answer: sqlite"));
    assert!(server.latest(&id).await.contains("answer: sqlite"));

    // 001.md is the older draft and must be exactly as it was.
    let first = std::fs::read_to_string(
        server
            .state
            .plans_dir
            .join(&pf.folder_name)
            .join("Revisions")
            .join("001.md"),
    )
    .expect("read 001.md");
    assert!(!first.contains("answer: sqlite"));
}

/// The contrast case, stated so the two routes cannot be confused: the same body sent to `POST`
/// appends, and that is precisely why an answer must not go there.
#[tokio::test]
async fn a_post_to_revisions_appends_instead_of_filling_in() {
    let server = start_test_server().await;
    let pf = server.plan("Appendable");
    let id = pf.id().to_string();

    server
        .post(
            &server.url(&id, "/revisions"),
            json!({ "content": UNANSWERED }),
        )
        .await;
    assert_eq!(server.reread(&pf).revision_count, 1);

    let (status, body) = server
        .post(
            &server.url(&id, "/revisions"),
            json!({ "content": answered(UNANSWERED) }),
        )
        .await;

    assert_eq!(status, 200, "{body}");
    assert_eq!(body["revision"].as_i64(), Some(2));
    assert_eq!(server.reread(&pf).revision_count, 2);
}

/// The reported bug, end to end: an agent-authored plan with a defective question block elsewhere made
/// **every** question in that plan unanswerable, with a `400` naming a block the operator had never
/// touched. V1 has no such failure mode — `PlanReaderService.UpdateLatestRevision` does not validate at
/// all — so the write landing is the floor, not an improvement.
#[tokio::test]
async fn a_pre_existing_defect_in_another_block_does_not_block_an_answer() {
    let server = start_test_server().await;
    let pf = server.plan("Defective Plan");
    let id = pf.id().to_string();

    // One valid block and one with a single option, which the validator rejects. `noQuestionCheck` is
    // how such a revision reaches disk in the first place: the agent that wrote it was not made to pass.
    let one_option = "```questions\nquestions:\n  - id: rollout\n    title: How should this roll out?\n    options:\n      - title: All at once\n        value: all-at-once\n```\n";
    let before = format!("{UNANSWERED}\n{one_option}");
    let (status, body) = server
        .post(
            &server.url(&id, "/revisions"),
            json!({ "content": before, "no_question_check": true }),
        )
        .await;
    assert_eq!(status, 200, "{body}");

    let (status, body) = server
        .put(
            &server.url(&id, "/revisions/latest"),
            json!({ "content": format!("{}\n{one_option}", answered(UNANSWERED)) }),
        )
        .await;

    assert_eq!(status, 200, "{body}");
    assert_eq!(body["revision"].as_i64(), Some(1));
    let latest = server.latest(&id).await;
    assert!(latest.contains("answer: sqlite"));
    // The defect is untouched: this path declines to be blocked by it, it does not repair it.
    assert!(latest.contains("value: all-at-once"));
    assert_eq!(server.reread(&pf).revision_count, 1);
}

/// A malformed fence must not be persisted. Nothing was wrong with the document on disk, so this write
/// is what introduced the error — which is the only ground this route refuses on.
#[tokio::test]
async fn a_put_with_a_broken_questions_fence_is_refused() {
    let server = start_test_server().await;
    let pf = server.plan("Broken Fence");
    let id = pf.id().to_string();

    server
        .post(
            &server.url(&id, "/revisions"),
            json!({ "content": UNANSWERED }),
        )
        .await;

    let broken =
        "# Broken\n\n```questions\nquestions:\n  - id: store\n    options: not-a-list\n```\n";
    let (status, body) = server
        .put(
            &server.url(&id, "/revisions/latest"),
            json!({ "content": broken }),
        )
        .await;

    assert_eq!(status, 400, "{body}");
    let error = body["error"].as_str().unwrap_or_default();
    assert!(error.contains("Validation failed"), "{error}");
    // The refusal has to say the write is the cause, not merely that something is wrong: the operator's
    // only other reading is that their answer was rejected for a defect they did not create.
    assert!(error.contains("would introduce"), "{error}");
    // Nothing landed.
    assert!(!server.latest(&id).await.contains("not-a-list"));
    assert_eq!(server.reread(&pf).revision_count, 1);
}

/// A plan with no revision has no blank to fill in. Answering `400` rather than creating `001.md`
/// keeps a caller that meant `POST` from silently getting away with it.
#[tokio::test]
async fn a_put_on_a_plan_with_no_revision_is_a_bad_request_not_a_create() {
    let server = start_test_server().await;
    let pf = server.plan("No Revisions");
    let id = pf.id().to_string();

    let (status, body) = server
        .put(
            &server.url(&id, "/revisions/latest"),
            json!({ "content": UNANSWERED }),
        )
        .await;

    assert_eq!(status, 400, "{body}");
    assert!(body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("no revision to update"));
    assert_eq!(server.reread(&pf).revision_count, 0);
}

#[tokio::test]
async fn a_put_for_a_plan_that_does_not_exist_is_a_not_found() {
    let server = start_test_server().await;

    let (status, _) = server
        .put(
            &server.url("99999", "/revisions/latest"),
            json!({ "content": UNANSWERED }),
        )
        .await;

    assert_eq!(status, 404);
}
