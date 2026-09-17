use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::error::TendrilError;
use tendril_core::jobs::{
    find_log_file, read_eventwire_log, read_job_log, read_lines_from, read_raw_log, StartOptions,
    CLEARABLE_STATUSES,
};
use tendril_core::models::{JobArgs, JobItem, JobStatus};

#[derive(Debug, Deserialize)]
pub struct JobListQuery {
    pub status: Option<String>,
    pub limit: Option<usize>,
}

pub async fn list_jobs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<JobListQuery>,
) -> impl IntoResponse {
    let status_filter = query.status.as_deref().and_then(JobStatus::from_str_loose);
    let limit = query.limit.unwrap_or(50);

    match state.job_manager.list_jobs(status_filter, limit).await {
        Ok(jobs) => Json(json!(jobs)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to list jobs: {}", e) })),
        )
            .into_response(),
    }
}

/// `POST /api/jobs/query` — one window of the Jobs table under a caller's sort, filter and offset.
///
/// The body is `TableQuery` (`sort`, a recursive `filter`, `offset`, `limit`, `selectColumns`,
/// `aggregations`, `versionToken`) and `{}` means "the first page in the server's order", which is the
/// order `GET /api/jobs` lists in.
///
/// Why it exists next to `GET /api/jobs`: that route can only answer "the newest N", so a table built
/// on it has to hold every row it might display and do its own sorting and paging — which stops
/// working somewhere in the tens of thousands of jobs and gets slower every day the daemon runs. Here
/// SQLite does the sort, the filter and the window, and the response carries `totalRows`, so the
/// client holds one page and the footer still knows the true count.
///
/// The rows are the **client-facing job shape** — see [`job_row`] — rather than a raw `JobItem`,
/// because this route exists for one caller: a table widget that has to display a window and nothing
/// else. `GET /api/jobs` and `GET /api/jobs/:id` still serve `JobItem`, and
/// `POST /api/tables/jobs/query` serves the raw columns, so nothing that wants the whole record lost a
/// way to ask for it.
///
/// See `routes::tables` for the generic form of this API, the `Accept`-based encoding negotiation and
/// the Arrow story.
pub async fn query_jobs_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(query): Json<tendril_core::db::query::TableQuery>,
) -> impl IntoResponse {
    use crate::routes::tables::{
        arrow_not_available_response, negotiate_encoding, ResponseEncoding,
    };

    if negotiate_encoding(&headers) == ResponseEncoding::ArrowIpc {
        return arrow_not_available_response();
    }

    let db_path = state.db_path.clone();
    let select_columns = query.select_columns.clone();

    // `spawn_blocking`: a filtered `COUNT(*)` over a long job history is the one read here whose cost
    // grows with the table, and it must not sit on an async worker thread.
    let result = tokio::task::spawn_blocking(move || {
        let conn = tendril_core::db::open_database(&db_path)?;
        tendril_core::db::jobs::query_jobs(&conn, &query)
    })
    .await;

    match result {
        Ok(Ok(page)) => {
            // `selectColumns` is applied to the serialized rows rather than to the `SELECT`, because
            // the rows are job DTOs whose fields are not one-to-one with columns (`planId` comes from
            // `ReportedPlanId`, and `detached` has no column at all). It is still a real saving on the
            // wire — a jobs table showing six columns need not carry twenty-one — and the names were
            // already validated against the schema, so a typo was a 400.
            let rows: Vec<serde_json::Value> = page
                .rows
                .iter()
                .map(|job| job_row(job, &select_columns))
                .collect();
            Json(json!({
                "encoding": "application/json",
                "rows": rows,
                "offset": page.offset,
                "rowCount": page.row_count,
                "totalRows": page.total_rows,
                "limit": page.limit,
                "versionToken": page.version_token,
                "stale": page.stale,
                "aggregations": page.aggregations,
            }))
            .into_response()
        }
        Ok(Err(TendrilError::Validation(message))) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to query jobs: {e}") })),
        )
            .into_response(),
        Err(join) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to query jobs: {join}") })),
        )
            .into_response(),
    }
}

