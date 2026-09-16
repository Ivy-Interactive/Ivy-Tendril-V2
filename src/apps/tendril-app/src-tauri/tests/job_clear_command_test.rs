//! `cmd_clear_jobs`, and the `lastOutputAt` field the Jobs table's Agent Output column counts from.
//!
//! Both are bridge-shaped bugs rather than feature work: the daemon route and the whole confirm-dialog
//! UI exist, and without the command `jobsStore.canClearJobs()` is false so none of the menu items
//! render at all; the projection likewise dropped `lastOutputAt`, so every running row read "Starting…"
//! however long the agent had been talking.
//!
//! What the cases below pin: the scope reaches the daemon rather than being applied on this side, the
//! count comes back, the daemon's own refusal sentence survives, and no scope check is duplicated here.
//!
//! Commands resolve `TENDRIL_HOME` from the process environment, which is global, so every test takes
//! `env_lock()` for its duration.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use tempfile::TempDir;
use tendril_app_lib::commands::jobs::cmd_clear_jobs;
use tendril_app_lib::daemon::MasterInfo;
use tendril_app_lib::service::TendrilClient;
use tokio::net::TcpListener;

const SECRET: &str = "job-clear-command-test-secret";

async fn env_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

#[derive(Debug, Default)]
struct Observed {
    /// The scopes the route was asked to clear, in order.
    scopes: Vec<String>,
    unauthorized: usize,
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

/// A daemon whose `/api/jobs/clear` behaves as the real one does: the terminal scopes clear, and a live
/// scope is a `400` whose body names the scopes that are acceptable.
async fn spawn_mock_daemon() -> MockDaemon {
    let observed: Shared = Arc::new(Mutex::new(Observed::default()));

    let app = Router::new()
        .route(
            "/api/jobs/clear",
            post(
                |State(state): State<Shared>,
                 headers: HeaderMap,
                 Json(body): Json<serde_json::Value>| async move {
                    if !is_authorized(&headers) {
                        state.lock().expect("lock").unauthorized += 1;
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(json!({ "error": "unauthorized" })),
                        );
                    }
                    let scope = body
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    state.lock().expect("lock").scopes.push(scope.clone());

                    match scope.as_str() {
                        "completed" => (StatusCode::OK, Json(json!({ "cleared": 12 }))),
                        "failed" | "timeout" | "stopped" | "finished" => {
                            (StatusCode::OK, Json(json!({ "cleared": 0 })))
                        }
                        other => (
                            StatusCode::BAD_REQUEST,
                            Json(json!({
                                "error": format!(
                                    "'{other}' is not a clearable scope; use completed, failed, timeout, stopped or finished"
                                )
                            })),
                        ),
                    }
                },
            ),
        )
        // One running job carrying `lastOutputAt`, and one that has not spoken yet.
        .route(
            "/api/jobs",
            get(|headers: HeaderMap| async move {
                if !is_authorized(&headers) {
                    return (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({ "error": "unauthorized" })),
                    );
                }
                (
                    StatusCode::OK,
                    Json(json!([
                        {
                            "id": "00158",
                            "type": "ExecutePlan",
                            "project": "Ivy-Tendril-V2",
                            "status": "Running",
                            "startedAt": "2026-09-16T07:34:52Z",
                            "lastOutputAt": "2026-09-16T07:41:07Z"
                        },
                        {
                            "id": "00159",
                            "type": "ExecutePlan",
                            "project": "Ivy-Tendril-V2",
                            "status": "Running",
                            "startedAt": "2026-09-16T07:44:52Z"
                        }
                    ])),
                )
            }),
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

fn write_master(home: &std::path::Path, port: u16, secret: &str) {
    let master = MasterInfo {
        port,
        pid: std::process::id(),
        secret: secret.to_string(),
        started_at: "2026-09-16T10:41:11Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec!["jobs".to_string()],
    };
    std::fs::write(
        home.join(".master"),
        serde_json::to_string_pretty(&master).expect("serialize master"),
    )
    .expect("write master");
}

async fn isolated_env() -> (TempDir, MockDaemon) {
    let temp = tempfile::tempdir().expect("tempdir");
    let daemon = spawn_mock_daemon().await;
    write_master(temp.path(), daemon.addr.port(), SECRET);
    std::env::set_var("TENDRIL_HOME", temp.path());
    (temp, daemon)
}

#[tokio::test]
async fn the_scope_reaches_the_daemon_and_the_count_comes_back() {
    let _guard = env_lock().await;
    let (_temp, daemon) = isolated_env().await;

    let cleared = cmd_clear_jobs("completed".to_string())
        .await
        .expect("the clear must reach the daemon");

    assert_eq!(cleared, 12);
    assert_eq!(daemon.observed().scopes, vec!["completed".to_string()]);
    assert_eq!(daemon.observed().unauthorized, 0);
}

/// An empty scope is a successful clear of nothing, not a failure: the dialog says "nothing to clear"
/// rather than "the clear failed".
#[tokio::test]
async fn an_empty_scope_clears_zero_rather_than_failing() {
    let _guard = env_lock().await;
    let (_temp, _daemon) = isolated_env().await;

    assert_eq!(
        cmd_clear_jobs("stopped".to_string()).await.expect("clear"),
        0
    );
}

/// The refusal is the useful part. The daemon names the scopes it accepts, and that sentence has to
/// reach the operator — which also means no second scope check belongs on this side: this command
/// forwards `running` and lets the daemon answer for it.
#[tokio::test]
async fn a_live_scope_is_refused_by_the_daemon_with_its_own_reason() {
    let _guard = env_lock().await;
    let (_temp, daemon) = isolated_env().await;

    let err = cmd_clear_jobs("running".to_string())
        .await
        .expect_err("clearing running jobs must not report success");

    assert_eq!(err.code, "CLEAR_JOBS_FAILED");
    assert!(
        err.message.contains("not a clearable scope"),
        "the daemon's own sentence must survive: {}",
        err.message
    );
    assert!(err.message.contains("completed, failed, timeout, stopped"));
    // Forwarded rather than pre-empted, so the daemon stays the single authority on the scope list.
    assert_eq!(daemon.observed().scopes, vec!["running".to_string()]);
}

#[tokio::test]
async fn a_wrong_secret_is_a_refusal() {
    let _guard = env_lock().await;
    let temp = tempfile::tempdir().expect("tempdir");
    let daemon = spawn_mock_daemon().await;
    write_master(temp.path(), daemon.addr.port(), "not-the-secret");
    std::env::set_var("TENDRIL_HOME", temp.path());

    let err = cmd_clear_jobs("completed".to_string())
        .await
        .expect_err("an unauthorized clear must not report success");
    assert_eq!(err.code, "CLEAR_JOBS_FAILED");
    assert_eq!(daemon.observed().unauthorized, 1);
}

/// The Agent Output column counts up from `lastOutputAt`. The Jobs table's live overlay replaces each
/// fetched row wholesale, so a row that arrives without this field reads "Starting…" for the life of the
/// job — which is why the projection dropping it made the feature invisible rather than merely stale.
#[tokio::test]
async fn list_jobs_carries_last_output_at_and_leaves_it_absent_when_the_job_is_silent() {
    let _guard = env_lock().await;
    let (_temp, daemon) = isolated_env().await;
    let client = TendrilClient::new(
        format!("http://127.0.0.1:{}", daemon.addr.port()),
        Some(SECRET.to_string()),
    );

    let jobs = client.list_jobs(None, None).await.expect("list jobs");

    assert_eq!(jobs.len(), 2);
    assert_eq!(
        jobs[0].last_output_at.as_deref(),
        Some("2026-09-16T07:41:07Z")
    );
    // Absent, not empty: "has not spoken yet" has to stay distinguishable from "spoke at the epoch".
    assert_eq!(jobs[1].last_output_at, None);

    // And it survives serialisation to the webview under the name `Job.lastOutputAt` reads.
    let wire = serde_json::to_value(&jobs[0]).expect("serialize");
    assert_eq!(wire["lastOutputAt"], "2026-09-16T07:41:07Z");
    let silent = serde_json::to_value(&jobs[1]).expect("serialize");
    assert!(silent.get("lastOutputAt").is_none());
}
