//! `GET /api/projects/:name/review-actions?planId=...`: whether each review action's condition holds
//! for a plan, which is what the Review page disables its buttons on.
//!
//! V1 evaluated these with `PlatformHelper.EvaluatePowerShellCondition(action.Condition, folderPath)`
//! — against the **plan folder** — and `ReviewActionsBarView.BuildActionButton` disabled a button
//! whose condition did not hold. These tests pin both halves of that: the folder a relative
//! `Test-Path` resolves against, and the three-way answer (`met` / `notMet` / `unknown`) that keeps a
//! condition nobody could evaluate from being reported as one that failed.
//!
//! The server binds 127.0.0.1:0 and every fixture lives in a temp `TENDRIL_HOME` that `Drop` removes.

use std::path::PathBuf;
use std::sync::Arc;
use tendril_server::{create_router, AppState};

struct Server {
    port: u16,
    secret: String,
    tendril_home: PathBuf,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

async fn start_server(config: &str) -> Server {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-review-action-conditions-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(tendril_home.join("Plans")).unwrap();

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        tendril_home.join("Plans"),
        secret.clone(),
    ));

    // Written through the path the state actually resolved, and asserted to be inside the temp home:
    // `TENDRIL_CONFIG` can redirect it, and a test must fail rather than write over a real config.
    assert_eq!(
        state.config_path,
        tendril_home.join("config.yaml"),
        "TENDRIL_CONFIG must not be set when running this suite"
    );
    std::fs::write(&state.config_path, config).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (shutdown, rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _ = axum::serve(listener, create_router(state))
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
    });

    Server {
        port,
        secret,
        tendril_home,
        shutdown: Some(shutdown),
    }
}

impl Server {
    /// A plan folder `00042-Fixture` with `plan.yaml`, and `Worktrees/Repo/docs` inside it — the
    /// directory the conditions below ask about.
    fn create_plan(&self) -> PathBuf {
        let plan_folder = self.tendril_home.join("Plans").join("00042-Fixture");
        std::fs::create_dir_all(plan_folder.join("Worktrees").join("Repo").join("docs")).unwrap();
        let plan = tendril_core::models::PlanYaml {
            project: "Demo".to_string(),
            title: "Fixture".to_string(),
            ..Default::default()
        };
        std::fs::write(
            plan_folder.join("plan.yaml"),
            serde_yaml::to_string(&plan).unwrap(),
        )
        .unwrap();
        plan_folder
    }

    async fn get(&self, path: &str) -> reqwest::Response {
        reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}{}", self.port, path))
            .bearer_auth(&self.secret)
            .send()
            .await
            .unwrap()
    }

    /// The route's answer, as `(name, state, reason)` in the order it came back.
    async fn conditions(&self, query: &str) -> Vec<(String, String, Option<String>)> {
        let response = self
            .get(&format!("/api/projects/Demo/review-actions{query}"))
            .await;
        assert_eq!(response.status(), 200);
        let body: serde_json::Value = response.json().await.unwrap();
        body.as_array()
            .expect("the answer is a list, one entry per action")
            .iter()
            .map(|entry| {
                (
                    entry["name"].as_str().unwrap().to_string(),
                    entry["state"].as_str().unwrap().to_string(),
                    entry
                        .get("reason")
                        .and_then(|r| r.as_str())
                        .map(str::to_string),
                )
            })
            .collect()
    }
}

const CONFIG: &str = r#"
projects:
  - name: Demo
    reviewActions:
      - name: Docs
        condition: Test-Path "Worktrees/Repo/docs"
        command: echo docs
      - name: Samples
        condition: Test-Path "Worktrees/Repo/samples"
        command: echo samples
      - name: Windows
        condition: Test-Path "Worktrees\Repo\docs"
        command: echo windows
      - name: Unconditional
        condition: ''
        command: echo always
      - name: Never
        condition: $false
        command: echo never
      - name: Either
        condition: Test-Path "Worktrees/Repo/samples" -or Test-Path "Worktrees/Repo/docs"
        command: echo either
      - name: EnvCheck
        condition: $env:CI -eq "true"
        command: echo ci
"#;