/// The client-facing job shape: one response field per row, the `JobItem` field it is read from, and
/// the `Jobs` column behind it.
///
/// This is the app's `Job` (`apps/tendril-app/src/types/api.ts`), which is `JobDto`
/// (`src-tauri/src/models.rs`) — the shape every job that reaches a view already has, because the
/// desktop bridge maps `GET /api/jobs` into it on the way through. A table paging this route has to
/// receive rows in *that* shape or its columns come back empty, and the only two fields where the two
/// disagree are the ones a Jobs table leans on hardest: `planId` and `planTitle`, which a `JobItem`
/// calls `reportedPlanId` and `reportedPlanTitle`.
///
/// Doing the mapping here rather than in the caller is what keeps the transport a pass-through: the
/// desktop shell reaches this route through one generic `cmd_query_table(path, body)` command that
/// hands the reply back untouched, so it stays reusable for `/api/tables/{table}/query` and stays the
/// single place an Arrow encoding would land. A per-route row mapper wedged into that command would
/// undo both.
///
/// `JobItem` fields with no counterpart in `Job` — `planFile`, `args`, `typedArgs`, `provider`,
/// `effort`, `priority`, `waitForJobIds`, `permissionDenials`, `cliCommand` and the rest — are not on
/// these rows. `POST /api/tables/jobs/query` returns every column raw, and `GET /api/jobs/:id` returns
/// the whole `JobItem`, so neither is unreachable; they are simply not what a list window is for.
const JOB_ROW_FIELDS: &[(&str, &str, &str)] = &[
    ("id", "id", "Id"),
    ("type", "type", "Type"),
    // The two renames. V1's Plan Id cell and its Prompt cell are the whole reason this route is worth
    // paging: leaving them under the daemon's names is how a moved table renders two blank columns.
    ("planId", "reportedPlanId", "ReportedPlanId"),
    ("planTitle", "reportedPlanTitle", "ReportedPlanTitle"),
    ("project", "project", "Project"),
    ("status", "status", "Status"),
    ("statusMessage", "statusMessage", "StatusMessage"),
    ("startedAt", "startedAt", "StartedAt"),
    // The Agent Output cell is a staleness gauge, not a status line: V1's `FormatAgentOutput`
    // (`JobsApp.Helpers.cs:63`) renders the time since the agent last wrote a line, and falls back to
    // "Starting…" only while there is no such time. Absent from this projection, every running row took
    // that fallback forever. Written by `note_agent_output` at most once per five seconds, so it is a
    // cheap column to carry and a stale one by at most that much.
    ("lastOutputAt", "lastOutputAt", "LastOutputAt"),
    ("completedAt", "completedAt", "CompletedAt"),
    ("durationSeconds", "durationSeconds", "DurationSeconds"),
    ("cost", "cost", "Cost"),
    ("costSource", "costSource", "CostSource"),
    ("tokens", "tokens", "Tokens"),
    ("inputTokens", "inputTokens", "InputTokens"),
    ("outputTokens", "outputTokens", "OutputTokens"),
    ("cacheReadTokens", "cacheReadTokens", "CacheReadTokens"),
    ("cacheWriteTokens", "cacheWriteTokens", "CacheWriteTokens"),
    ("reasoningTokens", "reasoningTokens", "ReasoningTokens"),
    ("model", "model", "Model"),
    ("processId", "processId", "ProcessId"),
    // The conversation that started the job, so the chat header can list a job it started without
    // depending on having caught the `chat.job_spawned` event that announced it.
    ("chatSessionId", "chatSessionId", "ChatSessionId"),
    // Runtime state with no column: `JobManager::supervise_detached` rehydrates it in memory, so a row
    // read from SQLite cannot know. Sent only when true, never as `false` — the app reads
    // `job.detached ?? details[id]?.detached`, so a `false` from here would suppress the one source
    // that does know.
    ("detached", "detached", ""),
];

/// A job as a row of [`JOB_ROW_FIELDS`], keeping only the requested fields. An empty request keeps all
/// of them.
///
/// Matching is loose: `completedAt`, `CompletedAt` and `completed_at` all name the same field, and both
/// the response field name and the column behind it are accepted, so a caller can send what it read
/// from `GET /api/tables/jobs/schema` or what it sees in a row. `id` is always kept — it is the row
/// identity every table needs, and a projection that dropped it would produce rows a client cannot key.
///
/// The names to send are *column* names, because that is what the query processor validates against, so
/// a typo is a 400 rather than a silently missing field. `planId` and `planTitle` are the two names
/// that are not columns: ask for `reportedPlanId` and `reportedPlanTitle`, which is what a schema
/// reader would send anyway. `detached` has no column either, and no way to be selected — omit
/// `selectColumns` to get it.
fn job_row(job: &JobItem, select: &[String]) -> serde_json::Value {
    let serialized = json!(job);
    let source = serialized.as_object();
    let wanted: Vec<String> = select.iter().map(|name| normalize_field(name)).collect();

    let mut row = serde_json::Map::with_capacity(JOB_ROW_FIELDS.len());
    for (field, item_field, column) in JOB_ROW_FIELDS {
        let keep = wanted.is_empty()
            || *field == "id"
            || wanted.contains(&normalize_field(field))
            || (!column.is_empty() && wanted.contains(&normalize_field(column)));
        if !keep {
            continue;
        }

        // An absent or null source field stays absent, matching `JobDto`'s own
        // `skip_serializing_if = "Option::is_none"`: a job that reported no cost must not present
        // itself as one that cost nothing.
        let Some(value) = source.and_then(|object| object.get(*item_field)) else {
            continue;
        };
        if value.is_null() || (*field == "detached" && value == &serde_json::Value::Bool(false)) {
            continue;
        }
        row.insert((*field).to_string(), value.clone());
    }
    serde_json::Value::Object(row)
}

