//! Coverage for the Tauri command layer itself, not just the HTTP client
//! underneath it.
//!
//! These tests call the `cmd_*` functions the webview invokes, against a mock
//! daemon and a `TempDir`-backed `TENDRIL_HOME`, and assert three things the
//! views depend on:
//!
//! * a failure arrives as a structured `BridgeError` with a stable `code`, not
//!   a formatted string the frontend would have to pattern-match;
//! * the bearer secret is sent to the daemon but never appears in anything a
//!   command returns;
//! * verification reports and recommendations are read from where they
//!   actually live.
//!
//! Commands resolve `TENDRIL_HOME` from the process environment, which is
//! global, so every test takes `env_lock()` for its duration.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, put},
    Json, Router,
};
use serde_json::json;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use tempfile::TempDir;
use tendril_app_lib::commands::plans::{
    cmd_get_plan, cmd_get_plan_artifact_content, cmd_get_plan_artifacts, cmd_get_plan_summary,
    cmd_get_verification_report, cmd_list_recommendations, cmd_list_verification_reports,
    cmd_set_recommendation_state, cmd_set_verification_status,
};
use tendril_app_lib::commands::{
    cmd_check_service_health, cmd_get_service_info, get_daemon_status,
};
use tendril_app_lib::daemon::MasterInfo;
use tendril_app_lib::models::PlanArtifactContentDto;
use tokio::net::TcpListener;

const SECRET: &str = "commands-bridge-test-secret";

/// The one artifact the mock daemon's content route serves. The `#` and the space are there on
/// purpose: unencoded, the `#` would end the query and the daemon would see a truncated path.
const DAEMON_SERVED_ARTIFACT: &str = "run #2 results.json";

/// Guards the process-global `TENDRIL_HOME`. Async-aware, because it is held
/// across every command call a test makes.
async fn env_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

/// What the mock daemon saw, so a test can assert on the request the command
/// actually made rather than only on the value it returned.
#[derive(Debug, Default)]
struct Observed {
    authorized_requests: usize,
    recommendation_calls: Vec<(String, String, serde_json::Value)>,
    verification_calls: Vec<(String, String, serde_json::Value)>,
    /// The `path` each artifact-content request carried, as the daemon decoded it.
    artifact_content_paths: Vec<String>,
}

type Shared = Arc<Mutex<Observed>>;

struct MockDaemon {
    addr: SocketAddr,
    observed: Shared,
    _server: tokio::task::JoinHandle<()>,
}

impl MockDaemon {
    fn observed(&self) -> MutexGuard<'_, Observed> {
        self.observed.lock().expect("observed lock")
    }
}

fn is_authorized(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == format!("Bearer {SECRET}"))
        .unwrap_or(false)
}

