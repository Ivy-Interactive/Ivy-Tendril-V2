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
    start_test_server_with_config(tag, SAMPLE_PROJECT_EXTRAS_CONFIG).await
}

/// As [`start_test_server`], with a caller-supplied `config.yaml` — the sync tests need a project
/// whose repo path points at a real git repository in a temp directory.
async fn start_test_server_with_config(tag: &str, config: &str) -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-project-routes-test-{tag}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();
    std::fs::write(tendril_home.join("config.yaml"), config).unwrap();

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

// ---------------------------------------------------------------------------
// POST /api/projects/:name/sync
//
// The escalation surface for a repository that cannot be fast-forwarded. These go against real git
// repositories in temp directories, because a diverged branch is a fact about git and a mock would
// prove nothing about it.
// ---------------------------------------------------------------------------

/// A repo with a bare `origin` beside it, removed on drop.
struct SyncGitFixture {
    root: PathBuf,
    repo: PathBuf,
}

impl Drop for SyncGitFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

impl SyncGitFixture {
    /// A repo one commit behind its origin. `local_commits` commits on top of the rewound branch
    /// make the histories diverge; zero leaves it plainly fast-forwardable.
    fn new(label: &str, local_commits: usize) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-route-sync-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repo = root.join(label);
        let origin = root.join("origin.git");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::create_dir_all(&origin).unwrap();

        let fixture = Self { root, repo };
        fixture.git_in(&origin, &["init", "--bare", "-b", "main"]);
        fixture.git(&["init", "-b", "main"]);
        fixture.git(&["config", "user.email", "fixture@tendril.test"]);
        fixture.git(&["config", "user.name", "Tendril Fixture"]);
        fixture.git(&["config", "commit.gpgsign", "false"]);
        std::fs::write(fixture.repo.join("README.md"), "fixture\n").unwrap();
        fixture.git(&["add", "."]);
        fixture.git(&["commit", "-m", "Initial commit"]);
        let origin_url = origin.to_string_lossy().to_string();
        fixture.git(&["remote", "add", "origin", &origin_url]);
        fixture.git(&["push", "-u", "origin", "main"]);

        std::fs::write(fixture.repo.join("ahead.txt"), "ahead\n").unwrap();
        fixture.git(&["add", "ahead.txt"]);
        fixture.git(&["commit", "-m", "Commit only origin has"]);
        fixture.git(&["push", "origin", "main"]);
        fixture.git(&["reset", "--hard", "HEAD~1"]);

        for i in 0..local_commits {
            let file = format!("local-{i}.txt");
            std::fs::write(fixture.repo.join(&file), "local\n").unwrap();
            fixture.git(&["add", &file]);
            fixture.git(&["commit", "-m", &format!("Local-only commit {i}")]);
        }

        fixture
    }

    fn git(&self, args: &[&str]) -> String {
        let repo = self.repo.clone();
        self.git_in(&repo, args)
    }

    fn git_in(&self, dir: &std::path::Path, args: &[&str]) -> String {
        let (code, stdout, stderr) =
            tendril_core::git::service::run_git(args, dir).expect("run git");
        assert_eq!(code, 0, "git {args:?} failed: {stdout}{stderr}");
        stdout
    }

    fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"]).trim().to_string()
    }

    /// A `config.yaml` whose single project points at this fixture's repo.
    fn config(&self) -> String {
        format!(
            "codingAgent: claude\nprojects:\n  - name: SyncProject\n    color: Blue\n    repos:\n      - path: {}\n        baseBranch: main\nverifications: []\n",
            self.repo.to_string_lossy()
        )
    }
}