/// Case-, underscore- and dash-insensitive form of a field or column name.
fn normalize_field(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// A job start. The args are flattened, so the current bare-`JobArgs` body keeps working and the new
/// options ride alongside it.
#[derive(Debug, Deserialize)]
pub struct StartJobRequest {
    #[serde(flatten)]
    pub args: JobArgs,
    #[serde(rename = "waitForJobs", default)]
    pub wait_for_jobs: Vec<String>,
    #[serde(default)]
    pub priority: Option<i32>,
    /// Client-supplied identity of this submission. Resubmitting the same key returns the job it
    /// already created instead of starting a second one, which is what makes a retry after a lost or
    /// timed-out response safe. `#[serde(default)]` keeps every existing body valid.
    #[serde(rename = "idempotencyKey", default)]
    pub idempotency_key: Option<String>,
    /// The conversation this job was started from, so the chat can list it and be notified when it
    /// finishes. Optional: a job started from a terminal has none, and one that names a plan can still
    /// inherit the plan's own chat session.
    #[serde(rename = "chatSessionId", default)]
    pub chat_session_id: Option<String>,
}

/// `?force=true` is the operator's override of the duplicate gates, for the job types that carry no
/// force flag of their own. Only `CreatePlan` has one in its args.
#[derive(Debug, Deserialize)]
pub struct StartJobQuery {
    #[serde(default)]
    pub force: bool,
}

/// Longest idempotency key accepted, so an unbounded client string never reaches the column.
const MAX_IDEMPOTENCY_KEY_LEN: usize = 200;

pub async fn start_job(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StartJobQuery>,
    headers: HeaderMap,
    Json(req): Json<StartJobRequest>,
) -> impl IntoResponse {
    // `Idempotency-Key` is the conventional spelling, so accept it as an alternative to the body
    // field. The body wins if both are present: it is the more explicit of the two.
    let idempotency_key = req.idempotency_key.or_else(|| {
        headers
            .get("Idempotency-Key")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    });
    let idempotency_key = match idempotency_key {
        Some(key) if key.trim().is_empty() => None,
        Some(key) if key.len() > MAX_IDEMPOTENCY_KEY_LEN => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": format!(
                        "idempotencyKey must be at most {} characters",
                        MAX_IDEMPOTENCY_KEY_LEN
                    )
                })),
            )
                .into_response()
        }
        other => other,
    };

    let opts = StartOptions {
        wait_for_jobs: req.wait_for_jobs,
        priority: req.priority,
        force: query.force || req.args.force_flag(),
        idempotency_key,
        chat_session_id: req
            .chat_session_id
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty()),
    };

    match state.job_manager.start_job_with(req.args, opts).await {
        Ok(job_id) => (
            StatusCode::OK,
            Json(json!({ "jobId": job_id, "status": "Started" })),
        )
            .into_response(),
        // A rejected conflict is not a malformed request: it names the job that holds the plan.
        Err(TendrilError::Conflict(msg)) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": msg, "status": "Conflict" })),
        )
            .into_response(),
        // The same work already in flight, named by job id so the caller can watch it instead.
        Err(TendrilError::DuplicateJob(msg)) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": msg, "status": "Conflict" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Failed to start job: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn get_job(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    match state.job_manager.get_job(&job_id).await {
        Ok(Some(job)) => Json(json!({
            "id": job.id,
            "status": job.status.to_string(),
            "message": job.status_message,
            "details": job
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Job not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Error retrieving job: {}", e) })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateJobStatusRequest {
    pub message: String,
    #[serde(rename = "planId")]
    pub plan_id: Option<String>,
    #[serde(rename = "planTitle")]
    pub plan_title: Option<String>,
}

pub async fn update_job_status(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    Json(req): Json<UpdateJobStatusRequest>,
) -> impl IntoResponse {
    match state
        .job_manager
        .update_job_status(
            &job_id,
            &req.message,
            req.plan_id.as_deref(),
            req.plan_title.as_deref(),
        )
        .await
    {
        Ok(true) => (StatusCode::OK, Json(json!({ "status": "Updated" }))),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Job not found" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Error updating job: {}", e) })),
        ),
    }
}

#[derive(Debug, Deserialize)]
pub struct ReportJobFailureRequest {
    pub message: String,
    #[serde(default)]
    pub stop: bool,
}

pub async fn report_job_failure(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    Json(req): Json<ReportJobFailureRequest>,
) -> impl IntoResponse {
    let _ = state
        .job_manager
        .report_job_failure(&job_id, &req.message)
        .await;
    if req.stop {
        let _ = state
            .job_manager
            .cancel_job(&job_id, Some(&req.message))
            .await;
    }
    (
        StatusCode::OK,
        Json(json!({ "status": "Failure reported" })),
    )
}

#[derive(Debug, Deserialize)]
pub struct CancelJobRequest {
    pub message: Option<String>,
}

pub async fn cancel_job(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    Json(req): Json<Option<CancelJobRequest>>,
) -> impl IntoResponse {
    let msg = req.and_then(|r| r.message);
    match state.job_manager.cancel_job(&job_id, msg.as_deref()).await {
        Ok(true) => (StatusCode::OK, Json(json!({ "status": "Cancelled" }))),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Job not found" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Error cancelling job: {}", e) })),
        ),
    }
}

/// Removes a job from the job list and the database. Its log artifacts are kept.
pub async fn delete_job(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    match state.job_manager.delete_job(&job_id).await {
        Ok(true) => (StatusCode::OK, Json(json!({ "status": "Deleted" }))),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Job not found" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Error deleting job: {}", e) })),
        ),
    }
}

/// Promotes a Blocked or Queued job to the head of the queue, skipping its gates.
pub async fn force_start_job(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    match state.job_manager.force_start_job(&job_id).await {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "Started" }))),
        Err(TendrilError::JobNotFound(_)) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Job not found" })),
        ),
        Err(e) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Stops every job that has not finished.