/// A daemon that serves one plan (`00021`) whose `folder_path` points at
/// `plan_folder`, and that rejects recommendation writes unless
/// `accept_recommendations` is set — mirroring a service that has not shipped
/// the route yet.
///
/// Its artifact-content route answers only for a file named
/// [`DAEMON_SERVED_ARTIFACT`], with text no file on disk holds; for anything
/// else it 404s like a daemon that predates the route, so the command's disk
/// fallback is what answers.
async fn spawn_mock_daemon(plan_folder: PathBuf, accept_recommendations: bool) -> MockDaemon {
    let observed: Shared = Arc::new(Mutex::new(Observed::default()));

    let plan_body = move || {
        json!({
            "metadata": {
                "id": 21,
                "title": "Build Desktop Operator Experience",
                "state": "Review",
                "project": "Tendril-App",
                "level": "Feature",
                "repos": ["/repos/Tendril-App"],
                "verifications": [
                    { "name": "RustClippy", "status": "Pass" },
                    { "name": "RustTest", "status": "Fail" },
                    { "name": "CheckResult", "status": "Pending" }
                ]
            },
            "latest_revision_content": "# Plan\n",
            "folder_path": plan_folder.to_string_lossy(),
            "revision_count": 4,
            "yaml_raw": "state: Review\npriority: 15\nexecutionProfile: deep\nrecommendations:\n  - title: Tauri WebDriver E2E Automation\n    description: Add WebDriver smoke tests.\n    state: Pending\n    impact: Medium\n  - title: Deep Link Protocol Handler\n    description: Register tendril:// links.\n    state: Declined\n    declineReason: Not now\n    impact: Small\n"
        })
    };

    let app = Router::new()
        .route("/api/ping", get(|| async { "pong" }))
        .route(
            "/api/health",
            get(
                |State(state): State<Shared>, headers: HeaderMap| async move {
                    if !is_authorized(&headers) {
                        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "no" })));
                    }
                    state.lock().expect("lock").authorized_requests += 1;
                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": "healthy",
                            "apiVersion": 1,
                            "capabilities": ["plans", "jobs"]
                        })),
                    )
                },
            ),
        )
        .route(
            "/api/plans/{id}",
            get(
                move |State(state): State<Shared>, headers: HeaderMap, Path(id): Path<String>| {
                    let plan_body = plan_body.clone();
                    async move {
                        if !is_authorized(&headers) {
                            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "no" })));
                        }
                        state.lock().expect("lock").authorized_requests += 1;
                        if id == "00021" {
                            (StatusCode::OK, Json(plan_body()))
                        } else {
                            (
                                StatusCode::NOT_FOUND,
                                Json(json!({ "error": "plan not found" })),
                            )
                        }
                    }
                },
            ),
        )
        .route(
            "/api/plans/{id}/recommendations/{title}",
            put(
                move |State(state): State<Shared>,
                      headers: HeaderMap,
                      Path((id, title)): Path<(String, String)>,
                      Json(body): Json<serde_json::Value>| async move {
                    if !is_authorized(&headers) {
                        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "no" })));
                    }
                    {
                        let mut observed = state.lock().expect("lock");
                        observed.authorized_requests += 1;
                        observed.recommendation_calls.push((id, title, body));
                    }
                    if accept_recommendations {
                        (StatusCode::OK, Json(json!({ "message": "updated" })))
                    } else {
                        (
                            StatusCode::NOT_FOUND,
                            Json(json!({ "error": "no route for recommendation updates" })),
                        )
                    }
                },
            ),
        )
        .route(
            "/api/plans/{id}/verifications/{name}",
            put(
                move |State(state): State<Shared>,
                      headers: HeaderMap,
                      Path((id, name)): Path<(String, String)>,
                      Json(body): Json<serde_json::Value>| async move {
                    if !is_authorized(&headers) {
                        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "no" })));
                    }
                    {
                        let mut observed = state.lock().expect("lock");
                        observed.authorized_requests += 1;
                        observed.verification_calls.push((id, name, body));
                    }
                    if accept_recommendations {
                        (StatusCode::OK, Json(json!({ "message": "updated" })))
                    } else {
                        (
                            StatusCode::NOT_FOUND,
                            Json(json!({ "error": "no route for verification updates" })),
                        )
                    }
                },
            ),
        )
        .route(
            "/api/plans/{id}/artifacts/content",
            get(
                |State(state): State<Shared>,
                 headers: HeaderMap,
                 Path(id): Path<String>,
                 Query(query): Query<HashMap<String, String>>| async move {
                    if !is_authorized(&headers) {
                        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "no" })));
                    }
                    let path = query.get("path").cloned().unwrap_or_default();
                    {
                        let mut observed = state.lock().expect("lock");
                        observed.authorized_requests += 1;
                        observed.artifact_content_paths.push(path.clone());
                    }
                    if id == "00021" && path.ends_with(DAEMON_SERVED_ARTIFACT) {
                        (
                            StatusCode::OK,
                            Json(json!({ "kind": "text", "text": "from the daemon", "size": 15 })),
                        )
                    } else {
                        (
                            StatusCode::NOT_FOUND,
                            Json(json!({ "error": "no such route" })),
                        )
                    }
                },
            ),
        )
        .with_state(observed.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("local addr");
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    MockDaemon {
        addr,
        observed,
        _server: server,
    }
}

