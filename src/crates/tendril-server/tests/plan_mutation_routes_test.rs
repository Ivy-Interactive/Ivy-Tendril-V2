//! The plan list-mutation endpoints: repos, PRs, commits, dependencies, related plans, validate.
//!
//! Every case goes over real HTTP against a real router so that a handler which exists but was
//! never registered still fails these tests.

use reqwest::header::AUTHORIZATION;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_core::models::{PlanFile, PlanYaml};
use tendril_core::plans::{create_plan, read_plan_yaml, CreatePlanOptions};
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
        "tendril-plan-mutation-test-{}",
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

impl TestServer {
    fn url(&self, plan_ref: &str, suffix: &str) -> String {
        format!(
            "http://{}:{}/api/plans/{}{}",
            self.host, self.port, plan_ref, suffix
        )
    }

    fn plan(&self, title: &str) -> PlanFile {
        self.plan_for_session(title, None)
    }

    fn plan_for_session(&self, title: &str, chat_session_id: Option<String>) -> PlanFile {
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
            chat_session_id,
        };
        create_plan(&self.state.plans_dir, opts).expect("create plan")
    }

    fn yaml(&self, pf: &PlanFile) -> PlanYaml {
        read_plan_yaml(&self.state.plans_dir.join(&pf.folder_name))
            .expect("read plan.yaml")
            .0
    }

    fn raw_yaml(&self, pf: &PlanFile) -> String {
        std::fs::read_to_string(self.state.plans_dir.join(&pf.folder_name).join("plan.yaml"))
            .expect("read plan.yaml bytes")
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

    async fn delete(&self, url: &str, body: Value) -> (u16, Value) {
        self.send(reqwest::Method::DELETE, url, body).await
    }
}

fn message(body: &Value) -> String {
    body["message"].as_str().unwrap_or_default().to_string()
}

fn error(body: &Value) -> String {
    body["error"].as_str().unwrap_or_default().to_string()
}

async fn session(server: &TestServer, name: &str, plan_folder: Option<String>) -> String {
    server
        .state
        .chat_manager
        .create_session(
            Some(name.to_string()),
            Some("claude".to_string()),
            Some("default".to_string()),
            None,
            plan_folder,
        )
        .await
        .expect("create chat session")
        .id
}

async fn messages(server: &TestServer, session_id: &str) -> Vec<String> {
    server
        .state
        .chat_manager
        .get_session(session_id)
        .await
        .expect("session exists")
        .messages
        .iter()
        .map(|m| m.content.clone())
        .collect()
}

/// 1. A repeated add answers 200, says "already", and leaves the list and `updated` alone.
#[tokio::test]
async fn adding_the_same_entry_twice_is_idempotent() {
    let server = start_test_server().await;
    let target = server.plan("Idempotency Target");
    let pf = server.plan("Idempotency");
    let id = pf.id().to_string();

    let cases: [(&str, Value, fn(&PlanYaml) -> Vec<String>); 5] = [
        ("/repos", json!({ "repoPath": "/tmp/some-repo" }), |p| {
            p.repos.clone()
        }),
        (
            "/prs",
            json!({ "prUrl": "https://github.com/o/r/pull/7" }),
            |p| p.prs.clone(),
        ),
        ("/commits", json!({ "sha": "abc1234" }), |p| {
            p.commits.clone()
        }),
        (
            "/depends-on",
            json!({ "dependsOn": target.folder_name.clone() }),
            |p| p.depends_on.clone(),
        ),
        (
            "/related-plans",
            json!({ "relatedPlan": target.folder_name.clone() }),
            |p| p.related_plans.clone(),
        ),
    ];

    for (suffix, body, list) in cases {
        let url = server.url(&id, suffix);

        let (status, first) = server.post(&url, body.clone()).await;
        assert_eq!(status, 200, "{} first add: {:?}", suffix, first);
        let after_first = server.yaml(&pf);
        assert_eq!(list(&after_first).len(), 1, "{}", suffix);

        let (status, second) = server.post(&url, body.clone()).await;
        assert_eq!(status, 200, "{} second add: {:?}", suffix, second);
        assert!(
            message(&second).contains("already"),
            "{} should report a no-op, got: {}",
            suffix,
            message(&second)
        );

        let after_second = server.yaml(&pf);
        assert_eq!(list(&after_second), list(&after_first), "{}", suffix);
        assert_eq!(
            after_second.updated, after_first.updated,
            "{}: a no-op must not touch `updated`",
            suffix
        );
    }
}

