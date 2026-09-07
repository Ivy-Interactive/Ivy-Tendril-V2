use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::jobs::{find_log_file, read_eventwire_log, read_job_log, read_raw_log};
use tendril_core::models::{JobArgs, JobStatus};

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

pub async fn start_job(
    State(state): State<Arc<AppState>>,
    Json(args): Json<JobArgs>,
) -> impl IntoResponse {
    match state.job_manager.start_job(args).await {
        Ok(job_id) => (
            StatusCode::OK,
            Json(json!({ "jobId": job_id, "status": "Started" })),
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
    let suffix = match format_str.to_ascii_lowercase().as_str() {
        "markdown" => ".md",
        "eventwire" => ".eventwire.jsonl",
        _ => ".raw.jsonl",
    };

    let tendril_home = state.tendril_home.clone();
    let job_manager = state.job_manager.clone();
    let since_line = query.since_line.unwrap_or(0);

    let (tx, mut rx) = tokio::sync::mpsc::channel::<
        Result<axum::response::sse::Event, std::convert::Infallible>,
    >(64);

    tokio::spawn(async move {
        let mut emitted_lines = 0usize;

        loop {
            let lines = match suffix {
                ".raw.jsonl" => read_raw_log(&tendril_home, &job_id, None)
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                ".eventwire.jsonl" => read_eventwire_log(&tendril_home, &job_id, None)
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                _ => match read_job_log(&tendril_home, &job_id) {
                    Ok(Some(c)) => c.lines().map(|s| s.to_string()).collect(),
                    _ => Vec::new(),
                },
            };

            while emitted_lines < lines.len() {
                if emitted_lines >= since_line {
                    let event = axum::response::sse::Event::default()
                        .event("log")
                        .data(&lines[emitted_lines]);
                    if tx.send(Ok(event)).await.is_err() {
                        return;
                    }
                }
                emitted_lines += 1;
            }

            let is_terminal = match job_manager.get_job(&job_id).await {
                Ok(Some(j)) => matches!(
                    j.status,
                    JobStatus::Completed
                        | JobStatus::Failed
                        | JobStatus::Stopped
                        | JobStatus::Timeout
                ),
                _ => true,
            };

            if is_terminal {
                let final_lines = match suffix {
                    ".raw.jsonl" => read_raw_log(&tendril_home, &job_id, None)
                        .ok()
                        .flatten()
                        .unwrap_or_default(),
                    ".eventwire.jsonl" => read_eventwire_log(&tendril_home, &job_id, None)
                        .ok()
                        .flatten()
                        .unwrap_or_default(),
                    _ => match read_job_log(&tendril_home, &job_id) {
                        Ok(Some(c)) => c.lines().map(|s| s.to_string()).collect(),
                        _ => Vec::new(),
                    },
                };
                while emitted_lines < final_lines.len() {
                    if emitted_lines >= since_line {
                        let event = axum::response::sse::Event::default()
                            .event("log")
                            .data(&final_lines[emitted_lines]);
                        if tx.send(Ok(event)).await.is_err() {
                            return;
                        }
                    }
                    emitted_lines += 1;
                }

                let end_event = axum::response::sse::Event::default()
                    .event("end")
                    .data("Job finished");
                let _ = tx.send(Ok(end_event)).await;
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
        }
    });

    let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx));
    axum::response::sse::Sse::new(stream).into_response()
}