fn write_master(home: &std::path::Path, port: u16) {
    let master = MasterInfo {
        port,
        pid: std::process::id(),
        secret: SECRET.to_string(),
        started_at: "2026-09-07T10:41:11Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec!["plans".to_string(), "jobs".to_string()],
    };
    std::fs::write(
        home.join(".master"),
        serde_json::to_string_pretty(&master).expect("serialize master"),
    )
    .expect("write master");
}

/// An isolated `TENDRIL_HOME` with a plan folder holding two verification
/// reports (`RustClippy` passed, `RustTest` failed) and none for `CheckResult`.
fn seed_plan_folder(home: &std::path::Path) -> PathBuf {
    let plan_folder = home.join("Plans/00021-BuildDesktopOperatorExperience");
    let verification_dir = plan_folder.join("Verification");
    std::fs::create_dir_all(&verification_dir).expect("create verification dir");

    std::fs::write(
        verification_dir.join("RustClippy.md"),
        "---\nresult: Pass\ndate: 2026-09-07T10:20:00Z\n---\n# RustClippy\n\nNo warnings.\n",
    )
    .expect("write clippy report");
    std::fs::write(
        verification_dir.join("RustTest.md"),
        "---\nresult: Fail\ndate: 2026-09-07T10:41:11Z\n---\n# RustTest\n\n2 tests failed: dto_mapping, revision_diff\n",
    )
    .expect("write test report");

    plan_folder
}

/// Sets `TENDRIL_HOME` to an isolated temp dir with a `.master` pointing at a
/// mock daemon. The `TempDir` is returned so it outlives the test body.
async fn isolated_env(accept_recommendations: bool) -> (TempDir, PathBuf, MockDaemon) {
    let temp = tempfile::tempdir().expect("tempdir");
    let home = temp.path().to_path_buf();
    let plan_folder = seed_plan_folder(&home);
    let daemon = spawn_mock_daemon(plan_folder.clone(), accept_recommendations).await;

    write_master(&home, daemon.addr.port());
    std::env::set_var("TENDRIL_HOME", &home);

    (temp, plan_folder, daemon)
}

#[tokio::test]
async fn missing_master_file_is_a_disconnected_bridge_error() {
    let _guard = env_lock().await;
    let temp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("TENDRIL_HOME", temp.path());

    let err = cmd_get_plan("00021".to_string())
        .await
        .expect_err("no daemon metadata, so the command must fail");

    // The frontend branches on `code`; the message is for the operator.
    assert_eq!(err.code, "DISCONNECTED");
    assert!(err.message.contains(".master"), "message: {}", err.message);
    assert!(err.details.is_some(), "the underlying reason is preserved");

    let err = cmd_list_recommendations("00021".to_string())
        .await
        .expect_err("recommendations need the daemon too");
    assert_eq!(err.code, "DISCONNECTED");

    let err = cmd_check_service_health()
        .await
        .expect_err("health needs .master");
    assert_eq!(err.code, "DISCONNECTED");
}

#[tokio::test]
async fn a_bridge_error_serializes_as_a_structured_payload() {
    let _guard = env_lock().await;
    let temp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("TENDRIL_HOME", temp.path());

    let err = cmd_get_plan("00021".to_string())
        .await
        .expect_err("must fail without a daemon");
    let json = serde_json::to_value(&err).expect("serialize BridgeError");

    // This is the shape `isBridgeError` in src/types/api.ts tests for.
    assert!(json.get("code").and_then(|v| v.as_str()).is_some());
    assert!(json.get("message").and_then(|v| v.as_str()).is_some());
    assert!(json.get("details").is_some());
}

