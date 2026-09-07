use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::{load_config, update_config_raw};

pub async fn get_config_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    Json(settings)
}

pub async fn put_config_handler(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<serde_json::Value>,
) -> impl IntoResponse {
    match update_config_raw(&state.config_path, &incoming) {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({ "status": "ok", "message": "Config updated" })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Failed to update config: {}", e) })),
        ),
    }
}
