//! `DELETE /api/projects/:name` versus `DELETE /api/projects/:name/data` — the two project
//! removals, and the line between them.
//!
//! The distinction is the whole point of these tests. The first route **forgets** a project: the
//! `config.yaml` entry goes and everything the project owns stays, which is what it has always
//! done and what the UI now calls "Remove". The second **deletes** it: the plan folders, the
//! project directory under `<TENDRIL_HOME>/Projects/` and the database rows all go too.
//!
//! Both are asserted against the filesystem rather than against the handler's reply, because a
//! handler that reports the right thing and removes the wrong one is exactly the bug here.

use reqwest::header::AUTHORIZATION;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{generate_bearer_secret, load_config, MasterGuard};
use tendril_core::plans::{create_plan, CreatePlanOptions};
use tendril_server::{create_router, AppState};

const TWO_PROJECT_CONFIG: &str = r#"
codingAgent: claude
projects:
  - name: Doomed
    color: Red
    repos:
      - path: /repos/doomed
  - name: Keeper
    color: Blue
    repos:
      - path: /repos/keeper
verifications: []
"#;

struct TestServer {
    tendril_home: PathBuf,
    port: u16,
    host: String,
    secret: String,
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

async fn start_test_server(tag: &str) -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-project-purge-test-{tag}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    std::fs::write(tendril_home.join("config.yaml"), TWO_PROJECT_CONFIG).unwrap();

    let host_str = "127.0.0.1".to_string();
    let listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();

    let secret = generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str, "http").unwrap();

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
        host: host_str,
        secret,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

impl TestServer {
    async fn delete(&self, suffix: &str) -> (u16, Value) {
        let res = reqwest::Client::new()
            .delete(format!(
                "http://{}:{}/api/projects{}",
                self.host, self.port, suffix
            ))
            .header(AUTHORIZATION, format!("Bearer {}", self.secret))
            .send()
            .await
            .expect("request");
        let status = res.status().as_u16();
        let json = res.json::<Value>().await.unwrap_or(Value::Null);
        (status, json)
    }

    fn plans_dir(&self) -> PathBuf {
        self.tendril_home.join("Plans")
    }

    /// `<TENDRIL_HOME>/Projects/<name>/`, seeded with the subdirectories the daemon puts there.
    fn seed_project_dir(&self, name: &str) -> PathBuf {
        let dir = self.tendril_home.join("Projects").join(name);
        std::fs::create_dir_all(dir.join("Repos").join("owner").join("repo")).unwrap();
        std::fs::create_dir_all(dir.join("Skills")).unwrap();
        std::fs::write(
            dir.join("Repos").join("owner").join("repo").join("a.txt"),
            "x",
        )
        .unwrap();
        dir
    }