pub async fn stop_all_jobs(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.job_manager.stop_all_jobs().await {
        Ok(stopped) => (
            StatusCode::OK,
            Json(json!({ "stopped": stopped, "count": stopped.len() })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Error stopping jobs: {}", e) })),
        ),
    }
}

#[derive(Debug, Deserialize)]
pub struct ClearJobsRequest {
    /// `all`, or the name of one terminal status. Absent means `completed`.
    pub status: Option<String>,
}

/// The statuses `status` may name, as [`CLEARABLE_STATUSES`] spells them, for an error message that
/// tells the caller what to send instead of making them guess.
fn clearable_scope_list() -> String {
    let mut names: Vec<&str> = vec!["all"];
    names.extend(CLEARABLE_STATUSES.iter().map(JobStatus::as_str));
    names.join(", ")
}

/// Resolves a clear scope to the statuses it removes, or `None` for one this route will not perform.
///
/// Every terminal status is nameable, not just the two V1's menu happened to expose: V1's service is
/// already a generic predicate clear (`ClearJobsByStatus`) and only wires up two of its uses, so a
/// per-status scope is an extension of its own primitive rather than a new mechanism.
///
/// `Running`, `Queued`, `Pending` and `Blocked` are matched by [`JobStatus::from_str_loose`] and then
/// refused here, so asking to clear them is a 400 that says why rather than a silent no-op. The
/// manager filters them again — see [`CLEARABLE_STATUSES`] — because that guarantee belongs to the
/// primitive, not to this route.
fn resolve_clear_scope(scope: &str) -> Option<Vec<JobStatus>> {
    if scope.eq_ignore_ascii_case("all") {
        return Some(CLEARABLE_STATUSES.to_vec());
    }
    let status = JobStatus::from_str_loose(scope)?;
    CLEARABLE_STATUSES.contains(&status).then(|| vec![status])
}

/// Bulk-deletes jobs by status. Only ever finished ones; see [`resolve_clear_scope`].
pub async fn clear_jobs(
    State(state): State<Arc<AppState>>,
    Json(req): Json<Option<ClearJobsRequest>>,
) -> impl IntoResponse {
    let scope = req
        .and_then(|r| r.status)
        .unwrap_or_else(|| "completed".to_string());

    let Some(statuses) = resolve_clear_scope(&scope) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!(
                    "Cannot clear '{}'; a clear only removes finished jobs. Expected one of: {}",
                    scope,
                    clearable_scope_list()
                )
            })),
        );
    };

    match state.job_manager.clear_jobs(&statuses).await {
        Ok(cleared) => (StatusCode::OK, Json(json!({ "cleared": cleared }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Error clearing jobs: {}", e) })),
        ),
    }
}

/// The queue in dispatch order, so an operator can see what runs next and why.
pub async fn job_queue(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let queued: Vec<serde_json::Value> = state
        .job_manager
        .queue_snapshot()
        .await
        .into_iter()
        .map(|(id, priority)| json!({ "id": id, "priority": priority }))
        .collect();

    (
        StatusCode::OK,
        Json(json!({
            "queued": queued,
            "maxConcurrent": state.job_manager.max_concurrent_jobs().await,
        })),
    )
}

/// Runs one maintenance pass now, instead of waiting for the 60s timer.
pub async fn run_maintenance(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let report = state.job_manager.run_maintenance_pass().await;
    (StatusCode::OK, Json(json!(report)))
}

#[derive(Debug, Deserialize)]
pub struct AddLogRequest {
    pub action: String,
    pub summary: Option<String>,
}

pub async fn add_log(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    Json(req): Json<AddLogRequest>,
) -> impl IntoResponse {
    match state
        .job_manager
        .add_log(&job_id, &req.action, req.summary.as_deref())
    {
        Ok(path) => (
            StatusCode::OK,
            Json(json!({
                "message": format!("Log written: {}", path.file_name().unwrap_or_default().to_string_lossy())
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write log: {}", e) })),
        ),
    }
}

#[derive(Debug, Deserialize)]
pub struct JobLogsQuery {
    pub format: Option<String>,
    pub tail: Option<usize>,
}

pub async fn get_job_logs(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    Query(query): Query<JobLogsQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let job_exists = match state.job_manager.get_job(&job_id).await {
        Ok(Some(_)) => true,
        _ => {
            find_log_file(&state.tendril_home, &job_id, ".md").is_some()
                || find_log_file(&state.tendril_home, &job_id, ".raw.jsonl").is_some()
                || find_log_file(&state.tendril_home, &job_id, ".eventwire.jsonl").is_some()
        }
    };

    if !job_exists {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Job not found" })),
        )
            .into_response();
    }

    let format_str = query.format.unwrap_or_else(|| "markdown".to_string());
    let (content, exists) = match format_str.to_ascii_lowercase().as_str() {
        "raw" => match read_raw_log(&state.tendril_home, &job_id, query.tail) {
            Ok(Some(lines)) => (lines.join("\n"), true),
            _ => (String::new(), false),
        },
        "eventwire" => match read_eventwire_log(&state.tendril_home, &job_id, query.tail) {
            Ok(Some(lines)) => (lines.join("\n"), true),
            _ => (String::new(), false),
        },
        _ => match read_job_log(&state.tendril_home, &job_id) {
            Ok(Some(mut text)) => {
                if let Some(n) = query.tail {
                    let lines: Vec<&str> = text.lines().collect();
                    if lines.len() > n {
                        text = lines[lines.len() - n..].join("\n");
                    }
                }
                (text, true)
            }
            _ => (String::new(), false),
        },
    };

    let accepts_plain = headers
        .get(axum::http::header::ACCEPT)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.contains("text/plain"))
        .unwrap_or(false);

    if accepts_plain {
        (
            StatusCode::OK,
            [("content-type", "text/plain; charset=utf-8")],
            content,
        )
            .into_response()
    } else {
        (
            StatusCode::OK,
            Json(json!({
                "jobId": job_id,
                "format": format_str,
                "content": content,
                "exists": exists,
            })),
        )
            .into_response()
    }
}

/// How often a follower looks for newly appended lines.
const LOG_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);

/// Follows one of a job's log files, reading only what has been appended since the last call.
///
/// The point of this type is that a tick costs the appended bytes and nothing else. The streams used
/// to call `read_raw_log`/`read_eventwire_log` on every tick, each of which returns the *whole* file:
/// four full reads a second, per viewer, for as long as the job ran, which on a large log is
/// sustained multi-MB/s of disk I/O for output nobody is waiting for.
///
/// The source file is resolved once and then kept. The old code re-picked it every tick, preferring
/// the eventwire log whenever it existed, while carrying a single line counter across both — so an
/// eventwire log that appeared after the raw one had started streaming silently reinterpreted that
/// counter against a different file. `JobManager` writes the same line to both in one callback, so
/// there is nothing to gain from switching and a mangled stream to lose.
struct LogFollower {
    tendril_home: std::path::PathBuf,
    job_id: String,
    /// Candidate suffixes in preference order; the first that exists wins.
    suffixes: &'static [&'static str],
    path: Option<std::path::PathBuf>,
    offset: u64,
}

