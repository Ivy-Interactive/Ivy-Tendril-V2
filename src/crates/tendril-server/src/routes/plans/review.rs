//! Handlers for plan review surfaces: code changes, summary, and artifacts.

use super::lifecycle::effective_repos;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::git::build_plan_changes_data;
use tendril_core::plans::{read_plan_yaml, resolve_plan_folder};

/// `GET /api/plans/:id/changes` — file diffs and metrics for code changes made by the plan.
pub async fn plan_changes_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response()
        }
    };

    let (plan, _) = match read_plan_yaml(&folder) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read plan.yaml: {}", e) })),
            )
                .into_response()
        }
    };

    let repo_paths: Vec<PathBuf> = effective_repos(&state, &plan)
        .into_iter()
        .map(PathBuf::from)
        .collect();

    let data = build_plan_changes_data(&folder, &plan.commits, &repo_paths);
    (StatusCode::OK, Json(json!(data))).into_response()
}

/// `GET /api/plans/:id/summary` — reads `<planFolder>/Artifacts/summary.md` if present,
/// or synthesizes a diagnostic summary from the latest job when execution failed.
pub async fn plan_summary_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
) -> impl IntoResponse {
    let summary =
        tendril_core::plans::read_plan_summary(&state.tendril_home, &state.plans_dir, &plan_id);
    (StatusCode::OK, Json(json!({ "summary": summary }))).into_response()
}

/// `GET /api/plans/:id/artifacts` — lists screenshot and other files in `<planFolder>/Artifacts`.
pub async fn plan_artifacts_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
) -> impl IntoResponse {
    let artifacts = tendril_core::plans::read_plan_artifacts(&state.plans_dir, &plan_id);
    (
        StatusCode::OK,
        Json(json!({
            "screenshots": artifacts.screenshots,
            "other": artifacts.other,
        })),
    )
        .into_response()
}