/// 2. Removing something that was never attached is a 404, not a silent success.
#[tokio::test]
async fn removing_an_unattached_entry_is_not_found() {
    let server = start_test_server().await;
    let target = server.plan("Removal Target");
    let pf = server.plan("Removal");
    let id = pf.id().to_string();

    let cases: [(&str, Value, &str); 3] = [
        (
            "/repos",
            json!({ "repoPath": "/tmp/never-added" }),
            "Repository not found in plan",
        ),
        (
            "/depends-on",
            json!({ "dependsOn": target.folder_name.clone() }),
            "Dependency not found",
        ),
        (
            "/related-plans",
            json!({ "relatedPlan": target.folder_name.clone() }),
            "Related plan not found",
        ),
    ];

    for (suffix, body, expected) in cases {
        let before = server.raw_yaml(&pf);
        let (status, resp) = server.delete(&server.url(&id, suffix), body).await;

        assert_eq!(status, 404, "{}: {:?}", suffix, resp);
        assert!(
            error(&resp).contains(expected),
            "{} expected '{}', got: {}",
            suffix,
            expected,
            error(&resp)
        );
        assert_eq!(server.raw_yaml(&pf), before, "{} must not write", suffix);
    }
}

/// 3. Every accepted form of a plan reference lands on the same canonical folder name.
#[tokio::test]
async fn partial_plan_references_are_stored_canonically() {
    let server = start_test_server().await;
    let target = server.plan("Dependency Target");
    let canonical = target.folder_name.clone();
    let abs_path = server
        .state
        .plans_dir
        .join(&canonical)
        .to_string_lossy()
        .to_string();

    let refs = [
        target.id().to_string(),
        format!("{:05}", target.id()),
        canonical.clone(),
        abs_path,
    ];

    for plan_ref in &refs {
        // A fresh plan per reference form, so each assertion sees exactly one entry.
        let dep_plan = server.plan("Depends Via Reference");
        let (status, resp) = server
            .post(
                &server.url(&dep_plan.id().to_string(), "/depends-on"),
                json!({ "dependsOn": plan_ref }),
            )
            .await;
        assert_eq!(status, 200, "dependsOn {}: {:?}", plan_ref, resp);
        assert_eq!(
            server.yaml(&dep_plan).depends_on,
            vec![canonical.clone()],
            "dependsOn {} was not canonicalised",
            plan_ref
        );

        let rel_plan = server.plan("Related Via Reference");
        let (status, resp) = server
            .post(
                &server.url(&rel_plan.id().to_string(), "/related-plans"),
                json!({ "relatedPlan": plan_ref }),
            )
            .await;
        assert_eq!(status, 200, "relatedPlan {}: {:?}", plan_ref, resp);
        assert_eq!(
            server.yaml(&rel_plan).related_plans,
            vec![canonical.clone()],
            "relatedPlan {} was not canonicalised",
            plan_ref
        );
    }
}

/// 4. A bad *referenced* plan reads differently from a bad plan in the path.
#[tokio::test]
async fn an_unknown_plan_reference_is_reported_separately_from_an_unknown_plan() {
    let server = start_test_server().await;
    let pf = server.plan("Unknown Reference");
    let id = pf.id().to_string();

    let (status, resp) = server
        .post(
            &server.url(&id, "/depends-on"),
            json!({ "dependsOn": "99999" }),
        )
        .await;
    assert_eq!(status, 404, "{:?}", resp);
    assert_eq!(error(&resp), "Referenced plan '99999' not found");
    assert!(server.yaml(&pf).depends_on.is_empty());

    let (status, resp) = server
        .post(
            &server.url("99999", "/depends-on"),
            json!({ "dependsOn": pf.folder_name.clone() }),
        )
        .await;
    assert_eq!(status, 404, "{:?}", resp);
    assert_eq!(error(&resp), "Plan '99999' not found");
}

/// 5. An invalid plan is a 200 answer describing the invalidity; only a missing plan is a 404.
#[tokio::test]
async fn validate_answers_200_even_when_the_plan_is_invalid() {
    let server = start_test_server().await;

    let healthy = server.plan("Healthy Plan");
    let (status, resp) = server
        .post(
            &server.url(&healthy.id().to_string(), "/validate"),
            json!({}),
        )
        .await;
    assert_eq!(status, 200, "{:?}", resp);
    assert_eq!(resp["valid"], json!(true));
    assert_eq!(message(&resp), "Plan is valid");

    let broken = server.plan("Broken Plan");
    std::fs::write(
        server
            .state
            .plans_dir
            .join(&broken.folder_name)
            .join("plan.yaml"),
        ": not: valid: yaml\n",
    )
    .unwrap();

    let (status, resp) = server
        .post(
            &server.url(&broken.id().to_string(), "/validate"),
            json!({}),
        )
        .await;
    assert_eq!(
        status, 200,
        "an invalid plan is still a well-formed request: {:?}",
        resp
    );
    assert_eq!(resp["valid"], json!(false));
    assert!(!message(&resp).is_empty(), "{:?}", resp);

    let (status, resp) = server
        .post(&server.url("99999", "/validate"), json!({}))
        .await;
    assert_eq!(status, 404, "{:?}", resp);
    assert_eq!(error(&resp), "Plan '99999' not found");
}