#[tokio::test]
async fn conditions_are_decided_against_the_plan_folder() {
    let server = start_server(CONFIG).await;
    server.create_plan();

    let conditions = server.conditions("?planId=42").await;
    let state_of = |name: &str| {
        conditions
            .iter()
            .find(|(n, _, _)| n == name)
            .unwrap_or_else(|| panic!("no entry for {name}: {conditions:?}"))
            .clone()
    };

    // The relative path resolves under `Plans/00042-Fixture`, not the daemon's working directory.
    assert_eq!(state_of("Docs").1, "met");
    assert_eq!(
        state_of("Samples"),
        ("Samples".to_string(), "notMet".to_string(), None),
        "a condition that does not hold is explained by the condition itself, with no reason"
    );
    // A config written on Windows means the same folder.
    assert_eq!(state_of("Windows").1, "met");
    // V1: an empty condition is `(action.Name, true)`.
    assert_eq!(state_of("Unconditional").1, "met");
    assert_eq!(state_of("Never").1, "notMet");
    assert_eq!(state_of("Either").1, "met");
}

#[tokio::test]
async fn a_condition_nobody_can_evaluate_is_unknown_and_says_why() {
    let server = start_server(CONFIG).await;
    server.create_plan();

    let conditions = server.conditions("?planId=42").await;
    let (_, state, reason) = conditions
        .iter()
        .find(|(n, _, _)| n == "EnvCheck")
        .unwrap()
        .clone();

    assert_eq!(
        state, "unknown",
        "an unsupported condition was never run, so it has not failed"
    );
    let reason = reason.expect("an unknown verdict carries its reason");
    assert!(reason.contains("unsupported"), "got {reason:?}");
}

#[tokio::test]
async fn the_answer_follows_config_order_and_carries_the_condition() {
    let server = start_server(CONFIG).await;
    server.create_plan();

    let names: Vec<String> = server
        .conditions("?planId=00042")
        .await
        .into_iter()
        .map(|(name, _, _)| name)
        .collect();
    assert_eq!(
        names,
        [
            "Docs",
            "Samples",
            "Windows",
            "Unconditional",
            "Never",
            "Either",
            "EnvCheck"
        ]
    );

    let body: serde_json::Value = server
        .get("/api/projects/demo/review-actions?planId=42")
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(
        body[0]["condition"], "Test-Path \"Worktrees/Repo/docs\"",
        "the project name matches case-insensitively and the condition is returned as written"
    );
}

/// A condition that is not PowerShell runs through the shell, from the plan folder, and sees the
/// same environment as the command it gates.
#[cfg(unix)]
#[tokio::test]
async fn shell_conditions_run_from_the_plan_folder_with_the_actions_environment() {
    let server = start_server(
        r#"
projects:
  - name: Demo
    reviewActions:
      - name: HasDocs
        condition: test -d Worktrees/Repo/docs
        command: echo docs
      - name: HasSamples
        condition: test -d Worktrees/Repo/samples
        command: echo samples
      - name: KnowsItsPlan
        condition: '[ "$PLAN_ID" = "00042" ] && [ "$PROJECT_NAME" = "Demo" ]'
        command: echo plan
"#,
    )
    .await;
    server.create_plan();

    let conditions = server.conditions("?planId=42").await;
    let states: Vec<(&str, &str)> = conditions
        .iter()
        .map(|(n, s, _)| (n.as_str(), s.as_str()))
        .collect();
    assert_eq!(
        states,
        [
            ("HasDocs", "met"),
            ("HasSamples", "notMet"),
            ("KnowsItsPlan", "met")
        ]
    );
}

#[tokio::test]
async fn a_plan_is_required_and_has_to_exist() {
    let server = start_server(CONFIG).await;
    server.create_plan();

    assert_eq!(
        server
            .get("/api/projects/Demo/review-actions")
            .await
            .status(),
        400
    );
    assert_eq!(
        server
            .get("/api/projects/Demo/review-actions?planId=")
            .await
            .status(),
        400
    );
    assert_eq!(
        server
            .get("/api/projects/Demo/review-actions?planId=999")
            .await
            .status(),
        404
    );
    assert_eq!(
        server
            .get("/api/projects/Nope/review-actions?planId=42")
            .await
            .status(),
        404
    );
}

#[tokio::test]
async fn the_route_requires_authentication() {
    let server = start_server(CONFIG).await;
    server.create_plan();

    let response = reqwest::Client::new()
        .get(format!(
            "http://127.0.0.1:{}/api/projects/Demo/review-actions?planId=42",
            server.port
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        401,
        "shell conditions are commands, so this route stays behind the bearer check"
    );
}
