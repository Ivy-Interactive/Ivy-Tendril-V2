//! A plan's revision bodies: reading one, appending a new one, and overwriting the newest in place.

use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::db::{open_database, sync_plan};
use tendril_core::error::TendrilError;
use tendril_core::plans::{
    get_revision, read_plan_file, read_plan_yaml, resolve_plan_folder, update_latest_revision,
    write_plan_yaml, write_revision,
};

#[derive(Debug, Deserialize)]
pub struct RevisionQuery {
    pub number: Option<i32>,
}

pub async fn get_revision_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Query(query): Query<RevisionQuery>,
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

    match get_revision(&folder, query.number) {
        Ok(content) => content.into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Failed to get revision: {}", e) })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct WriteRevisionBody {
    pub content: String,
    #[serde(default)]
    pub no_question_check: bool,
}

pub async fn write_revision_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<WriteRevisionBody>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
        }
    };

    match write_revision(&folder, &body.content, !body.no_question_check) {
        Ok(rev_num) => {
            // Update plan timestamp and sync to db
            if let Ok((mut plan, _)) = read_plan_yaml(&folder) {
                plan.updated = Utc::now();
                let _ = write_plan_yaml(&folder, &plan);
            }
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::OK,
                Json(json!({
                    "revision": rev_num,
                    "message": format!("Revision {:03} written", rev_num)
                })),
            )
        }
        Err(TendrilError::Validation(e)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Validation failed: {}", e) })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write revision: {}", e) })),
        ),
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateLatestRevisionBody {
    pub content: String,
}

/// Overwrites the newest revision in place, keeping its number.
///
/// This is the route answering a question needs, and it is deliberately not the `POST` above.
/// Answering a question is not a new revision of the plan, it is filling in a blank the plan left —
/// V1 says so and routes answers through `UpdateLatestRevision` for that reason. Appending would
/// claim the agent produced a new plan, and would inflate `revisionCount`, which the client's
/// unfolded-answer guard reads as `revisionCount === 1`; one answer would switch that guard off.
///
/// `revision` comes back unchanged so a caller can assert nothing moved.
pub async fn update_latest_revision_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<UpdateLatestRevisionBody>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
        }
    };

    match update_latest_revision(&folder, &body.content) {
        Ok(rev_num) => {
            // `updated` moves because the plan's content changed, but the revision count does not —
            // which is the whole point of this route, so `sync_plan` must run to refresh the row
            // without it appearing to gain a revision.
            if let Ok((mut plan, _)) = read_plan_yaml(&folder) {
                plan.updated = Utc::now();
                let _ = write_plan_yaml(&folder, &plan);
            }
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::OK,
                Json(json!({
                    "revision": rev_num,
                    "message": format!("Revision {:03} updated", rev_num)
                })),
            )
        }
        Err(TendrilError::Validation(e)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Validation failed: {}", e) })),
        ),
        // "no revision to update" is the caller asking to fill a blank in a plan that has no body
        // yet. That is a bad request, not a server fault.
        Err(TendrilError::Plan(e)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to update revision: {}", e) })),
        ),
    }
}