/// 6. Attaching a PR announces it — the dead-code regression this endpoint exists to close.
#[tokio::test]
async fn attaching_a_pr_announces_it_to_the_other_sessions() {
    let server = start_test_server().await;

    let general = session(&server, "General Chat", None).await;
    let pf = server.plan_for_session("PR Announce Plan", Some(general.clone()));
    let side_panel = session(&server, "Side Panel", Some(pf.folder_name.clone())).await;
    let unlinked = session(&server, "Unlinked", None).await;

    let pr_url = "https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/585";
    let (status, resp) = server
        .post(
            &server.url(&pf.id().to_string(), "/prs"),
            json!({ "prUrl": pr_url, "sourceChatSessionId": side_panel }),
        )
        .await;
    assert_eq!(status, 200, "{:?}", resp);
    assert_eq!(server.yaml(&pf).prs, vec![pr_url.to_string()]);

    let expected = format!(
        "[System Event] Pull request for plan 'PR Announce Plan' (#{id:05}) has been created: {pr_url}. Please review the pull request and next steps.",
        id = pf.id()
    );
    assert_eq!(messages(&server, &general).await, vec![expected]);
    assert_eq!(
        messages(&server, &side_panel).await,
        Vec::<String>::new(),
        "the session that made the edit must not be told about it"
    );
    assert_eq!(messages(&server, &unlinked).await, Vec::<String>::new());
}

/// 7. Editing a list does not resurrect a terminal plan.
#[tokio::test]
async fn mutations_do_not_change_a_terminal_state() {
    let server = start_test_server().await;
    let target = server.plan("Terminal Target");

    for state in ["Completed", "Skipped"] {
        let pf = server.plan(&format!("Terminal {}", state));
        let id = pf.id().to_string();

        let (status, resp) = server
            .send(
                reqwest::Method::PUT,
                &server.url(&id, ""),
                json!({ "field": "state", "value": state }),
            )
            .await;
        assert_eq!(status, 200, "{} set: {:?}", state, resp);

        let body = json!({ "dependsOn": target.folder_name.clone() });
        let (status, resp) = server
            .post(&server.url(&id, "/depends-on"), body.clone())
            .await;
        assert_eq!(status, 200, "{} add: {:?}", state, resp);
        let added = server.yaml(&pf);
        assert_eq!(added.depends_on, vec![target.folder_name.clone()]);
        assert_eq!(added.state, state, "adding a dependency changed the state");

        let (status, resp) = server.delete(&server.url(&id, "/depends-on"), body).await;
        assert_eq!(status, 200, "{} remove: {:?}", state, resp);
        let removed = server.yaml(&pf);
        assert!(removed.depends_on.is_empty());
        assert_eq!(
            removed.state, state,
            "removing a dependency changed the state"
        );
    }
}

/// 8. `reason` reaches the other sessions alongside the summary.
#[tokio::test]
async fn a_reason_is_reported_with_the_edit() {
    let server = start_test_server().await;

    let general = session(&server, "General Chat", None).await;
    let pf = server.plan_for_session("Reason Plan", Some(general.clone()));

    let (status, resp) = server
        .post(
            &server.url(&pf.id().to_string(), "/repos"),
            json!({
                "repoPath": "/tmp/second-repo",
                "reason": "operator added the second repo"
            }),
        )
        .await;
    assert_eq!(status, 200, "{:?}", resp);

    let received = messages(&server, &general).await;
    assert_eq!(received.len(), 1, "{:?}", received);
    assert!(
        received[0].contains("repo added: /tmp/second-repo"),
        "{}",
        received[0]
    );
    assert!(
        received[0].contains("Reason: operator added the second repo."),
        "{}",
        received[0]
    );
}

/// 9. `PUT :id` has never written list fields, and still does not: these endpoints are the only
/// writers. Pins the pre-existing silent no-op rather than changing it.
#[tokio::test]
async fn put_plan_field_still_ignores_list_fields() {
    let server = start_test_server().await;
    let pf = server.plan("Silent No-Op");

    let (status, resp) = server
        .send(
            reqwest::Method::PUT,
            &server.url(&pf.id().to_string(), ""),
            json!({ "field": "repos", "value": "/tmp/ignored-repo" }),
        )
        .await;

    assert_eq!(status, 200, "{:?}", resp);
    assert_eq!(message(&resp), "Field 'repos' updated");
    assert!(
        server.yaml(&pf).repos.is_empty(),
        "PUT :id must not be a second writer for `repos`"
    );
}