impl LogFollower {
    fn new(
        tendril_home: std::path::PathBuf,
        job_id: String,
        suffixes: &'static [&'static str],
    ) -> Self {
        Self {
            tendril_home,
            job_id,
            suffixes,
            path: None,
            offset: 0,
        }
    }

    /// The log file, resolved on first sight. A job can be accepted before its agent has written
    /// anything, so "not there yet" is normal and simply means the next tick tries again.
    fn resolve(&mut self) -> Option<std::path::PathBuf> {
        if self.path.is_none() {
            self.path = self
                .suffixes
                .iter()
                .find_map(|suffix| find_log_file(&self.tendril_home, &self.job_id, suffix));
        }
        self.path.clone()
    }

    /// Lines appended since the last call. A half-written trailing line is held back until it has its
    /// newline, so a consumer is never handed a truncated JSON event.
    fn next_lines(&mut self) -> Vec<String> {
        let Some(path) = self.resolve() else {
            return Vec::new();
        };
        match read_lines_from(&path, self.offset) {
            Ok(chunk) => {
                self.offset = chunk.next_offset;
                chunk.lines
            }
            Err(_) => Vec::new(),
        }
    }

    /// The final read of a job that is over: everything left, including a trailing line that never
    /// received its newline because the process died mid-write.
    fn drain(&mut self) -> Vec<String> {
        let Some(path) = self.resolve() else {
            return Vec::new();
        };
        match read_lines_from(&path, self.offset) {
            Ok(chunk) => {
                self.offset = chunk.next_offset;
                let mut lines = chunk.lines;
                if let Some(partial) = chunk.partial {
                    lines.push(partial);
                }
                lines
            }
            Err(_) => Vec::new(),
        }
    }
}

type SseSender =
    tokio::sync::mpsc::Sender<Result<axum::response::sse::Event, std::convert::Infallible>>;

/// What distinguishes one job stream from another: the frame name, what to skip, what to filter, and
/// what the `end` frame carries.
struct StreamShape {
    /// SSE `event:` name for a payload frame.
    event_name: &'static str,
    /// Lines before this index are the ones the client says it already has. Frames carry their line
    /// index as the SSE `id:`, so a reconnecting client can name where to resume and stop re-ingesting
    /// the prefix it already rendered.
    since_line: usize,
    /// Empty means "everything".
    allowed_kinds: std::collections::HashSet<String>,
    /// The `end` frame's payload, given the terminal status.
    end_data: fn(&str) -> String,
}

/// Streams a job's log until the job finishes or the client goes away.
///
/// Two things the previous inline version got wrong are load-bearing here. The hang-up check only ran
/// *inside* the "there is a line to send" loop, so a quiet long-running job never freed the task: an
/// abandoned stream kept polling until the job ended, however long that took. And the sleep was
/// unconditional, so even once the client was gone the task waited out its full tick. Both are fixed
/// by checking `tx` before doing any work and by racing the sleep against the channel closing.
async fn pump_log_stream<P, F>(
    tx: SseSender,
    mut follower: LogFollower,
    shape: StreamShape,
    mut terminal_status: P,
    poll: std::time::Duration,
) where
    P: FnMut() -> F,
    F: std::future::Future<Output = Option<String>>,
{
    let mut emitted_lines = 0usize;

    loop {
        // Before any disk I/O: a reader dropped between ticks must cost one comparison, not a read.
        if tx.is_closed() {
            return;
        }

        if !send_lines(&tx, follower.next_lines(), &mut emitted_lines, &shape).await {
            return;
        }

        if let Some(status) = terminal_status().await {
            if !send_lines(&tx, follower.drain(), &mut emitted_lines, &shape).await {
                return;
            }
            let end_event = axum::response::sse::Event::default()
                .event("end")
                .data((shape.end_data)(&status));
            let _ = tx.send(Ok(end_event)).await;
            return;
        }

        tokio::select! {
            // Noticed the moment it happens rather than up to a tick later.
            _ = tx.closed() => return,
            _ = tokio::time::sleep(poll) => {}
        }
    }
}

