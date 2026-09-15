//! The `/api/projects` write endpoints, against the nine unmodeled project keys the .NET V1 app
//! writes into `config.yaml` (the agent security block plus `autoImplementPlans` and `meta`).
//!
//! Every case goes over real HTTP against a real router so that a handler which exists but was
//! never registered still fails these tests, and every assertion reads `config.yaml` back off disk
//! — the bug this guards against is a silent whole-file rewrite, so only the file settles it.

use reqwest::header::AUTHORIZATION;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{generate_bearer_secret, load_config, MasterGuard};
use tendril_core::models::{
    OutsideFileAccessPolicy, ProjectConfig, SandboxMode, SecurityPreset, TerminalAutoExecution,
};
use tendril_server::{create_router, AppState};

/// One project carrying every modeled key *and* all nine unmodeled ones, plus a second project so a
/// write to the first can be shown not to disturb it. Mirrors the `tendril-core` fixture in
/// `config_unknown_keys_test.rs`, with the live values from the operator's `config.yaml`.
const SAMPLE_PROJECT_EXTRAS_CONFIG: &str = r##"
codingAgent: claude
jobTimeout: 30
maxConcurrentJobs: 20
projects:
  - name: ivy-framework
    color: Green
    meta: {}
    repos:
      - path: /repos/ivy-framework
        baseBranch: development
    verifications:
      - name: DotnetBuild
        required: true
    context: ''
    stackHash: fe.ts:react/be.cs:aspnetcore
    reviewActions:
      - name: Docs
        condition: Test-Path "src/Ivy.Docs"
        command: dotnet run --project src/Ivy.Docs/Ivy.Docs.csproj
    hooks: []
    buildDependencies: []
    mcpServers: []
    skills: []
    ports: {}
    envFiles: []
    securityPreset: Custom
    outsideFileAccessPolicy: Allow
    terminalAutoExecution: AlwaysProceed
    sandboxMode: InheritGeneral
    autoImplementPlans: InheritGeneral
    filePermissions: []
    networkAccessRules: []
    allowedTerminalCommands: []
  - name: other-project
    color: Blue
    repos:
      - path: /repos/other
    sandboxMode: Disabled
    securityPreset: Strict
verifications: []
planTemplate: "# Plan Template"
levels:
  - name: Feature
    color: Blue
theme: default
"##;

/// The nine keys and the exact values the fixture gives them. Asserting on *values* rather than key
/// presence is the point: a key that survives with the wrong value is still a broken security
/// setting.
fn expected_project_extras() -> Vec<(&'static str, Value)> {
    vec![
        ("meta", json!({})),
        ("securityPreset", json!("Custom")),
        ("outsideFileAccessPolicy", json!("Allow")),
        ("terminalAutoExecution", json!("AlwaysProceed")),
        ("sandboxMode", json!("InheritGeneral")),
        ("autoImplementPlans", json!("InheritGeneral")),
        ("filePermissions", json!([])),
        ("networkAccessRules", json!([])),
        ("allowedTerminalCommands", json!([])),
    ]
}

/// `meta`/`autoImplementPlans` still live in `.extra`; the seven agent security keys are now typed
/// fields on `.security`, so they're checked against the fixture's literal values directly.
fn assert_all_nine_extras(project: &ProjectConfig, context: &str) {
    for (key, expected) in [
        ("meta", json!({})),
        ("autoImplementPlans", json!("InheritGeneral")),
    ] {
        assert_eq!(
            project.extra.get(key),
            Some(&expected),
            "{context}: project '{}' lost or altered '{key}' (extras present: {:?})",
            project.name,
            project.extra.keys().collect::<Vec<_>>()
        );
    }

    assert_eq!(
        project.security.security_preset,
        SecurityPreset::Custom,
        "{context}: project '{}' lost or altered 'securityPreset'",
        project.name
    );
    assert_eq!(
        project.security.outside_file_access_policy,
        OutsideFileAccessPolicy::Allow,
        "{context}: project '{}' lost or altered 'outsideFileAccessPolicy'",
        project.name
    );
    assert_eq!(
        project.security.terminal_auto_execution,
        TerminalAutoExecution::AlwaysProceed,
        "{context}: project '{}' lost or altered 'terminalAutoExecution'",
        project.name
    );
    assert_eq!(
        project.security.sandbox_mode,
        SandboxMode::InheritGeneral,
        "{context}: project '{}' lost or altered 'sandboxMode'",
        project.name
    );
    assert!(
        project.security.file_permissions.is_empty(),
        "{context}: project '{}' lost or altered 'filePermissions'",
        project.name
    );
    assert!(
        project.security.network_access_rules.is_empty(),
        "{context}: project '{}' lost or altered 'networkAccessRules'",
        project.name
    );
    assert!(
        project.security.allowed_terminal_commands.is_empty(),
        "{context}: project '{}' lost or altered 'allowedTerminalCommands'",
        project.name
    );
}

