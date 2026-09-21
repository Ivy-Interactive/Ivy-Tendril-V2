//! The `/api/projects` write endpoints, against the nine unmodeled project keys the .NET V1 app
//! writes into `config.yaml` (the agent security block plus `autoImplementPlans` and `meta`).
//!
//! Every case goes over real HTTP against a real router so that a handler which exists but was
//! never registered still fails these tests, and every assertion reads `config.yaml` back off disk
//! — the bug this guards against is a silent whole-file rewrite, so only the file settles it.

use reqwest::header::AUTHORIZATION;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
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

// ---------------------------------------------------------------------------
// Importing a repository by URL
//
// The write endpoints clone a remote and store the clone's path, never the URL — V1's
// `OnboardingRepoHelper.ResolveReposAsync`. These run against real git over `file://`, because the
// thing under test is what git does with a destination, and a mock would prove nothing about it.
// ---------------------------------------------------------------------------

/// A bare repo at `<root>/acme/widgets.git`, so the `<owner>/<repo>` the route derives from the URL
/// is a name the assertions can state rather than a temp-directory accident.
struct RemoteRepoFixture {
    root: PathBuf,
    origin: PathBuf,
}

impl Drop for RemoteRepoFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

impl RemoteRepoFixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-route-remote-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let origin = root.join("acme").join("widgets.git");
        let work = root.join("work");
        std::fs::create_dir_all(&origin).unwrap();
        std::fs::create_dir_all(&work).unwrap();

        let fixture = Self { root, origin };
        fixture.git_in(&fixture.origin, &["init", "--bare", "-b", "main"]);
        fixture.git_in(&work, &["init", "-b", "main"]);
        fixture.git_in(&work, &["config", "user.email", "fixture@tendril.test"]);
        fixture.git_in(&work, &["config", "user.name", "Tendril Fixture"]);
        fixture.git_in(&work, &["config", "commit.gpgsign", "false"]);
        std::fs::write(work.join("README.md"), "widgets\n").unwrap();
        fixture.git_in(&work, &["add", "."]);
        fixture.git_in(&work, &["commit", "-m", "Initial commit"]);
        let origin_url = fixture.origin.to_string_lossy().to_string();
        fixture.git_in(&work, &["remote", "add", "origin", &origin_url]);
        fixture.git_in(&work, &["push", "-u", "origin", "main"]);

        fixture
    }

    fn git_in(&self, dir: &std::path::Path, args: &[&str]) -> String {
        let (code, stdout, stderr) =
            tendril_core::git::service::run_git(args, dir).expect("run git");
        assert_eq!(code, 0, "git {args:?} failed: {stdout}{stderr}");
        stdout
    }

    /// `file://` is a real git transport, and the only one these tests can use offline.
    fn url(&self) -> String {
        format!("file://{}", self.origin.to_string_lossy())
    }
}

/// A `config.yaml` with no projects, so a create starts from an empty file.
const EMPTY_PROJECTS_CONFIG: &str = "codingAgent: claude\nprojects: []\nverifications: []\n";

#[tokio::test]
async fn create_project_clones_a_remote_and_stores_the_clone_path() {
    let remote = RemoteRepoFixture::new("create");
    let srv = start_test_server_with_config("create-remote", EMPTY_PROJECTS_CONFIG).await;
    let url = remote.url();

    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "",
            json!({ "name": "RemoteProject", "color": "Blue", "repos": [url] }),
        )
        .await;
    assert_eq!(status, 201, "create failed: {body}");

    let proj = srv.project_from_disk("RemoteProject");
    assert_eq!(proj.repos.len(), 1, "expected one repo: {:?}", proj.repos);
    let stored = PathBuf::from(&proj.repos[0].path);

    // The URL must not survive into config.yaml — that is the whole of V1's stage B.
    assert_ne!(proj.repos[0].path, url, "the URL was stored as the path");
    assert_eq!(
        stored,
        srv.tendril_home
            .join("Projects")
            .join("RemoteProject")
            .join("Repos")
            .join("acme")
            .join("widgets"),
        "the clone did not land in V1's <owner>/<repo> layout"
    );
    assert!(
        stored.join(".git").is_dir(),
        "nothing was actually cloned into {}",
        stored.display()
    );

    // The clone's HEAD supplies the base branch the caller could not know.
    assert_eq!(
        proj.repos[0].base_branch.as_deref(),
        Some("main"),
        "the default branch was not resolved from the clone"
    );

    // The response the app renders says the same thing the file does.
    assert_eq!(body["repos"][0]["path"], json!(stored.to_string_lossy()));
}

