//! `cmd_query_table`, the webview's only way into the daemon's server-paged table API.
//!
//! What matters here is not that a page comes back — the daemon's own tests cover the query. It is that
//! the *window, the sort and the filter reach the daemon* rather than being applied on this side, that
//! the bearer secret goes with them and never comes back, and that a path outside the query API is
//! refused rather than proxied with the daemon's credential.
//!
//! Commands resolve `TENDRIL_HOME` from the process environment, which is global, so every test takes
//! `env_lock()` for its duration.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use tempfile::TempDir;
use tendril_app_lib::commands::tables::cmd_query_table;
use tendril_app_lib::daemon::MasterInfo;
use tokio::net::TcpListener;

const SECRET: &str = "table-query-command-test-secret";

async fn env_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

/// What the mock daemon was asked for, so a test can assert on the *request* rather than only on the
/// value that came back. The whole claim of a server-paged table is about the request.
#[derive(Debug, Default)]
struct Observed {
    /// `(path, body)` per call, in order.
    queries: Vec<(String, serde_json::Value)>,
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

/// A daemon serving the three query-API paths. `/api/jobs/query` answers a page whose rows are the
/// app's `Job` shape; a filter naming `nope` is a 400 the way the real route's validation is.
async fn spawn_mock_daemon() -> MockDaemon {
    let observed: Shared = Arc::new(Mutex::new(Observed::default()));

    let query = |state: State<Shared>, headers: HeaderMap, path: &'static str| {
        move |body: serde_json::Value| {
            let State(state) = state;
            async move {
                if !is_authorized(&headers) {
                    state.lock().expect("lock").unauthorized += 1;
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "no" })));
                }
                state
                    .lock()
                    .expect("lock")
                    .queries
                    .push((path.to_string(), body.clone()));

                let names_a_bad_column = body.to_string().contains("nope");
                if names_a_bad_column {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "unknown column 'nope' for table 'Jobs'" })),
                    );
                }

                let offset = body.get("offset").and_then(|v| v.as_i64()).unwrap_or(0);
                (
                    StatusCode::OK,
                    Json(json!({
                        "encoding": "application/json",
                        "rows": [{
                            "id": format!("{:05}", 900 - offset),
                            "type": "ExecutePlan",
                            "planId": "00638",
                            "planTitle": "Rebuild the Jobs page",
                            "project": "Ivy-Tendril-V2",
                            "status": "Completed",
                        }],
                        "offset": offset,
                        "rowCount": 1,
                        "totalRows": 2_500_000,
                        "limit": body.get("limit").and_then(|v| v.as_i64()).unwrap_or(50),
                        "versionToken": "2500000:2026-09-16",
                        "stale": false,
                    })),
                )
            }
        }
    };

    let app = Router::new()
        .route(
            "/api/jobs/query",
            post(
                move |state: State<Shared>,
                      headers: HeaderMap,
                      Json(body): Json<serde_json::Value>| {
                    query(state, headers, "/api/jobs/query")(body)
                },
            ),
        )
        .route(
            "/api/tables/{table}/query",
            post(
                move |state: State<Shared>,
                      headers: HeaderMap,
                      Json(body): Json<serde_json::Value>| {
                    query(state, headers, "/api/tables/{table}/query")(body)
                },
            ),
        )
        .route(
            "/api/tables/{table}/values",
            post(
                move |state: State<Shared>,
                      headers: HeaderMap,
                      Json(body): Json<serde_json::Value>| async move {
                    let State(state) = state;
                    if !is_authorized(&headers) {
                        state.lock().expect("lock").unauthorized += 1;
                        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "no" })));
                    }
                    state
                        .lock()
                        .expect("lock")
                        .queries
                        .push(("/api/tables/{table}/values".to_string(), body));
                    (
                        StatusCode::OK,
                        Json(json!({
                            "column": "Status",
                            "values": ["Completed", "Failed", "Running"],
                            "totalValues": 3,
                        })),
                    )
                },
            ),
        )
        // Present so a test can prove the command refuses to reach it, not just that it is not called.
        .route(
            "/api/jobs/{id}/cancel",
            post(|| async { (StatusCode::OK, Json(json!({ "message": "cancelled" }))) }),
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
        started_at: "2026-09-16T10:41:11Z".to_string(),
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

async fn isolated_env() -> (TempDir, MockDaemon) {
    let temp = tempfile::tempdir().expect("tempdir");
    let daemon = spawn_mock_daemon().await;
    write_master(temp.path(), daemon.addr.port());
    std::env::set_var("TENDRIL_HOME", temp.path());
    (temp, daemon)
}

#[tokio::test]
async fn the_window_the_sort_and_the_filter_all_reach_the_daemon() {
    let _guard = env_lock().await;
    let (_temp, daemon) = isolated_env().await;

    // The body a scrolled, sorted, filtered Jobs table sends for its third window.
    let body = json!({
        "offset": 100,
        "limit": 50,
        "sort": [{ "column": "cost", "direction": "Descending" }],
        "filter": {
            "group": {
                "op": "and",
                "filters": [
                    { "condition": { "column": "status", "function": "inSet",
                                     "args": ["Running", "Queued"] } },
                    { "condition": { "column": "reportedPlanTitle", "function": "contains",
                                     "args": ["rebuild"] } }
                ]
            }
        },
        "versionToken": "2500000:2026-09-16"
    });

    let page = cmd_query_table("/api/jobs/query".to_string(), body.clone())
        .await
        .expect("the query must reach the daemon");

    // Forwarded whole. This is the assertion the table's scale claim rests on: the offset, the limit,
    // the sort and the filter are the daemon's problem, so the client never holds the other 2.5M rows.
    let observed = daemon.observed();
    assert_eq!(observed.queries.len(), 1);
    assert_eq!(observed.queries[0].0, "/api/jobs/query");
    assert_eq!(observed.queries[0].1, body);
    assert_eq!(observed.unauthorized, 0, "the secret went with the request");

    // And the reply comes back untouched, counters included.
    assert_eq!(page["totalRows"], 2_500_000);
    assert_eq!(page["offset"], 100);
    assert_eq!(page["rows"][0]["planId"], "00638");
    assert_eq!(page["versionToken"], "2500000:2026-09-16");

    // The secret is not in anything the command returns.
    assert!(!page.to_string().contains(SECRET));
}

#[tokio::test]
async fn the_generic_route_and_the_values_route_are_reachable_too() {
    let _guard = env_lock().await;
    let (_temp, daemon) = isolated_env().await;

    cmd_query_table(
        "/api/tables/plans/query".to_string(),
        json!({ "limit": 25, "selectColumns": ["id", "title"] }),
    )
    .await
    .expect("the generic route must be reachable");

    // The facet's values, which is what keeps a filter control from being built out of the rows on
    // screen — the value a user wants is usually not among them.
    let values = cmd_query_table(
        "/api/tables/jobs/values".to_string(),
        json!({ "column": "status", "limit": 200 }),
    )
    .await
    .expect("the values route must be reachable");
    assert_eq!(values["values"], json!(["Completed", "Failed", "Running"]));

    let observed = daemon.observed();
    assert_eq!(
        observed
            .queries
            .iter()
            .map(|(path, _)| path.as_str())
            .collect::<Vec<_>>(),
        vec!["/api/tables/{table}/query", "/api/tables/{table}/values"]
    );
    assert_eq!(observed.queries[1].1["column"], "status");
}

#[tokio::test]
async fn a_rejected_query_keeps_the_daemons_own_reason() {
    let _guard = env_lock().await;
    let (_temp, _daemon) = isolated_env().await;

    let err = cmd_query_table(
        "/api/jobs/query".to_string(),
        json!({ "filter": { "condition": { "column": "nope", "function": "isNotNull" } } }),
    )
    .await
    .expect_err("a bad column must fail");

    // The message names the column, because that is the only thing a filter UI can usefully show.
    assert_eq!(err.code, "TABLE_QUERY_FAILED");
    assert!(
        err.message.contains("unknown column 'nope'"),
        "message: {}",
        err.message
    );
}

#[tokio::test]
async fn a_path_outside_the_query_api_is_refused_rather_than_proxied() {
    let _guard = env_lock().await;
    let (_temp, daemon) = isolated_env().await;

    // The command carries the daemon's own credential, so forwarding an arbitrary path would make
    // everything the daemon can do reachable from the webview.
    for path in [
        "/api/jobs/00021/cancel",
        "/api/jobs",
        "/api/config",
        "/api/tables/../jobs/query",
        "/api/tables/jobs",
    ] {
        let err = cmd_query_table(path.to_string(), json!({}))
            .await
            .unwrap_err();
        assert_eq!(err.code, "VALIDATION_ERROR", "{path}");
        assert!(err.message.contains(path), "{path}: {}", err.message);
    }

    assert!(
        daemon.observed().queries.is_empty(),
        "nothing outside the query API may reach the daemon"
    );
}

#[tokio::test]
async fn without_a_daemon_the_failure_is_a_disconnected_bridge_error() {
    let _guard = env_lock().await;
    let temp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("TENDRIL_HOME", temp.path());

    let err = cmd_query_table("/api/jobs/query".to_string(), json!({}))
        .await
        .expect_err("no .master, so no query");
    // The frontend branches on `code`; a table can then say "the daemon is not running" rather than
    // rendering an empty list, which is a different claim.
    assert_eq!(err.code, "DISCONNECTED");
}
