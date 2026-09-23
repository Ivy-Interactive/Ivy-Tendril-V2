//! Handlers for plan review surfaces: code changes, summary, and artifacts.

use super::lifecycle::effective_repos;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::git::build_plan_changes_data;
use tendril_core::plans::{
    read_plan_artifact, read_plan_yaml, resolve_plan_folder, PlanArtifactReadError,
};

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

#[derive(Debug, Deserialize)]
pub struct ArtifactContentQuery {
    /// The artifact's absolute path, exactly as `GET /api/plans/:id/artifacts` listed it.
    pub path: String,
}

/// `GET /api/plans/:id/artifacts/content?path=` — one artifact's text, for the Review app's artifact
/// sheet (V1's `artifactContentQuery` in `Review/ContentView.cs`).
///
/// The answer is `{ "kind": "text", "text", "size" }`, or `binary` / `tooLarge` with only a size when
/// there is nothing to show inline. A path outside the plan's `Artifacts` folder is `400`, a missing
/// plan or file `404`. See [`tendril_core::plans::read_plan_artifact`] for the containment rule.
///
/// Not reachable over a share: `share_token_allows` is deny-by-default and does not list it, the same
/// as the listing above.
pub async fn plan_artifact_content_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Query(query): Query<ArtifactContentQuery>,
) -> impl IntoResponse {
    match read_plan_artifact(&state.plans_dir, &plan_id, &query.path) {
        Ok(content) => (StatusCode::OK, Json(json!(content))).into_response(),
        Err(err) => {
            let status = match err {
                PlanArtifactReadError::PlanNotFound(_) | PlanArtifactReadError::NotFound(_) => {
                    StatusCode::NOT_FOUND
                }
                PlanArtifactReadError::OutsideArtifacts(_) => StatusCode::BAD_REQUEST,
                PlanArtifactReadError::Io(..) => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (status, Json(json!({ "error": err.to_string() }))).into_response()
        }
    }
}