#[tokio::test]
async fn add_repo_route_clones_a_remote_and_refreshes_on_a_second_add() {
    let remote = RemoteRepoFixture::new("add");
    let srv = start_test_server_with_config("add-remote", SAMPLE_PROJECT_EXTRAS_CONFIG).await;
    let url = remote.url();

    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "/ivy-framework/repos",
            json!({ "path": url }),
        )
        .await;
    assert_eq!(status, 201, "add repo failed: {body}");

    let expected = srv
        .tendril_home
        .join("Projects")
        .join("ivy-framework")
        .join("Repos")
        .join("acme")
        .join("widgets");
    let proj = srv.project_from_disk("ivy-framework");
    let added = proj
        .repos
        .iter()
        .find(|r| r.path == expected.to_string_lossy())
        .unwrap_or_else(|| panic!("clone path missing from config.yaml: {:?}", proj.repos));
    assert_eq!(added.base_branch.as_deref(), Some("main"));
    assert!(expected.join(".git").is_dir());
    assert!(
        !proj.repos.iter().any(|r| r.path == url),
        "the URL was stored alongside the clone"
    );

    // Adding the same remote again is a refresh, not a second entry and not a conflict: V1's
    // pull-instead-of-clone is what makes re-running setup safe.
    let before = proj.repos.len();
    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "/ivy-framework/repos",
            json!({ "path": url }),
        )
        .await;
    assert_eq!(status, 200, "re-adding the same remote failed: {body}");
    assert_eq!(
        srv.project_from_disk("ivy-framework").repos.len(),
        before,
        "re-adding the same remote duplicated the repository"
    );

    // Whatever else the write touched, the unmodeled keys are still there.
    assert_all_nine_extras(
        &srv.project_from_disk("ivy-framework"),
        "after POST /repos with a URL",
    );
}

#[tokio::test]
async fn a_malformed_repo_url_is_refused_before_anything_is_written() {
    let srv = start_test_server_with_config("bad-url", SAMPLE_PROJECT_EXTRAS_CONFIG).await;

    // A URL-shaped string git has no transport for. Anything that is not URL-shaped at all is a
    // local path, which these routes still accept as typed.
    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "/ivy-framework/repos",
            json!({ "path": "ssh://" }),
        )
        .await;
    assert_eq!(status, 400, "unexpected body: {body}");
    let message = body["error"].as_str().unwrap_or_default();
    assert!(
        message.contains("not a valid git repository URL"),
        "unhelpful message: {message}"
    );
    assert!(
        !srv.project_from_disk("ivy-framework")
            .repos
            .iter()
            .any(|r| r.path == "ssh://"),
        "the malformed URL was written anyway"
    );

    // An argument git would read as an option, rather than as a remote.
    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "",
            json!({ "name": "Injected", "repos": ["--upload-pack=touch /tmp/pwned"] }),
        )
        .await;
    assert_eq!(status, 400, "unexpected body: {body}");
    assert!(
        load_config(&srv.tendril_home.join("config.yaml"))
            .expect("load config")
            .projects
            .iter()
            .all(|p| p.name != "Injected"),
        "a project was created for a URL that was never clonable"
    );
}

/// The security property, at the HTTP boundary: a remote carrying a token fails like any other
/// unreachable host, and the token is in neither the response nor anything on disk.
#[tokio::test]
async fn a_credential_bearing_url_is_redacted_in_the_response_and_never_persisted() {
    let srv = start_test_server_with_config("redaction", EMPTY_PROJECTS_CONFIG).await;
    let token = "ghp_notarealtokenbutlooksliketheshapeofone";
    let url = format!("https://tendril-user:{token}@tendril-nonexistent.invalid/acme/widgets.git");

    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "",
            json!({ "name": "LeakyProject", "color": "Blue", "repos": [url] }),
        )
        .await;
    assert_eq!(status, 502, "unexpected body: {body}");

    let rendered = body.to_string();
    assert!(
        !rendered.contains(token),
        "the token reached the response body: {rendered}"
    );
    assert!(
        !rendered.contains("tendril-user"),
        "the username reached the response body: {rendered}"
    );
    assert!(
        rendered.contains("***@tendril-nonexistent.invalid"),
        "the host was redacted away with the credentials, leaving nothing actionable: {rendered}"
    );

    // Nothing on disk carries it either — not the failed project, and not a stray line of config.
    let config_text = std::fs::read_to_string(srv.tendril_home.join("config.yaml")).unwrap();
    assert!(
        !config_text.contains(token) && !config_text.contains("tendril-user"),
        "the credential reached config.yaml: {config_text}"
    );
    assert!(
        !config_text.contains("LeakyProject"),
        "a project was written for a clone that never happened: {config_text}"
    );
}

