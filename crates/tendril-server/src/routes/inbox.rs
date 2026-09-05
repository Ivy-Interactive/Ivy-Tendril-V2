use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::models::{CreatePlanArgs, JobArgs};

#[derive(Debug, Deserialize)]
pub struct CreatePlanRequest {
    pub description: String,
    pub project: Option<String>,
    #[serde(rename = "sourcePath")]
    pub source_path: Option<String>,
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
        force: false,
        source_path: req.source_path,
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
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to start plan creation: {}", e) })),
        ),
    }
}
