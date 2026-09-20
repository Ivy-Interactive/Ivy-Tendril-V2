//! A plan's recommendations: the list, its content edits, and the accept/decline lifecycle.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::db::{open_database, sync_plan};
use tendril_core::error::TendrilError;
use tendril_core::models::RecommendationStatus;
use tendril_core::plans::{
    accept_recommendation, add_recommendation, decline_recommendation, list_recommendations,
    read_plan_file, remove_recommendation, resolve_plan_folder, set_recommendation_field,
    set_recommendation_state,
};

// --- Recommendations Handlers ---

#[derive(Debug, Deserialize)]
pub struct AddRecommendationBody {
    pub title: String,
    pub description: String,
    pub impact: Option<String>,
}

/// Body of `PUT /api/plans/:id/recommendations/:title`. Every field is optional so the two shapes
/// coexist: `{field, value}` edits one field of the recommendation, while `{state, declineReason}` is
/// the state-only contract the desktop app and the contract tests already send.
#[derive(Debug, Deserialize)]
pub struct UpdateRecommendationBody {
    pub state: Option<String>,
    #[serde(rename = "declineReason")]
    pub decline_reason: Option<String>,
    pub notes: Option<String>,
    pub field: Option<String>,
    pub value: Option<String>,
}

/// Body of `PUT /api/plans/:id/recommendations/:title/accept`. The notes are optional, and so is the
/// body itself.
#[derive(Debug, Default, Deserialize)]
pub struct AcceptRecommendationBody {
    pub notes: Option<String>,
}

/// Body of `PUT /api/plans/:id/recommendations/:title/decline`.
#[derive(Debug, Default, Deserialize)]
pub struct DeclineRecommendationBody {
    pub reason: Option<String>,
}

pub async fn list_recommendations_handler(
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
                .into_response();
        }
    };

    match list_recommendations(&folder) {
        Ok(recs) => (StatusCode::OK, Json(json!(recs))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to list recommendations: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn add_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<AddRecommendationBody>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response();
        }
    };

    match add_recommendation(
        &folder,
        &body.title,
        &body.description,
        body.impact.as_deref(),
    ) {
        Ok(_) => {
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::CREATED,
                Json(json!({
                    "title": body.title,
                    "description": body.description,
                    "impact": body.impact,
                    "state": "Pending"
                })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Failed to add recommendation: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn update_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, title)): Path<(String, String)>,
    Json(body): Json<UpdateRecommendationBody>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response();
        }
    };

    // `{field, value}` edits content, `{state, ...}` moves the recommendation through its lifecycle.
    // Neither is a 404 case, so the failure modes are distinguished below rather than collapsed into
    // one status the way this handler used to.
    let result = match (body.field.as_deref(), body.state.as_deref()) {
        (Some(field), _) => {
            let Some(value) = body.value.as_deref() else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Field edits require a 'value'" })),
                )
                    .into_response();
            };
            set_recommendation_field(&folder, &title, field, value)
        }
        (None, Some(new_state)) => set_recommendation_state(
            &folder,
            &title,
            new_state,
            body.notes.as_deref().or(body.decline_reason.as_deref()),
        ),
        (None, None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Provide either 'field' and 'value', or 'state'" })),
            )
                .into_response();
        }
    };

    match result {
        Ok(_) => {
            sync_plan_folder(&state, &folder);
            (
                StatusCode::OK,
                Json(json!({ "message": "Recommendation updated" })),
            )
                .into_response()
        }
        Err(e) => recommendation_error_response(e, "update"),
    }
}

/// Syncs a plan folder into the database, best-effort. Every recommendation write path ends here,
/// which is what keeps the `Recommendations` projection in step with `plan.yaml`.
fn sync_plan_folder(state: &Arc<AppState>, folder: &std::path::Path) {
    if let Ok(pf) = read_plan_file(folder) {
        if let Ok(conn) = open_database(&state.db_path) {
            let _ = sync_plan(&conn, &pf);
        }
    }
}

/// Maps a recommendation write failure onto a status code. The core layer reports all of these as
/// `TendrilError::Plan`, so the message is what distinguishes them: a missing recommendation is a
/// `404`, a rename onto an existing title is a `409`, and an invalid field, state or impact is a
/// `400`.
fn recommendation_error_response(e: TendrilError, verb: &str) -> axum::response::Response {
    let message = e.to_string();
    let status = if message.contains("not found") {
        StatusCode::NOT_FOUND
    } else if message.contains("already exists") {
        StatusCode::CONFLICT
    } else {
        StatusCode::BAD_REQUEST
    };

    (
        status,
        Json(json!({ "error": format!("Failed to {} recommendation: {}", verb, message) })),
    )
        .into_response()
}

/// `PUT /api/plans/:id/recommendations/:title/accept` — accepts a recommendation, storing any notes.
/// The response echoes the state it landed in, so the caller sees whether the notes promoted it to
/// `AcceptedWithNotes`.
pub async fn accept_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, title)): Path<(String, String)>,
    body: Option<Json<AcceptRecommendationBody>>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response();
        }
    };

    let notes = body.and_then(|Json(b)| b.notes);

    match accept_recommendation(&folder, &title, notes.as_deref()) {
        Ok(new_state) => {
            sync_plan_folder(&state, &folder);
            (StatusCode::OK, Json(json!({ "state": new_state }))).into_response()
        }
        Err(e) => recommendation_error_response(e, "accept"),
    }
}

/// `PUT /api/plans/:id/recommendations/:title/decline` — declines a recommendation with an optional
/// reason.
pub async fn decline_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, title)): Path<(String, String)>,
    body: Option<Json<DeclineRecommendationBody>>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response();
        }
    };

    let reason = body.and_then(|Json(b)| b.reason);

    match decline_recommendation(&folder, &title, reason.as_deref()) {
        Ok(_) => {
            sync_plan_folder(&state, &folder);
            (
                StatusCode::OK,
                Json(json!({ "state": RecommendationStatus::DECLINED })),
            )
                .into_response()
        }
        Err(e) => recommendation_error_response(e, "decline"),
    }
}

pub async fn delete_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, title)): Path<(String, String)>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response();
        }
    };

    match remove_recommendation(&folder, &title) {
        Ok(_) => {
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::OK,
                Json(json!({ "message": "Recommendation removed" })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Failed to remove recommendation: {}", e) })),
        )
            .into_response(),
    }
}