/// Everything the create left on disk under `<TendrilHome>/Projects/<project>/Repos`, so a rollback
/// can be asserted on the tree rather than on a path the test had to guess.
fn cloned_repos_on_disk(srv: &TestServer, project: &str) -> Vec<PathBuf> {
    let repos_dir = srv
        .tendril_home
        .join("Projects")
        .join(project)
        .join("Repos");
    let mut found = Vec::new();
    let mut stack = vec![repos_dir];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if path.join(".git").exists() {
                found.push(path);
            } else {
                stack.push(path);
            }
        }
    }
    found.sort();
    found
}

#[tokio::test]
async fn a_create_that_fails_after_cloning_leaves_no_orphaned_clone() {
    // The defect: `create_project` clones before it saves, and every error return past the clone
    // walked away from whatever was already on disk. The tree at
    // `Projects/<name>/Repos/<owner>/<repo>` was then referenced by nothing, named in no config, and
    // cleaned up by nothing — while the operator, told the create failed, pressed Create Project
    // again and made a second one.
    //
    // Two repositories, the second unreachable, is the deterministic shape of it: the first clone
    // really lands, the request really fails, and the only question is whether the first clone is
    // still there afterwards.
    let remote = RemoteRepoFixture::new("rollback-create");
    let srv = start_test_server_with_config("rollback-create", EMPTY_PROJECTS_CONFIG).await;

    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "",
            json!({
                "name": "HalfCloned",
                "color": "Blue",
                "repos": [
                    remote.url(),
                    "https://tendril-nonexistent.invalid/acme/gadgets.git",
                ],
            }),
        )
        .await;
    assert_eq!(status, 502, "unexpected body: {body}");

    assert!(
        load_config(&srv.tendril_home.join("config.yaml"))
            .expect("load config")
            .projects
            .iter()
            .all(|p| p.name != "HalfCloned"),
        "a project was written for a create that failed"
    );
    let left_behind = cloned_repos_on_disk(&srv, "HalfCloned");
    assert!(
        left_behind.is_empty(),
        "the failed create left clones nothing references: {left_behind:?}"
    );
}

#[tokio::test]
async fn the_rollback_keeps_a_clone_it_only_refreshed() {
    // The other half of the rollback, and the one that makes it dangerous to get wrong: a request
    // that *refreshed* an existing clone and then failed must leave that clone exactly where it
    // was. It is the operator's working copy — it may carry branches, stashes and uncommitted work
    // — and deleting it because a later repository in the same payload was unreachable would be a
    // far worse failure than the orphan the rollback exists to prevent. Only the clones a request
    // created are its to remove.
    let remote = RemoteRepoFixture::new("rollback-refresh");
    let srv = start_test_server_with_config("rollback-refresh", SAMPLE_PROJECT_EXTRAS_CONFIG).await;
    let url = remote.url();

    // First, a clone that succeeds, so there is an existing one for the failing request to refresh.
    let (status, body) = srv
        .send(
            reqwest::Method::POST,
            "/ivy-framework/repos",
            json!({ "path": url }),
        )
        .await;
    assert_eq!(status, 201, "the setup add failed: {body}");
    let cloned = PathBuf::from(body["path"].as_str().expect("a path in the response"));
    assert!(cloned.join(".git").is_dir(), "nothing was cloned");
    // A file the refresh will not touch and the rollback must not take with it.
    std::fs::write(cloned.join("uncommitted.txt"), "the operator's work\n").expect("write");

    // Now a PUT naming that same remote plus an unreachable one. The first resolves to the clone
    // above and is refreshed; the second fails and rolls the request back.
    let (status, body) = srv
        .send(
            reqwest::Method::PUT,
            "/ivy-framework",
            json!({ "repos": [url, "https://tendril-nonexistent.invalid/acme/gadgets.git"] }),
        )
        .await;
    assert_eq!(status, 502, "unexpected body: {body}");

    assert!(
        cloned.join(".git").is_dir(),
        "the rollback deleted a clone it had only refreshed: {}",
        cloned.display()
    );
    assert!(
        cloned.join("uncommitted.txt").is_file(),
        "the rollback destroyed uncommitted work in a pre-existing clone"
    );
    // And the failed PUT changed nothing in config.yaml either.
    let proj = srv.project_from_disk("ivy-framework");
    assert!(
        proj.repos.iter().any(|r| Path::new(&r.path) == cloned),
        "the successful add was rolled back by the failed PUT: {:?}",
        proj.repos
    );
}