#[tokio::test]
async fn an_unknown_plan_is_not_found_rather_than_a_generic_failure() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(true).await;

    let err = cmd_get_plan("09999".to_string())
        .await
        .expect_err("the daemon has no such plan");

    assert_eq!(err.code, "NOT_FOUND");
    assert!(err.message.contains("09999"), "message: {}", err.message);
    assert_eq!(daemon.observed().authorized_requests, 1);
}

#[tokio::test]
async fn plan_detail_reaches_the_command_layer_with_revision_count_and_recommendations() {
    let _guard = env_lock().await;
    let (_temp, plan_folder, _daemon) = isolated_env(true).await;

    let plan = cmd_get_plan("00021".to_string())
        .await
        .expect("plan detail must load");

    assert_eq!(plan.id, "00021");
    assert_eq!(plan.revision_count, 4);
    assert_eq!(plan.recommendations.len(), 2);
    assert_eq!(plan.priority, Some(15));
    assert_eq!(plan.execution_profile.as_deref(), Some("deep"));
    assert_eq!(
        plan.folder_path.as_deref(),
        Some(plan_folder.to_string_lossy().as_ref())
    );
}

#[tokio::test]
async fn nothing_a_plan_command_returns_carries_the_bearer_secret() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(true).await;

    let plan = cmd_get_plan("00021".to_string()).await.expect("plan");
    let info = cmd_get_service_info().await.expect("service info");
    let status = get_daemon_status().await.expect("daemon status");
    let health = cmd_check_service_health().await.expect("health");

    // The secret did reach the daemon...
    assert!(
        daemon.observed().authorized_requests >= 2,
        "requests must be authenticated"
    );

    // ...but not the webview, for any of the payloads it can ask for.
    for payload in [
        serde_json::to_string(&plan).expect("plan json"),
        serde_json::to_string(&info).expect("info json"),
        serde_json::to_string(&status).expect("status json"),
        serde_json::to_string(&health).expect("health json"),
    ] {
        assert!(
            !payload.contains(SECRET),
            "a command leaked the bearer secret: {payload}"
        );
        assert!(
            !payload.contains("secret"),
            "a command exposed a secret field: {payload}"
        );
    }
}

#[tokio::test]
async fn verification_reports_are_read_from_the_plans_folder_on_disk() {
    let _guard = env_lock().await;
    let (_temp, _folder, _daemon) = isolated_env(true).await;

    let reports = cmd_list_verification_reports("00021".to_string())
        .await
        .expect("reports must load");

    // CheckResult has not run, so it has no report file and is simply absent.
    assert_eq!(reports.len(), 2);
    let clippy = &reports[0];
    assert_eq!(clippy.name, "RustClippy");
    assert_eq!(clippy.result.as_deref(), Some("Pass"));

    let rust_test = &reports[1];
    assert_eq!(rust_test.name, "RustTest");
    assert_eq!(rust_test.result.as_deref(), Some("Fail"));
    assert_eq!(rust_test.date.as_deref(), Some("2026-09-07T10:41:11Z"));
    assert!(rust_test.content.contains("2 tests failed"));
}

#[tokio::test]
async fn a_single_verification_report_can_be_fetched_by_name() {
    let _guard = env_lock().await;
    let (_temp, _folder, _daemon) = isolated_env(true).await;

    let report = cmd_get_verification_report("00021".to_string(), "RustTest".to_string())
        .await
        .expect("RustTest report exists");
    assert_eq!(report.result.as_deref(), Some("Fail"));

    let err = cmd_get_verification_report("00021".to_string(), "CheckResult".to_string())
        .await
        .expect_err("CheckResult has not run");
    assert_eq!(err.code, "NOT_FOUND");
}

