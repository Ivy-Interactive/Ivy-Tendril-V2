use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::db::{open_database, CostsFilter};

#[derive(Debug, Deserialize)]
pub struct CostsSummaryQuery {
    pub project: Option<String>,
    pub promptware: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CostsSeriesQuery {
    pub period: Option<String>,
    pub project: Option<String>,
    pub promptware: Option<String>,
}

pub async fn get_costs_summary(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CostsSummaryQuery>,
) -> impl IntoResponse {
    let filter = CostsFilter {
        project: query.project,
        promptware: query.promptware,
    };
    match open_database(&state.db_path) {
        Ok(conn) => match tendril_core::db::get_costs_summary(&conn, &filter) {
            Ok(summary) => (StatusCode::OK, Json(json!(summary))),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to get costs summary: {}", e) })),
            ),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to open database: {}", e) })),
        ),
    }
}

pub async fn get_costs_series(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CostsSeriesQuery>,
) -> impl IntoResponse {
    let period = query.period.as_deref().unwrap_or("daily");
    let filter = CostsFilter {
        project: query.project,
        promptware: query.promptware,
    };
    match open_database(&state.db_path) {
        Ok(conn) => match tendril_core::db::get_costs_series(&conn, period, &filter) {
            Ok(series) => (StatusCode::OK, Json(json!(series))),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to get costs series: {}", e) })),
            ),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to open database: {}", e) })),
        ),
    }
}
