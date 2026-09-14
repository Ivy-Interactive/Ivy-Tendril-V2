//! The cross-plan recommendation surface.
//!
//! Per-plan recommendation routes live under `/api/plans/:id/recommendations` in
//! [`super::plans`] and write `plan.yaml`, which is the source of truth. The two routes here read the
//! denormalised `Recommendations` projection instead, because "every open recommendation across all
//! plans" cannot be answered from one plan's YAML.

use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::db::{get_recommendations, open_database, rebuild_recommendations_projection};
use tendril_core::db::RecommendationRow;

#[derive(Debug, Deserialize)]
pub struct RecommendationsQuery {
    pub project: Option<String>,
    pub state: Option<String>,
}

/// One projection row as camelCase JSON. `planId` is zero-padded to five digits, the form every other
/// plan reference in Tendril uses, so a caller can link straight to the owning plan.
fn row_json(row: &RecommendationRow) -> serde_json::Value {
    json!({
        "planId": format!("{:05}", row.plan_id),
        "planTitle": row.plan_title,
        "planFolderName": row.plan_folder_name,
        "project": row.project,
        "sourcePlanStatus": row.source_plan_status,
        "date": row.date,
        "title": row.title,
        "description": row.description,
        "state": row.state,
        "declineReason": row.decline_reason,
        "notes": row.notes,
        "impact": row.impact,
    })
}

/// `GET /api/recommendations?project=<name>&state=<state>`
pub async fn list_recommendations(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RecommendationsQuery>,
) -> impl IntoResponse {
    let conn = match open_database(&state.db_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to open database: {}", e) })),
            )
        }
    };

    match get_recommendations(&conn, query.project.as_deref(), query.state.as_deref()) {
        Ok(rows) => {
            let body: Vec<serde_json::Value> = rows.iter().map(row_json).collect();
            (StatusCode::OK, Json(json!(body)))
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to list recommendations: {}", e) })),
        ),
    }
}

/// `POST /api/recommendations/rebuild` — rebuilds the projection from the plan folders on disk.
pub async fn rebuild_recommendations(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let conn = match open_database(&state.db_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to open database: {}", e) })),
            )
        }
    };

    match rebuild_recommendations_projection(&conn, &state.plans_dir) {
        Ok((rows, plans)) => (
            StatusCode::OK,
            Json(json!({ "recommendations": rows, "plans": plans })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to rebuild recommendations: {}", e) })),
        ),
    }
}