#[tokio::test]
async fn plan_summary_falls_back_to_disk_when_daemon_has_no_summary_route() {
    let _guard = env_lock().await;
    let (_temp, folder, _daemon) = isolated_env(true).await;

    // Seed summary.md in Artifacts
    let artifacts_dir = folder.join("Artifacts");
    std::fs::create_dir_all(&artifacts_dir).expect("artifacts dir");
    std::fs::write(
        artifacts_dir.join("summary.md"),
        "# Plan Summary\n\nImplemented desktop operator.",
    )
    .expect("write summary");

    let summary = cmd_get_plan_summary("00021".to_string())
        .await
        .expect("summary command should succeed");
    assert_eq!(
        summary.as_deref(),
        Some("# Plan Summary\n\nImplemented desktop operator.")
    );
}

#[tokio::test]
async fn plan_artifacts_fall_back_to_disk_when_daemon_has_no_artifacts_route() {
    let _guard = env_lock().await;
    let (_temp, folder, _daemon) = isolated_env(true).await;

    let artifacts_dir = folder.join("Artifacts");
    std::fs::create_dir_all(&artifacts_dir).expect("artifacts dir");
    std::fs::write(artifacts_dir.join("screenshot.png"), "png").expect("write png");
    std::fs::write(artifacts_dir.join("log.txt"), "log").expect("write txt");

    let artifacts = cmd_get_plan_artifacts("00021".to_string())
        .await
        .expect("artifacts command should succeed");
    assert_eq!(artifacts.screenshots.len(), 1);
    assert!(artifacts.screenshots[0].ends_with("screenshot.png"));
    assert_eq!(artifacts.other.len(), 1);
    assert!(artifacts.other[0].ends_with("log.txt"));
}

/// The artifact sheet's read, by the path the listing above hands out. The mock daemon 404s the
/// content route for this file, which is exactly a daemon that predates it, so this is the disk read.
#[tokio::test]
async fn plan_artifact_content_falls_back_to_disk_when_daemon_has_no_content_route() {
    let _guard = env_lock().await;
    let (_temp, folder, _daemon) = isolated_env(true).await;

    let artifacts_dir = folder.join("Artifacts");
    std::fs::create_dir_all(&artifacts_dir).expect("artifacts dir");
    std::fs::write(artifacts_dir.join("log.txt"), "build ok\n").expect("write txt");

    let listed = cmd_get_plan_artifacts("00021".to_string())
        .await
        .expect("artifacts command should succeed");
    let content = cmd_get_plan_artifact_content("00021".to_string(), listed.other[0].clone())
        .await
        .expect("a listed artifact is readable");

    assert_eq!(
        content,
        PlanArtifactContentDto::Text {
            text: "build ok\n".to_string(),
            size: 9,
        }
    );
}

/// With a daemon that has the route, its answer is the one returned — decoded into the `kind`-tagged
/// DTO, for a path that only survives if the client encodes the query. The command swallows a
/// daemon failure and falls back to disk, so without this a mismatch in either would pass unnoticed
/// whenever the app and the daemon share a `TENDRIL_HOME`.
#[tokio::test]
async fn plan_artifact_content_asks_the_daemon_first() {
    let _guard = env_lock().await;
    let (_temp, folder, daemon) = isolated_env(true).await;

    let artifacts_dir = folder.join("Artifacts");
    std::fs::create_dir_all(&artifacts_dir).expect("artifacts dir");
    let path = artifacts_dir.join(DAEMON_SERVED_ARTIFACT);
    std::fs::write(&path, "from the disk").expect("write artifact");
    let path = path.to_string_lossy().to_string();

    let content = cmd_get_plan_artifact_content("00021".to_string(), path.clone())
        .await
        .expect("the daemon serves this artifact");

    assert_eq!(
        content,
        PlanArtifactContentDto::Text {
            text: "from the daemon".to_string(),
            size: 15,
        }
    );
    assert_eq!(daemon.observed().artifact_content_paths, vec![path]);
}

