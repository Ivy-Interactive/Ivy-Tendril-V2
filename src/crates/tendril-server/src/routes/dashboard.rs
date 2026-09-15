//! Dashboard analytics endpoints, alongside the existing `/api/costs/*` pair.
//!
//! The forecast is computed here rather than in the client, so the projection has exactly one
//! implementation. The rolling average is *not*: it needs the same 736-day series the trend chart
//! already receives, and shipping it separately would double the payload.

use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tendril_core::analytics::{forecast, CostForecast};
use tendril_core::db::{open_database, DashboardActivityStats};

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    pub months: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct DaysQuery {
    pub days: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct LimitQuery {
    pub limit: Option<i64>,
}

/// The activity stats with the month's projection alongside them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityResponse {
    #[serde(flatten)]
    stats: DashboardActivityStats,
    forecast: CostForecast,
}

pub async fn get_activity(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ActivityQuery>,
) -> impl IntoResponse {
    // 24 is the original's `GetActivityStats` default.
    let months = query.months.unwrap_or(24);
    match open_database(&state.db_path) {
        Ok(conn) => match tendril_core::db::get_activity_stats(&conn, months) {
            Ok(stats) => {
                let forecast = forecast::project(&stats.daily_costs, Utc::now().date_naive());
                (
                    StatusCode::OK,
                    Json(json!(ActivityResponse { stats, forecast })),
                )
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to get dashboard activity: {}", e) })),
            ),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to open database: {}", e) })),
        ),
    }
}

pub async fn get_shipped_features(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DaysQuery>,
) -> impl IntoResponse {
    let days = query.days.unwrap_or(60);
    match open_database(&state.db_path) {
        Ok(conn) => match tendril_core::db::get_shipped_features_by_day(&conn, days) {
            Ok(shipped) => (StatusCode::OK, Json(json!(shipped))),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to get shipped features: {}", e) })),
            ),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to open database: {}", e) })),
        ),
    }
}

pub async fn get_merged_prs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LimitQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50);
    match open_database(&state.db_path) {
        Ok(conn) => match tendril_core::db::get_recent_merged_prs(&conn, limit) {
            Ok(prs) => (StatusCode::OK, Json(json!(prs))),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to get merged PRs: {}", e) })),
            ),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to open database: {}", e) })),
        ),
    }
}

pub async fn get_plan_costs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DaysQuery>,
) -> impl IntoResponse {
    let days = query.days.unwrap_or(7);
    match open_database(&state.db_path) {
        Ok(conn) => match tendril_core::db::get_recent_plan_costs(&conn, days) {
            Ok(costs) => (StatusCode::OK, Json(json!(costs))),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to get plan costs: {}", e) })),
            ),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to open database: {}", e) })),
        ),
    }
}

pub async fn get_agent_costs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DaysQuery>,
) -> impl IntoResponse {
    let days = query.days.unwrap_or(30);
    match open_database(&state.db_path) {
        Ok(conn) => match tendril_core::db::get_agent_cost_breakdown(&conn, days) {
            Ok(breakdown) => (StatusCode::OK, Json(json!(breakdown))),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to get agent cost breakdown: {}", e) })),
            ),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to open database: {}", e) })),
        ),
    }
}