/// Sends `lines` as frames, advancing the line counter for every line whether or not it was sent.
/// Returns `false` once the receiver is gone.
async fn send_lines(
    tx: &SseSender,
    lines: Vec<String>,
    emitted_lines: &mut usize,
    shape: &StreamShape,
) -> bool {
    for line in lines {
        let index = *emitted_lines;
        *emitted_lines += 1;

        if index < shape.since_line || !matches_kinds(&line, &shape.allowed_kinds) {
            continue;
        }

        let event = axum::response::sse::Event::default()
            .id(index.to_string())
            .event(shape.event_name)
            .data(line);
        if tx.send(Ok(event)).await.is_err() {
            return false;
        }
    }
    true
}

/// A probe that reports the job's terminal status, or `None` while it is still going.
///
/// A job the manager cannot find at all counts as finished: it was deleted, or the stream was opened
/// against nothing but log files left behind by an older run, and in neither case is anything more
/// coming.
fn terminal_status_probe(
    job_manager: std::sync::Arc<tendril_core::jobs::JobManager>,
    job_id: String,
) -> impl FnMut() -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>> + Send>> {
    move || {
        let job_manager = job_manager.clone();
        let job_id = job_id.clone();
        Box::pin(async move {
            match job_manager.get_job(&job_id).await {
                Ok(Some(j)) => matches!(
                    j.status,
                    JobStatus::Completed
                        | JobStatus::Failed
                        | JobStatus::Stopped
                        | JobStatus::Timeout
                )
                .then(|| j.status.to_string()),
                _ => Some("Completed".to_string()),
            }
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct StreamLogsQuery {
    pub format: Option<String>,
    #[serde(rename = "since_line")]
    pub since_line: Option<usize>,
}

pub async fn stream_job_logs(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    Query(query): Query<StreamLogsQuery>,
) -> impl IntoResponse {
    let job_exists = match state.job_manager.get_job(&job_id).await {
        Ok(Some(_)) => true,
        _ => {
            find_log_file(&state.tendril_home, &job_id, ".raw.jsonl").is_some()
                || find_log_file(&state.tendril_home, &job_id, ".md").is_some()
                || find_log_file(&state.tendril_home, &job_id, ".eventwire.jsonl").is_some()
        }
    };

    if !job_exists {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Job not found" })),
        )
            .into_response();
    }

    let format_str = query.format.unwrap_or_else(|| "raw".to_string());
    let suffixes: &'static [&'static str] = match format_str.to_ascii_lowercase().as_str() {
        "markdown" => &[".md"],
        "eventwire" => &[".eventwire.jsonl"],
        _ => &[".raw.jsonl"],
    };

    let follower = LogFollower::new(state.tendril_home.clone(), job_id.clone(), suffixes);
    let probe = terminal_status_probe(state.job_manager.clone(), job_id);
    let shape = StreamShape {
        event_name: "log",
        since_line: query.since_line.unwrap_or(0),
        allowed_kinds: std::collections::HashSet::new(),
        end_data: |_status| "Job finished".to_string(),
    };

    let (tx, mut rx) = tokio::sync::mpsc::channel::<
        Result<axum::response::sse::Event, std::convert::Infallible>,
    >(64);

    tokio::spawn(pump_log_stream(
        tx,
        follower,
        shape,
        probe,
        LOG_POLL_INTERVAL,
    ));

    let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx));
    axum::response::sse::Sse::new(stream).into_response()
}

#[derive(Debug, Deserialize)]
pub struct JobEventsQuery {
    pub kinds: Option<String>,
    #[serde(rename = "since_line")]
    pub since_line: Option<usize>,
}

fn parse_allowed_kinds<'a, I: IntoIterator<Item = &'a str>>(
    kinds_values: I,
) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    for value in kinds_values {
        for part in value.split(',') {
            let trimmed = part.trim().to_ascii_lowercase();
            if !trimmed.is_empty() {
                if trimmed == "tool_use" {
                    set.insert("tool_use".to_string());
                    set.insert("tool_call".to_string());
                    set.insert("tool_result".to_string());
                } else {
                    set.insert(trimmed);
                }
            }
        }
    }
    set
}

fn matches_kinds(line: &str, allowed_kinds: &std::collections::HashSet<String>) -> bool {
    if allowed_kinds.is_empty() {
        return true;
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
        if let Some(k) = v.get("kind").and_then(|k| k.as_str()) {
            if allowed_kinds.contains(&k.to_ascii_lowercase()) {
                return true;
            }
        }
        if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
            if allowed_kinds.contains(&t.to_ascii_lowercase()) {
                return true;
            }
        }
    }
    false
}