/// The fallback is the same read as the daemon's, refusals included: a file beside `Artifacts/`
/// is not an artifact, and a missing one is `NOT_FOUND` rather than an I/O error.
#[tokio::test]
async fn plan_artifact_content_refuses_a_path_outside_the_artifacts_folder() {
    let _guard = env_lock().await;
    let (_temp, folder, _daemon) = isolated_env(true).await;
    std::fs::create_dir_all(folder.join("Artifacts")).expect("artifacts dir");

    let report = folder.join("Verification").join("RustTest.md");
    let err =
        cmd_get_plan_artifact_content("00021".to_string(), report.to_string_lossy().to_string())
            .await
            .expect_err("a verification report is not an artifact");
    assert_eq!(err.code, "VALIDATION_ERROR");

    let missing = folder.join("Artifacts").join("gone.txt");
    let err =
        cmd_get_plan_artifact_content("00021".to_string(), missing.to_string_lossy().to_string())
            .await
            .expect_err("no such artifact");
    assert_eq!(err.code, "NOT_FOUND");
}

#[tokio::test]
async fn a_verification_name_cannot_escape_the_verification_directory() {
    let _guard = env_lock().await;
    let (_temp, _folder, _daemon) = isolated_env(true).await;

    for name in ["../../.master", "..", "sub/dir", ""] {
        let err = cmd_get_verification_report("00021".to_string(), name.to_string())
            .await
            .expect_err("a traversing name must be rejected, not read");
        assert_eq!(err.code, "VALIDATION_ERROR", "name: {name}");
    }
}

#[tokio::test]
async fn recommendations_come_from_the_plans_own_yaml() {
    let _guard = env_lock().await;
    let (_temp, _folder, _daemon) = isolated_env(true).await;

    let recommendations = cmd_list_recommendations("00021".to_string())
        .await
        .expect("recommendations must load");

    assert_eq!(recommendations.len(), 2);
    assert_eq!(recommendations[0].title, "Tauri WebDriver E2E Automation");
    assert_eq!(recommendations[0].state, "Pending");
    assert_eq!(recommendations[1].state, "Declined");
    assert_eq!(
        recommendations[1].decline_reason.as_deref(),
        Some("Not now")
    );
}

#[tokio::test]
async fn an_unknown_recommendation_state_is_rejected_before_any_request() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(true).await;

    let err = cmd_set_recommendation_state(
        "00021".to_string(),
        "Tauri WebDriver E2E Automation".to_string(),
        "Approved".to_string(),
        None,
        None,
    )
    .await
    .expect_err("'Approved' is not a recommendation state");

    assert_eq!(err.code, "VALIDATION_ERROR");
    assert!(
        err.message.contains("AcceptedWithNotes"),
        "the error lists the valid states: {}",
        err.message
    );
    assert!(
        daemon.observed().recommendation_calls.is_empty(),
        "a rejected state must not reach the daemon"
    );
}

#[tokio::test]
async fn a_recommendation_decision_is_addressed_by_title() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(true).await;

    cmd_set_recommendation_state(
        "00021".to_string(),
        "Deep Link Protocol Handler".to_string(),
        "Declined".to_string(),
        Some("Out of scope for now".to_string()),
        None,
    )
    .await
    .expect("the daemon accepted the write");

    let observed = daemon.observed();
    let (plan_id, title, body) = observed
        .recommendation_calls
        .first()
        .expect("the command issued one write");
    assert_eq!(plan_id, "00021");
    // Recommendations are keyed by title in tendril-core, not by index.
    assert_eq!(title, "Deep Link Protocol Handler");
    assert_eq!(body["state"], "Declined");
    assert_eq!(body["declineReason"], "Out of scope for now");
    assert!(
        body["notes"].is_null(),
        "a decline reason must not be sent as an accept note"
    );
}