    /// A plan folder naming `project`, returned as its path on disk.
    fn seed_plan(&self, title: &str, project: &str) -> PathBuf {
        let opts = CreatePlanOptions {
            title: title.to_string(),
            project: project.to_string(),
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
        let created = create_plan(&self.plans_dir(), opts).unwrap();
        PathBuf::from(created.folder_path)
    }

    fn project_names(&self) -> Vec<String> {
        load_config(&self.tendril_home.join("config.yaml"))
            .expect("load config")
            .projects
            .into_iter()
            .map(|p| p.name)
            .collect()
    }
}

/// The reversible route, and the guarantee the UI's "Remove project" copy makes: the entry goes and
/// nothing on disk does. This is what makes it safe to offer beside the destructive one.
#[tokio::test]
async fn remove_forgets_the_project_without_deleting_any_of_its_data() {
    let srv = start_test_server("remove-keeps-data").await;
    let project_dir = srv.seed_project_dir("Doomed");
    let plan_folder = srv.seed_plan("A Doomed Plan", "Doomed");

    let (status, body) = srv.delete("/Doomed").await;
    assert_eq!(status, 200, "DELETE failed: {body}");

    assert_eq!(
        srv.project_names(),
        vec!["Keeper".to_string()],
        "the config entry was not removed"
    );
    assert!(
        project_dir.exists(),
        "remove deleted the project directory {}",
        project_dir.display()
    );
    assert!(
        plan_folder.exists(),
        "remove deleted the plan folder {}",
        plan_folder.display()
    );
}

/// The destructive route. Every one of the three things a "Remove" leaves behind has to be gone,
/// and the project the operator did not name has to be untouched.
#[tokio::test]
async fn delete_data_removes_the_plans_the_directory_and_the_config_entry() {
    let srv = start_test_server("purge-removes").await;
    let doomed_dir = srv.seed_project_dir("Doomed");
    let keeper_dir = srv.seed_project_dir("Keeper");
    let doomed_plan = srv.seed_plan("A Doomed Plan", "Doomed");
    let keeper_plan = srv.seed_plan("A Keeper Plan", "Keeper");

    let (status, body) = srv.delete("/Doomed/data").await;
    assert_eq!(status, 200, "purge failed: {body}");

    assert_eq!(
        srv.project_names(),
        vec!["Keeper".to_string()],
        "the config entry survived the purge"
    );
    assert!(
        !doomed_dir.exists(),
        "the project directory survived the purge: {}",
        doomed_dir.display()
    );
    assert!(
        !doomed_plan.exists(),
        "the plan folder survived the purge: {}",
        doomed_plan.display()
    );

    assert!(
        keeper_dir.exists(),
        "purging one project deleted another's directory"
    );
    assert!(
        keeper_plan.exists(),
        "purging one project deleted another's plan"
    );
    assert_eq!(
        body.get("plansDeleted").and_then(Value::as_u64),
        Some(1),
        "the reply did not report the plan it deleted: {body}"
    );
}

/// `plan.yaml`'s `project` key is the only thing tying a plan folder to a project, and every other
/// project comparison in the codebase is case-insensitive.
#[tokio::test]
async fn delete_data_matches_plans_and_the_project_name_case_insensitively() {
    let srv = start_test_server("purge-case").await;
    let plan_folder = srv.seed_plan("Case Test", "doomed");

    let (status, body) = srv.delete("/DOOMED/data").await;
    assert_eq!(status, 200, "purge failed: {body}");

    assert!(
        !plan_folder.exists(),
        "a plan naming the project in another case survived: {}",
        plan_folder.display()
    );
    assert_eq!(srv.project_names(), vec!["Keeper".to_string()]);
}

/// 404 rather than a directory delete: the config is what says a name is a project, so a name that
/// is not in it must not reach `remove_dir_all` at all.
#[tokio::test]
async fn delete_data_refuses_a_name_that_is_not_a_project() {
    let srv = start_test_server("purge-unknown").await;
    // A directory that exists under Projects but belongs to no configured project.
    let stray = srv.seed_project_dir("Stray");

    let (status, body) = srv.delete("/Stray/data").await;
    assert_eq!(status, 404, "unexpected status: {body}");
    // The handler's own 404, not the router failing to match a route that does not exist -- those
    // are the same status and only the body tells them apart.
    assert!(
        body.get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("Stray")),
        "the 404 did not come from the purge handler: {body}"
    );
    assert!(
        stray.exists(),
        "a 404 still deleted the directory {}",
        stray.display()
    );
    assert_eq!(srv.project_names(), vec!["Doomed", "Keeper"]);
}

/// `get_project_root_dir` returns the bare `Projects` directory for a name that sanitizes to
/// nothing, so without the guard this request would delete every project's data.
#[tokio::test]
async fn delete_data_refuses_a_name_with_no_directory_of_its_own() {
    let srv = start_test_server("purge-blank-name").await;
    std::fs::write(
        srv.tendril_home.join("config.yaml"),
        "codingAgent: claude\nprojects:\n  - name: \"///\"\n  - name: Keeper\nverifications: []\n",
    )
    .unwrap();
    let keeper_dir = srv.seed_project_dir("Keeper");
    let projects_root = srv.tendril_home.join("Projects");

    let (status, body) = srv.delete("/%2F%2F%2F/data").await;
    assert_eq!(status, 400, "unexpected status: {body}");
    assert!(
        projects_root.exists() && keeper_dir.exists(),
        "the guard did not stop the delete: {} still needed",
        projects_root.display()
    );
}