pub async fn stream_job_events(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    Query(query): Query<JobEventsQuery>,
    Query(pairs): Query<Vec<(String, String)>>,
) -> impl IntoResponse {
    let job_exists = match state.job_manager.get_job(&job_id).await {
        Ok(Some(_)) => true,
        _ => {
            find_log_file(&state.tendril_home, &job_id, ".eventwire.jsonl").is_some()
                || find_log_file(&state.tendril_home, &job_id, ".raw.jsonl").is_some()
                || find_log_file(&state.tendril_home, &job_id, ".md").is_some()
        }
    };

    if !job_exists {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Job not found" })),
        )
            .into_response();
    }

    let kind_values = query.kinds.as_deref().into_iter().chain(
        pairs
            .iter()
            .filter(|(k, _)| k == "kind")
            .map(|(_, v)| v.as_str()),
    );
    let allowed_kinds = parse_allowed_kinds(kind_values);

    // Eventwire first, raw as the fallback for a job whose agent produced no structured events. Both
    // carry the same lines, so the choice is made once and kept; see [`LogFollower`].
    let follower = LogFollower::new(
        state.tendril_home.clone(),
        job_id.clone(),
        &[".eventwire.jsonl", ".raw.jsonl"],
    );
    let probe = terminal_status_probe(state.job_manager.clone(), job_id);
    let shape = StreamShape {
        event_name: "event",
        since_line: query.since_line.unwrap_or(0),
        allowed_kinds,
        end_data: |status| serde_json::json!({ "status": status }).to_string(),
    };

    let (tx, mut rx) = tokio::sync::mpsc::channel::<
        Result<axum::response::sse::Event, std::convert::Infallible>,
    >(64);

    tokio::spawn(pump_log_stream(
        tx,
        follower,
        shape,
        probe,
        LOG_POLL_INTERVAL,
    ));

    let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx));
    axum::response::sse::Sse::new(stream)
        .keep_alive(
            axum::response::sse::KeepAlive::new().interval(std::time::Duration::from_secs(15)),
        )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    /// The clear scopes `POST /api/jobs/clear` accepts, and the ones it will not.
    ///
    /// V1's menu exposes two of its service's generic predicate clear; the user wants one per status,
    /// so every terminal status is nameable here. What must never be nameable is work in flight.
    #[test]
    fn a_clear_scope_names_a_terminal_status_or_all_and_nothing_else() {
        // Every terminal status on its own, under V2's own name for it — which is the name the Status
        // column shows, so the menu label and the wire value agree.
        for status in CLEARABLE_STATUSES {
            assert_eq!(
                resolve_clear_scope(status.as_str()),
                Some(vec![*status]),
                "{status} must be clearable by name"
            );
        }
        // Case-insensitively, because the CLI sends lower case and the app sends the status name.
        assert_eq!(
            resolve_clear_scope("completed"),
            Some(vec![JobStatus::Completed])
        );
        assert_eq!(
            resolve_clear_scope("TIMEOUT"),
            Some(vec![JobStatus::Timeout])
        );

        // `all` is the whole clearable set, and `ALL` too.
        assert_eq!(
            resolve_clear_scope("all"),
            Some(CLEARABLE_STATUSES.to_vec())
        );
        assert_eq!(
            resolve_clear_scope("ALL"),
            Some(CLEARABLE_STATUSES.to_vec())
        );

        // Work in flight is a 400, not a silent no-op: a caller asking for it has misunderstood, and
        // the reply should say so. `Pending` and `Blocked` are here for the reason `CLEARABLE_STATUSES`
        // gives — a blocked job is waiting on a dependency, not history.
        for refused in ["running", "queued", "pending", "blocked", "", "everything"] {
            assert_eq!(
                resolve_clear_scope(refused),
                None,
                "{refused:?} must not be clearable"
            );
        }

        // And the error names what to send instead.
        let listed = clearable_scope_list();
        assert!(listed.starts_with("all, "), "{listed}");
        for status in CLEARABLE_STATUSES {
            assert!(listed.contains(status.as_str()), "{listed}");
        }
        assert!(!listed.contains("Running"), "{listed}");
        assert!(!listed.contains("Queued"), "{listed}");
    }

    fn temp_home(label: &str) -> std::path::PathBuf {
        let home = std::env::temp_dir().join(format!(
            "tendril-job-stream-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(home.join("Logs").join("Jobs")).expect("create log dir");
        home
    }

    fn append_eventwire(home: &std::path::Path, job_id: &str, line: &str) {
        let path = home
            .join("Logs")
            .join("Jobs")
            .join(format!("{job_id}.eventwire.jsonl"));
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .expect("open eventwire log");
        writeln!(f, "{line}").expect("append eventwire line");
    }

    /// The frames a pump produced, as readable text.
    ///
    /// `Event` exposes no accessor for its buffer, so its `Debug` is the only way in; the escaping it
    /// applies is undone here so an assertion can be written in terms of the wire bytes.
    fn frame_text(event: &axum::response::sse::Event) -> String {
        format!("{event:?}")
            .replace("\\\"", "\"")
            .replace("\\n", "\n")
    }

    fn drain(
        rx: &mut tokio::sync::mpsc::Receiver<
            Result<axum::response::sse::Event, std::convert::Infallible>,
        >,
    ) -> Vec<String> {
        let mut frames = Vec::new();
        while let Ok(Ok(event)) = rx.try_recv() {
            frames.push(frame_text(&event));
        }
        frames
    }

    fn shape() -> StreamShape {
        StreamShape {
            event_name: "event",
            since_line: 0,
            allowed_kinds: std::collections::HashSet::new(),
            end_data: |status| serde_json::json!({ "status": status }).to_string(),
        }
    }

    fn follower(home: &std::path::Path, job_id: &str) -> LogFollower {
        LogFollower::new(
            home.to_path_buf(),
            job_id.to_string(),
            &[".eventwire.jsonl", ".raw.jsonl"],
        )
    }

    /// The #132 regression. The hang-up check used to sit *inside* the "there is a line to send" loop,
    /// so a quiet long-running job never freed the task: an abandoned stream kept re-reading the whole
    /// log four times a second until the job ended, however long that took.
    ///
    /// The job here never becomes terminal, so a task that only notices a dropped client when it has
    /// something to send never returns and this test times out.
    #[tokio::test]
    async fn an_abandoned_stream_stops_as_soon_as_the_client_hangs_up() {
        let home = temp_home("abandoned");
        append_eventwire(&home, "00001", r#"{"kind":"text","text":"hello"}"#);

        let (tx, rx) = tokio::sync::mpsc::channel(64);
        let reads = Arc::new(AtomicUsize::new(0));
        let counted = reads.clone();

        let pump = tokio::spawn(pump_log_stream(
            tx,
            follower(&home, "00001"),
            shape(),
            move || {
                counted.fetch_add(1, Ordering::SeqCst);
                // Still running, forever.
                async { None }
            },
            Duration::from_millis(20),
        ));

        // Let it deliver the backlog and settle into polling, then walk away.
        tokio::time::sleep(Duration::from_millis(80)).await;
        drop(rx);

        tokio::time::timeout(Duration::from_secs(2), pump)
            .await
            .expect("the pump must end when the receiver is dropped")
            .expect("the pump must not panic");

        let settled = reads.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            reads.load(Ordering::SeqCst),
            settled,
            "no further polling after the client went away"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Every payload frame carries its log line index as the SSE `id:`. That is what makes a resume
    /// point expressible at all: without it a client has no way to name where it got to, and
    /// `since_line` — which the route has always accepted — could never be used.
    #[tokio::test]
    async fn frames_are_numbered_and_since_line_skips_the_prefix() {
        let home = temp_home("since-line");
        for i in 0..4 {
            append_eventwire(
                &home,
                "00002",
                &format!(r#"{{"kind":"text","text":"{i}"}}"#),
            );
        }

        let (tx, mut rx) = tokio::sync::mpsc::channel(64);
        let mut shape = shape();
        shape.since_line = 2;

        pump_log_stream(
            tx,
            follower(&home, "00002"),
            shape,
            || async { Some("Completed".to_string()) },
            Duration::from_millis(10),
        )
        .await;

        let frames = drain(&mut rx);

        // Two payload frames plus the `end` frame: the first two lines were read but not sent.
        assert_eq!(frames.len(), 3, "unexpected frames: {frames:?}");
        assert!(
            frames[0].contains("id: 2"),
            "unexpected frame: {}",
            frames[0]
        );
        assert!(
            frames[0].contains(r#""text":"2""#),
            "unexpected frame: {}",
            frames[0]
        );
        assert!(
            frames[1].contains("id: 3"),
            "unexpected frame: {}",
            frames[1]
        );
        assert!(
            frames[2].contains("event: end"),
            "unexpected frame: {}",
            frames[2]
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// A line index counts *log lines*, not delivered frames, so a filtered stream's resume point
    /// still lines up with the log. Numbering the frames instead would make `since_line` skip the
    /// wrong lines the moment `kinds` was used.
    #[tokio::test]
    async fn line_ids_count_log_lines_not_delivered_frames() {
        let home = temp_home("filtered-ids");
        append_eventwire(&home, "00003", r#"{"kind":"text","text":"a"}"#);
        append_eventwire(&home, "00003", r#"{"kind":"tool_call","tool_name":"git"}"#);
        append_eventwire(&home, "00003", r#"{"kind":"text","text":"b"}"#);

        let (tx, mut rx) = tokio::sync::mpsc::channel(64);
        let mut shape = shape();
        shape.allowed_kinds = parse_allowed_kinds(["text"]);

        pump_log_stream(
            tx,
            follower(&home, "00003"),
            shape,
            || async { Some("Failed".to_string()) },
            Duration::from_millis(10),
        )
        .await;

        let frames = drain(&mut rx);

        assert_eq!(frames.len(), 3, "unexpected frames: {frames:?}");
        assert!(
            frames[0].contains("id: 0"),
            "unexpected frame: {}",
            frames[0]
        );
        assert!(
            frames[1].contains("id: 2"),
            "the tool_call line was filtered out but still consumed line 1: {}",
            frames[1]
        );
        assert!(frames[2].contains(r#""status":"Failed""#));

        let _ = std::fs::remove_dir_all(&home);
    }

    /// A job that died mid-write still has its last line delivered: the terminal read takes the
    /// unterminated tail too, because nothing is going to finish it.
    #[tokio::test]
    async fn the_final_read_delivers_a_line_that_never_got_its_newline() {
        let home = temp_home("partial-tail");
        let path = home.join("Logs").join("Jobs").join("00004.eventwire.jsonl");
        std::fs::write(
            &path,
            "{\"kind\":\"text\",\"text\":\"whole\"}\n{\"kind\":\"tex",
        )
        .expect("write log");

        let (tx, mut rx) = tokio::sync::mpsc::channel(64);
        pump_log_stream(
            tx,
            follower(&home, "00004"),
            shape(),
            || async { Some("Stopped".to_string()) },
            Duration::from_millis(10),
        )
        .await;

        let frames = drain(&mut rx);
        assert_eq!(frames.len(), 3, "unexpected frames: {frames:?}");
        assert!(
            frames[0].contains(r#""text":"whole""#),
            "unexpected frame: {}",
            frames[0]
        );
        assert!(
            frames[1].contains(r#"data: {"kind":"tex"#),
            "the unterminated tail must still be delivered: {}",
            frames[1]
        );
        assert!(frames[2].contains("event: end"));

        let _ = std::fs::remove_dir_all(&home);
    }
}