/// The counterpart to the decline above: an accept note goes in `notes`, not in
/// `declineReason`. The app used to send both through the one field, which is
/// what made an accepted recommendation read back as though it had been refused.
#[tokio::test]
async fn an_accept_note_is_sent_as_notes_not_as_a_decline_reason() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(true).await;

    cmd_set_recommendation_state(
        "00021".to_string(),
        "Tauri WebDriver E2E Automation".to_string(),
        "AcceptedWithNotes".to_string(),
        None,
        Some("Do it after the driver upgrade".to_string()),
    )
    .await
    .expect("the daemon accepted the write");

    let observed = daemon.observed();
    let (_plan_id, _title, body) = observed
        .recommendation_calls
        .first()
        .expect("the command issued one write");
    assert_eq!(body["state"], "AcceptedWithNotes");
    assert_eq!(body["notes"], "Do it after the driver upgrade");
    assert!(body["declineReason"].is_null());
}

#[tokio::test]
async fn a_service_that_refuses_the_write_produces_a_real_failure() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(false).await;

    let err = cmd_set_recommendation_state(
        "00021".to_string(),
        "Tauri WebDriver E2E Automation".to_string(),
        "Accepted".to_string(),
        None,
        None,
    )
    .await
    .expect_err("a 404 from the service must surface, not be swallowed");

    // The Review view rolls its optimistic update back on this, rather than
    // the app editing plan.yaml behind the daemon's back.
    assert_eq!(err.code, "RECOMMENDATION_UPDATE_FAILED");
    assert!(
        err.message.contains("Tauri WebDriver E2E Automation"),
        "message names the recommendation: {}",
        err.message
    );
    assert!(
        err.details
            .as_deref()
            .unwrap_or_default()
            .contains("no route for recommendation updates"),
        "the service's own response is preserved as details: {:?}",
        err.details
    );
    assert_eq!(daemon.observed().recommendation_calls.len(), 1);
}

#[tokio::test]
async fn an_unknown_verification_status_is_rejected_before_any_request() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(true).await;

    let err = cmd_set_verification_status(
        "00021".to_string(),
        "RustClippy".to_string(),
        "UnknownStatus".to_string(),
    )
    .await
    .expect_err("'UnknownStatus' is not a verification status");

    assert_eq!(err.code, "VALIDATION_ERROR");
    assert!(
        err.message.contains("Pending, Pass, Fail, Skipped"),
        "the error lists valid statuses: {}",
        err.message
    );
    assert!(
        daemon.observed().verification_calls.is_empty(),
        "a rejected status must not reach the daemon"
    );
}

#[tokio::test]
async fn a_verification_status_update_is_addressed_by_name() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(true).await;

    cmd_set_verification_status(
        "00021".to_string(),
        "RustClippy".to_string(),
        "Pass".to_string(),
    )
    .await
    .expect("daemon accepted the verification write");

    let observed = daemon.observed();
    let (plan_id, name, body) = observed
        .verification_calls
        .first()
        .expect("issued one write");
    assert_eq!(plan_id, "00021");
    assert_eq!(name, "RustClippy");
    assert_eq!(body["status"], "Pass");
}

#[tokio::test]
async fn a_service_that_refuses_the_verification_write_produces_a_real_failure() {
    let _guard = env_lock().await;
    let (_temp, _folder, daemon) = isolated_env(false).await;

    let err = cmd_set_verification_status(
        "00021".to_string(),
        "RustClippy".to_string(),
        "Pass".to_string(),
    )
    .await
    .expect_err("a 404 from the service must surface, not be swallowed");

    assert_eq!(err.code, "VERIFICATION_UPDATE_FAILED");
    assert!(
        err.message.contains("RustClippy"),
        "message names the verification: {}",
        err.message
    );
    assert!(
        err.details
            .as_deref()
            .unwrap_or_default()
            .contains("no route for verification updates"),
        "the service response is preserved as details: {:?}",
        err.details
    );
    assert_eq!(daemon.observed().verification_calls.len(), 1);
}
