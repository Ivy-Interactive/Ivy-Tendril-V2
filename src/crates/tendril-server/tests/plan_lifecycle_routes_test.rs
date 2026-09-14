//! Routes behind the plan lifecycle dialogs: `GET /api/plans/:id/repo-status`,
//! `POST /api/plans/:id/reset` and `DELETE /api/plans/:id`.
//!
//! The dialogs that call them are destructive, so what these tests pin is the
//! refusal: a terminal or in-flight plan must come back `409 CONFLICT` with the
//! plan untouched, never a silent success the UI would render as done.

use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_core::plans::{create_plan, read_plan_yaml, CreatePlanOptions};
use tendril_server::{create_router, AppState};

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

async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-plan-lifecycle-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let secret = generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, "127.0.0.1").unwrap();

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
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    TestServer {
        tendril_home,
        port,
        secret,
        state,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

fn make_plan(server: &TestServer, title: &str, repos: Vec<String>) -> PathBuf {
    let opts = CreatePlanOptions {
        title: title.to_string(),
        project: "lifecycle-proj".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: Some(0),
        repos,
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    };
    create_plan(&server.state.plans_dir, opts)
        .expect("plan created")
        .folder_path
        .into()
}

fn folder_name(folder: &Path) -> String {
    folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap()
        .to_string()
}

async fn set_state(server: &TestServer, plan: &str, state: &str) {
    let resp = reqwest::Client::new()
        .put(format!(
            "http://127.0.0.1:{}/api/plans/{}",
            server.port, plan
        ))
        .bearer_auth(&server.secret)
        .json(&json!({ "field": "state", "value": state }))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "could not move plan to {state}: {}",
        resp.text().await.unwrap_or_default()
    );
}

/// A repo with one committed file and one uncommitted edit on top of it.
fn make_dirty_repo(root: &Path) -> PathBuf {
    let repo = root.join("dirty-repo");
    std::fs::create_dir_all(&repo).unwrap();
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(&repo)
            .output()
            .unwrap();
    };
    git(&["init"]);
    git(&["config", "user.email", "test@example.com"]);
    git(&["config", "user.name", "Test"]);
    std::fs::write(repo.join("tracked.txt"), "one\n").unwrap();
    git(&["add", "."]);
    git(&["commit", "-m", "initial"]);
    std::fs::write(repo.join("tracked.txt"), "two\n").unwrap();
    repo
}

#[tokio::test]
async fn repo_status_reports_uncommitted_changes() {
    let server = start_test_server().await;
    let repo = make_dirty_repo(&server.tendril_home);
    let folder = make_plan(
        &server,
        "Dirty Repo Guard",
        vec![repo.to_string_lossy().to_string()],
    );

    let resp = reqwest::Client::new()
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/repo-status",
            server.port,
            folder_name(&folder)
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    let repos = body["repos"].as_array().expect("repos array");
    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0]["isDirty"], true);
    let changes = repos[0]["changes"].as_array().expect("changes array");
    assert!(
        changes
            .iter()
            .any(|c| c.as_str().unwrap_or_default().contains("tracked.txt")),
        "expected tracked.txt in {changes:?}"
    );
}

#[tokio::test]
async fn repo_status_reports_a_missing_repo_as_clean_with_an_error() {
    let server = start_test_server().await;
    let folder = make_plan(
        &server,
        "Missing Repo",
        vec![server
            .tendril_home
            .join("not-a-repo")
            .to_string_lossy()
            .to_string()],
    );

    let resp = reqwest::Client::new()
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}/repo-status",
            server.port,
            folder_name(&folder)
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    let repos = body["repos"].as_array().expect("repos array");
    assert_eq!(repos[0]["isDirty"], false);
    assert!(repos[0]["error"].is_string());
}

#[tokio::test]
async fn reset_moves_a_review_plan_back_to_draft() {
    let server = start_test_server().await;
    let folder = make_plan(&server, "Reset Me", vec![]);
    let name = folder_name(&folder);
    set_state(&server, &name, "Review").await;

    // A leftover worktrees directory from the previous execution must be gone.
    let worktrees = folder.join("Worktrees").join("some-repo");
    std::fs::create_dir_all(&worktrees).unwrap();

    let resp = reqwest::Client::new()
        .post(format!(
            "http://127.0.0.1:{}/api/plans/{}/reset",
            server.port, name
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let (plan, _) = read_plan_yaml(&folder).unwrap();
    assert_eq!(plan.state, "Draft");
    assert!(!worktrees.exists(), "worktree directory should be removed");
}

#[tokio::test]
async fn reset_refuses_a_completed_plan_with_409() {
    let server = start_test_server().await;
    let folder = make_plan(&server, "Completed Plan", vec![]);
    let name = folder_name(&folder);
    set_state(&server, &name, "Completed").await;

    let resp = reqwest::Client::new()
        .post(format!(
            "http://127.0.0.1:{}/api/plans/{}/reset",
            server.port, name
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::CONFLICT);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("cannot be reset"));

    // The rejection must leave the plan exactly as it was.
    let (plan, _) = read_plan_yaml(&folder).unwrap();
    assert_eq!(plan.state, "Completed");
}

#[tokio::test]
async fn reset_refuses_an_executing_plan_with_409() {
    let server = start_test_server().await;
    let folder = make_plan(&server, "Executing Plan", vec![]);
    let name = folder_name(&folder);
    set_state(&server, &name, "Executing").await;

    let resp = reqwest::Client::new()
        .post(format!(
            "http://127.0.0.1:{}/api/plans/{}/reset",
            server.port, name
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::CONFLICT);
    let (plan, _) = read_plan_yaml(&folder).unwrap();
    assert_eq!(plan.state, "Executing");
}

#[tokio::test]
async fn delete_removes_the_plan_folder() {
    let server = start_test_server().await;
    let folder = make_plan(&server, "Delete Me", vec![]);
    let name = folder_name(&folder);

    let resp = reqwest::Client::new()
        .delete(format!(
            "http://127.0.0.1:{}/api/plans/{}",
            server.port, name
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    assert!(!folder.exists(), "plan folder should be gone");

    let follow_up = reqwest::Client::new()
        .get(format!(
            "http://127.0.0.1:{}/api/plans/{}",
            server.port, name
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(follow_up.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_refuses_an_in_flight_plan_with_409() {
    let server = start_test_server().await;
    let folder = make_plan(&server, "Busy Plan", vec![]);
    let name = folder_name(&folder);
    set_state(&server, &name, "Executing").await;

    let resp = reqwest::Client::new()
        .delete(format!(
            "http://127.0.0.1:{}/api/plans/{}",
            server.port, name
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::CONFLICT);
    assert!(folder.exists(), "plan folder must survive the refusal");
}

#[tokio::test]
async fn delete_allows_a_completed_plan() {
    let server = start_test_server().await;
    let folder = make_plan(&server, "Old Completed", vec![]);
    let name = folder_name(&folder);
    set_state(&server, &name, "Completed").await;

    let resp = reqwest::Client::new()
        .delete(format!(
            "http://127.0.0.1:{}/api/plans/{}",
            server.port, name
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    assert!(!folder.exists());
}

#[tokio::test]
async fn delete_reports_an_unknown_plan_as_not_found() {
    let server = start_test_server().await;

    let resp = reqwest::Client::new()
        .delete(format!(
            "http://127.0.0.1:{}/api/plans/99999-NoSuchPlan",
            server.port
        ))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::NOT_FOUND);
}