/// The same nine keys, asserted on a JSON response body. `#[serde(flatten)]` puts them at the top
/// level of the project object, beside the modeled fields.
fn assert_all_nine_extras_in_json(body: &Value, context: &str) {
    for (key, expected) in expected_project_extras() {
        assert_eq!(
            body.get(key),
            Some(&expected),
            "{context}: response body is missing or altered '{key}' (body: {body})"
        );
    }
}

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

/// Seeds a temp `TENDRIL_HOME` with the fixture config **before** constructing `AppState`, which
/// reads the config at construction time, then serves the real router on an ephemeral loopback port.
async fn start_test_server(tag: &str) -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-project-routes-test-{tag}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    std::fs::write(
        tendril_home.join("config.yaml"),
        SAMPLE_PROJECT_EXTRAS_CONFIG,
    )
    .unwrap();

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

    let app = create_router(state);
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
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

impl TestServer {
    fn url(&self, suffix: &str) -> String {
        format!("http://{}:{}/api/projects{}", self.host, self.port, suffix)
    }

    /// The project as it exists **on disk** after a write, not as the handler reported it.
    fn project_from_disk(&self, name: &str) -> ProjectConfig {
        let settings = load_config(&self.tendril_home.join("config.yaml")).expect("load config");
        settings
            .projects
            .into_iter()
            .find(|p| p.name.eq_ignore_ascii_case(name))
            .unwrap_or_else(|| panic!("project '{name}' missing from config.yaml"))
    }

    async fn send(&self, method: reqwest::Method, suffix: &str, body: Value) -> (u16, Value) {
        let res = reqwest::Client::new()
            .request(method, self.url(suffix))
            .header(AUTHORIZATION, format!("Bearer {}", self.secret))
            .json(&body)
            .send()
            .await
            .expect("request");
        let status = res.status().as_u16();
        let json = res.json::<Value>().await.unwrap_or(Value::Null);
        (status, json)
    }

    async fn get(&self, suffix: &str) -> (u16, Value) {
        let res = reqwest::Client::new()
            .get(self.url(suffix))
            .header(AUTHORIZATION, format!("Bearer {}", self.secret))
            .send()
            .await
            .expect("request");
        let status = res.status().as_u16();
        let json = res.json::<Value>().await.unwrap_or(Value::Null);
        (status, json)
    }
}

#[tokio::test]
async fn test_project_put_preserves_unmodeled_keys() {
    let srv = start_test_server("put").await;

    let (status, body) = srv
        .send(
            reqwest::Method::PUT,
            "/ivy-framework",
            json!({ "color": "Red" }),
        )
        .await;
    assert_eq!(status, 200, "PUT failed: {body}");

    // The response shape must not be lossy either: a client that GET/PUT round-trips through it
    // would otherwise clear the keys on the next write.
    assert_all_nine_extras_in_json(&body, "PUT response");

    let proj = srv.project_from_disk("ivy-framework");
    assert_eq!(proj.color, "Red", "the modeled write did not take effect");
    assert_all_nine_extras(&proj, "after PUT /api/projects/:name");

    // The untouched project is untouched.
    let other = srv.project_from_disk("other-project");
    assert_eq!(
        other.security.sandbox_mode,
        SandboxMode::Disabled,
        "a write to one project altered another"
    );
}