#[tokio::test]
async fn sync_route_fast_forwards_a_repo_that_is_merely_behind() {
    let fixture = SyncGitFixture::new("behind", 0);
    let srv = start_test_server_with_config("sync-behind", &fixture.config()).await;
    let before = fixture.head();

    let (status, body) = srv
        .send(reqwest::Method::POST, "/SyncProject/sync", json!({}))
        .await;

    assert_eq!(status, 200, "sync failed: {body}");
    assert_eq!(body["success"], json!(true));
    assert_eq!(body["failed"], json!(0));
    let results = body["results"].as_array().expect("results array");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["success"], json!(true));
    assert_eq!(
        results[0]["message"],
        json!("Fast-forwarded main to origin/main.")
    );
    assert_eq!(results[0]["diverged"], json!(false));
    assert!(results[0]["diagnosticPrompt"].is_null());
    assert_ne!(fixture.head(), before, "HEAD did not advance");
}

#[tokio::test]
async fn sync_route_reports_a_divergence_and_hands_back_the_escalation() {
    let fixture = SyncGitFixture::new("diverged", 2);
    let srv = start_test_server_with_config("sync-diverged", &fixture.config()).await;
    let before = fixture.head();

    let (status, body) = srv
        .send(reqwest::Method::POST, "/SyncProject/sync", json!({}))
        .await;

    // A repo that could not be synced is reported in the body, not as an HTTP error: the caller
    // asked about every repo and a 5xx would discard the results for the ones that worked.
    assert_eq!(status, 200, "sync should still answer: {body}");
    assert_eq!(body["success"], json!(false));
    assert_eq!(body["failed"], json!(1));

    let result = &body["results"][0];
    assert_eq!(result["success"], json!(false));
    assert_eq!(
        result["message"],
        json!("Fast-forward merge failed for origin/main")
    );
    assert_eq!(result["canFixWithAgent"], json!(true));
    assert_eq!(result["diverged"], json!(true));
    assert_eq!(result["ahead"], json!(2));
    assert_eq!(result["behind"], json!(1));

    let prompt = result["diagnosticPrompt"]
        .as_str()
        .expect("a diverged repo must carry a diagnostic prompt");
    assert!(
        prompt.contains("could not be safely synchronized")
            && prompt.contains("without losing any work")
            && prompt.contains("Do NOT force-push")
            && prompt.contains("do NOT `reset --hard`"),
        "prompt is not the escalation contract: {prompt}"
    );

    // The route resolved nothing. That is the whole design: it describes the divergence and stops.
    assert_eq!(
        fixture.head(),
        before,
        "the route moved HEAD on a divergence"
    );
    assert!(
        fixture.git(&["status", "--porcelain"]).trim().is_empty(),
        "the route left the working tree dirty"
    );
    assert!(
        fixture.git(&["stash", "list"]).trim().is_empty(),
        "the route stashed the operator's work"
    );
}

#[tokio::test]
async fn sync_route_404s_an_unknown_project_and_reports_an_empty_one() {
    let fixture = SyncGitFixture::new("empty", 0);
    // `SyncProject` plus a repo-less second project, so both "nothing to do" shapes are reachable.
    let config = format!(
        "codingAgent: claude\nprojects:\n  - name: SyncProject\n    color: Blue\n    repos:\n      - path: {}\n        baseBranch: main\n  - name: NoRepos\n    color: Green\n    repos: []\nverifications: []\n",
        fixture.repo.to_string_lossy()
    );
    let srv = start_test_server_with_config("sync-empty", &config).await;

    let (status, body) = srv
        .send(reqwest::Method::POST, "/NoSuchProject/sync", json!({}))
        .await;
    assert_eq!(status, 404, "unexpected body: {body}");

    // A project with no repos is nothing to do, not a failure.
    let (status, body) = srv
        .send(reqwest::Method::POST, "/NoRepos/sync", json!({}))
        .await;
    assert_eq!(status, 200, "unexpected body: {body}");
    assert_eq!(body["success"], json!(true));
    assert_eq!(body["total"], json!(0));
    assert_eq!(body["message"], json!("No repositories found in project."));

    // An unmatched `repo` filter selects nothing, reported the same way rather than as an error.
    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "/SyncProject/sync?repo=no-such-repo",
            json!({}),
        )
        .await;
    assert_eq!(status, 200, "unexpected body: {body}");
    assert_eq!(body["success"], json!(true));
    assert_eq!(
        body["message"],
        json!("No matching repositories found to sync.")
    );
}