/// A rename still answers 200 when a plan cannot be rewritten, and renames the ones it can.
///
/// The cascade runs after `save_config`, so the rename itself has already happened and 200 is the
/// honest status — but the plans left behind are unrecoverable by retry (a second rename finds the
/// old name gone and sweeps nothing). What this pins is that one blocked plan no longer costs the
/// others their rename, and that the route reports success rather than a 500 for work that did
/// land.
///
/// Unix-only for the same reason as the `tendril-core` sweep test: the failure is injected with a
/// read-only directory.
#[cfg(unix)]
#[tokio::test]
async fn a_rename_renames_every_plan_it_can_even_when_one_is_unwritable() {
    use std::os::unix::fs::PermissionsExt;

    let srv = start_test_server("rename-partial").await;
    let plans_dir = srv.tendril_home.join("Plans");

    // Two plans on the project being renamed. Written directly rather than through the plan API so
    // this test depends on nothing but the rename cascade.
    let write_plan = |folder: &str, id: &str| {
        let dir = plans_dir.join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("plan.yaml"),
            format!(
                "id: '{id}'\ntitle: {folder}\nproject: ivy-framework\nstatus: Draft\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n"
            ),
        )
        .unwrap();
        dir
    };
    write_plan("00001-Alpha", "00001");
    write_plan("00002-Beta", "00002");
    write_plan("00003-Gamma", "00003");

    // Whichever plan the sweep reaches *first* is the one made unwritable, so the fail-fast
    // version this guards against aborts before it can rename any of the others. Picked from a
    // real `read_dir` rather than by name, because directory order is a hash order on both APFS
    // and ext4 and is not the lexical order the folder names suggest.
    let order: Vec<PathBuf> = std::fs::read_dir(&plans_dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    let (blocked, rest) = order.split_first().unwrap();
    let blocked = blocked.clone();
    let rest: Vec<PathBuf> = rest.to_vec();

    let original_mode = std::fs::metadata(&blocked).unwrap().permissions().mode();
    std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o500)).unwrap();

    let (status, _body) = srv
        .send(
            reqwest::Method::PUT,
            "/ivy-framework",
            json!({ "newName": "ivy-renamed" }),
        )
        .await;

    std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(original_mode)).unwrap();

    assert_eq!(
        status, 200,
        "the rename itself succeeded, so a blocked plan must not turn it into an error"
    );

    // config.yaml carries the new name...
    let settings = load_config(&srv.tendril_home.join("config.yaml")).unwrap();
    assert!(settings.projects.iter().any(|p| p.name == "ivy-renamed"));

    // ...and so does every plan after the blocked one, which is what the fail-fast sweep lost.
    for folder in &rest {
        let renamed = std::fs::read_to_string(folder.join("plan.yaml")).unwrap();
        assert!(
            renamed.contains("ivy-renamed"),
            "plan {} should have been renamed despite the blocked one, got: {renamed}",
            folder.display()
        );
    }

    let untouched = std::fs::read_to_string(blocked.join("plan.yaml")).unwrap();
    assert!(
        untouched.contains("ivy-framework"),
        "the blocked plan is expected to still name the old project"
    );
}

#[tokio::test]
async fn a_put_that_clones_keeps_what_another_writer_added_meanwhile() {
    // The lost update: the PUT loaded `config.yaml`, mutated the copy, awaited a clone that can run
    // for minutes, then saved the whole object — so anything written to the file in between was
    // erased. That window is not hypothetical: the `AddProject` setup agent writes verifications and
    // review actions through the `tendril` CLI, which writes `config.yaml` directly, and a project
    // edited in the app while one ran lost every one of them.
    //
    // `create_project` and `add_project_repo` re-read after the clone for exactly this reason; this
    // asserts the PUT now does too, by writing the file behind its back before it saves and then
    // checking the write survived.
    let remote = RemoteRepoFixture::new("put-reread");
    let srv = start_test_server_with_config("put-reread", SAMPLE_PROJECT_EXTRAS_CONFIG).await;
    let config_path = srv.tendril_home.join("config.yaml");

    // What the concurrent writer puts in the file, on a field this PUT does not name.
    let mut settings = load_config(&config_path).expect("load config");
    let idx = settings
        .projects
        .iter()
        .position(|p| p.name == "ivy-framework")
        .expect("the sample project");
    settings.projects[idx].context = "written by the setup agent".to_string();
    tendril_core::config::save_config(&config_path, &settings).expect("save config");

    // A PUT that names only the colour and the repositories. It was loaded before the write above
    // only in the sense that matters — the handler re-reads before it saves, so the write stands.
    let (status, body) = srv
        .send(
            reqwest::Method::PUT,
            "/ivy-framework",
            json!({ "color": "Red", "repos": [remote.url()] }),
        )
        .await;
    assert_eq!(status, 200, "unexpected body: {body}");

    let proj = srv.project_from_disk("ivy-framework");
    assert_eq!(proj.color, "Red", "the PUT's own field was not applied");
    assert_eq!(
        proj.context, "written by the setup agent",
        "the PUT erased a field it never named"
    );
    assert_eq!(proj.repos.len(), 1, "unexpected repos: {:?}", proj.repos);
    assert_ne!(
        proj.repos[0].path,
        remote.url(),
        "the URL was stored instead of the clone path"
    );
    assert!(
        PathBuf::from(&proj.repos[0].path).join(".git").is_dir(),
        "the PUT stored a path with no clone at it"
    );
}

