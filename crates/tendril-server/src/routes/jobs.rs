use std::sync::Arc;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use tendril_core::models::{JobArgs, JobStatus};
use crate::state::AppState;

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
        .update_job_status(&job_id, &req.message, req.plan_id.as_deref(), req.plan_title.as_deref())
        .await
    {
        Ok(true) => (StatusCode::OK, Json(json!({ "status": "Updated" }))),
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({ "error": "Job not found" }))),
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
    let _ = state.job_manager.report_job_failure(&job_id, &req.message).await;
    if req.stop {
        let _ = state.job_manager.cancel_job(&job_id, Some(&req.message)).await;
    }
    (StatusCode::OK, Json(json!({ "status": "Failure reported" })))
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
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({ "error": "Job not found" }))),
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
    match state.job_manager.add_log(&job_id, &req.action, req.summary.as_deref()) {
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