/// `UpdateProjectRequest`'s flattened extras **merge** rather than replace: a payload naming one
/// unmodeled key must not clear the eight it omits.
#[tokio::test]
async fn test_project_put_merges_unmodeled_keys_without_clearing_the_rest() {
    let srv = start_test_server("put-merge").await;

    let (status, body) = srv
        .send(
            reqwest::Method::PUT,
            "/ivy-framework",
            json!({ "sandboxMode": "Disabled" }),
        )
        .await;
    assert_eq!(status, 200, "PUT failed: {body}");

    let proj = srv.project_from_disk("ivy-framework");
    assert_eq!(
        proj.security.sandbox_mode,
        SandboxMode::Disabled,
        "the incoming unmodeled key was not persisted"
    );
    assert_eq!(
        proj.security.security_preset,
        SecurityPreset::Custom,
        "partial PUT cleared 'securityPreset'"
    );
    assert_eq!(
        proj.security.outside_file_access_policy,
        OutsideFileAccessPolicy::Allow,
        "partial PUT cleared 'outsideFileAccessPolicy'"
    );
    assert_eq!(
        proj.security.terminal_auto_execution,
        TerminalAutoExecution::AlwaysProceed,
        "partial PUT cleared 'terminalAutoExecution'"
    );
    assert!(
        proj.security.file_permissions.is_empty(),
        "partial PUT cleared 'filePermissions'"
    );
    assert!(
        proj.security.network_access_rules.is_empty(),
        "partial PUT cleared 'networkAccessRules'"
    );
    assert!(
        proj.security.allowed_terminal_commands.is_empty(),
        "partial PUT cleared 'allowedTerminalCommands'"
    );
    for (key, expected) in [
        ("meta", json!({})),
        ("autoImplementPlans", json!("InheritGeneral")),
    ] {
        assert_eq!(
            proj.extra.get(key),
            Some(&expected),
            "partial PUT cleared '{key}'"
        );
    }
}

#[tokio::test]
async fn test_project_get_exposes_unmodeled_keys() {
    let srv = start_test_server("get").await;

    let (status, body) = srv.get("/ivy-framework").await;
    assert_eq!(status, 200, "GET failed: {body}");
    assert_all_nine_extras_in_json(&body, "GET /api/projects/:name");

    let (status, list) = srv.get("").await;
    assert_eq!(status, 200, "list failed: {list}");
    let listed = list
        .as_array()
        .expect("list response is an array")
        .iter()
        .find(|p| p.get("name") == Some(&json!("ivy-framework")))
        .expect("ivy-framework in list");
    assert_all_nine_extras_in_json(listed, "GET /api/projects");
}

#[tokio::test]
async fn test_project_sub_resource_writes_preserve_unmodeled_keys() {
    // Each sub-resource write is a full `save_config` rewrite of `config.yaml`, so each one is its
    // own chance to drop the block. They run against one server in sequence, which also proves the
    // keys survive repeated writes rather than just the first.
    let srv = start_test_server("sub-resources").await;

    let cases: Vec<(&str, Value)> = vec![
        ("/ivy-framework/repos", json!({ "path": "/repos/added" })),
        (
            "/ivy-framework/verifications",
            json!({ "name": "RustBuild", "required": true }),
        ),
        (
            "/ivy-framework/review-actions",
            json!({ "name": "App", "command": "cargo run" }),
        ),
        (
            "/ivy-framework/hooks",
            json!({ "name": "Fmt", "when": "after", "promptwares": ["ExecutePlan"] }),
        ),
    ];

    for (suffix, body) in cases {
        let (status, res) = srv.send(reqwest::Method::POST, suffix, body).await;
        assert!(
            (200..300).contains(&status),
            "POST {suffix} failed ({status}): {res}"
        );
        let proj = srv.project_from_disk("ivy-framework");
        assert_all_nine_extras(&proj, &format!("after POST {suffix}"));
    }

    // The writes themselves landed, so the assertions above were made against real mutations.
    let proj = srv.project_from_disk("ivy-framework");
    assert!(proj.repos.iter().any(|r| r.path == "/repos/added"));
    assert!(proj.verifications.iter().any(|v| v.name == "RustBuild"));
    assert!(proj.review_actions.iter().any(|a| a.name == "App"));
    assert!(proj.hooks.iter().any(|h| h.name == "Fmt"));
}

/// `CreateProjectRequest`'s flattened extras: a create payload carrying the security block persists
/// it instead of dropping it on the floor.
#[tokio::test]
async fn test_create_project_persists_extra_keys() {
    let srv = start_test_server("create").await;

    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "",
            json!({
                "name": "new-project",
                "color": "Purple",
                "repos": ["/repos/new"],
                "sandboxMode": "Disabled",
                "securityPreset": "Strict",
            }),
        )
        .await;
    assert_eq!(status, 201, "create failed: {body}");

    let proj = srv.project_from_disk("new-project");
    assert_eq!(proj.color, "Purple");
    assert_eq!(proj.security.sandbox_mode, SandboxMode::Disabled);
    assert_eq!(proj.security.security_preset, SecurityPreset::Strict);

    // Creating a project rewrites the whole file, so the existing project's keys are in scope too.
    assert_all_nine_extras(
        &srv.project_from_disk("ivy-framework"),
        "after POST /api/projects",
    );
}