/// A relative repo path is refused by every write route, rather than being stored.
///
/// The reported symptom was a project that "ended up in git/ivy instead of the tendril folder".
/// Nothing had cloned anything there: the stored path was relative, and every consumer resolves a
/// stored path with `is_dir()`, which resolves against the *daemon's* working directory. The daemon
/// in that report was started from a checkout, so a stored `..` named that checkout's parent --
/// `/Users/.../git/ivy` -- and jobs then ran in a tree the operator never picked. An absolute path
/// cannot drift that way, and a remote URL is cloned into `Projects/<name>/Repos/<owner>/<repo>`,
/// so refusing the relative case is what makes the stored path mean one directory.
///
/// All three write routes are covered because each one is a separate way into `config.yaml`, and
/// only `materialize_repos` is shared between them.
#[tokio::test]
async fn a_relative_repo_path_is_refused_by_every_write_route() {
    let srv = start_test_server("relative-repo").await;

    for relative in ["..", "../Ivy-Tendril-V2", "src", "./repo"] {
        let (status, body) = srv
            .send(
                reqwest::Method::POST,
                "",
                json!({ "name": "relcreate", "repos": [relative] }),
            )
            .await;
        assert_eq!(status, 400, "POST accepted '{relative}': {body}");

        let (status, body) = srv
            .send(
                reqwest::Method::PUT,
                "/ivy-framework",
                json!({ "repos": [relative] }),
            )
            .await;
        assert_eq!(status, 400, "PUT accepted '{relative}': {body}");

        let (status, body) = srv
            .send(
                reqwest::Method::POST,
                "/ivy-framework/repos",
                json!({ "path": relative }),
            )
            .await;
        assert_eq!(status, 400, "add-repo accepted '{relative}': {body}");
    }

    // The refusals are refusals, not partial writes: the fixture project still has exactly the one
    // absolute repo it started with, and the create never registered a project at all.
    let proj = srv.project_from_disk("ivy-framework");
    assert_eq!(
        proj.repos.len(),
        1,
        "a refused write still changed repos: {:?}",
        proj.repos
    );
    assert_eq!(proj.repos[0].path, "/repos/ivy-framework");

    let settings = load_config(&srv.tendril_home.join("config.yaml")).expect("load config");
    assert!(
        !settings
            .projects
            .iter()
            .any(|p| p.name.eq_ignore_ascii_case("relcreate")),
        "a refused create still registered the project"
    );
}

/// The shapes the guard above must *not* catch, so it cannot be tightened into refusing the paths
/// V1's `RepoPathValidator.IsLocalPath` accepts. `%TENDRIL_HOME%` is expanded before the check for
/// exactly this reason -- it is relative as written and absolute once expanded, which is how the
/// skills entries in a real `config.yaml` are spelled.
#[tokio::test]
async fn an_absolute_or_expandable_repo_path_is_still_accepted() {
    let srv = start_test_server("absolute-repo").await;

    let expandable = "%TENDRIL_HOME%/Projects/ivy-framework/Repos/o/r";
    let (status, body) = srv
        .send(
            reqwest::Method::PUT,
            "/ivy-framework",
            json!({ "repos": ["/repos/ivy-framework", expandable] }),
        )
        .await;
    assert_eq!(status, 200, "PUT refused an absolute path set: {body}");

    let proj = srv.project_from_disk("ivy-framework");
    assert_eq!(proj.repos.len(), 2, "unexpected repos: {:?}", proj.repos);
    assert_eq!(
        proj.repos[1].path, expandable,
        "the expandable path was rewritten rather than stored as written"
    );
}
