use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::error::TendrilError;
use tendril_core::models::{CreatePlanArgs, JobArgs};

#[derive(Debug, Deserialize)]
pub struct CreatePlanRequest {
    pub description: String,
    pub project: Option<String>,
    #[serde(rename = "sourcePath")]
    pub source_path: Option<String>,
    /// "Yes, create another plan for this same description." Without it, resubmitting an identical
    /// body is a 409 naming the `CreatePlan` job already in flight, not a second plan. It also feeds
    /// the `Force` firmware header, which is what makes the promptware skip its own plan-level
    /// duplicate detection.
    #[serde(default)]
    pub force: bool,
}

pub async fn post_inbox(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePlanRequest>,
) -> impl IntoResponse {
    if req.description.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Description is required" })),
        );
    }

    let project = req.project.unwrap_or_else(|| "Auto".to_string());
    let args = JobArgs::CreatePlan(CreatePlanArgs {
        description: req.description,
        project,
        priority: 0,
        force: req.force,
        source_path: req.source_path,
        upload_session_id: None,
    });

    match state.job_manager.start_job(args).await {
        Ok(job_id) => (
            StatusCode::OK,
            Json(json!({
                "jobId": job_id,
                "status": "Started",
                "message": "Plan creation job started successfully"
            })),
        ),
        // The same description already being planned is a repeat submission, not a server fault.
        Err(TendrilError::DuplicateJob(msg)) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": msg, "status": "Conflict" })),
        ),
        Err(TendrilError::Conflict(msg)) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": msg, "status": "Conflict" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to start plan creation: {}", e) })),
        ),
    }
}
