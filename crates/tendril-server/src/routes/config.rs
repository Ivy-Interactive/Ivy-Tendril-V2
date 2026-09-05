use std::sync::Arc;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use tendril_core::config::{load_config, save_config, TendrilSettings};
use crate::state::AppState;

pub async fn get_config_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    Json(settings)
}

pub async fn put_config_handler(
    State(state): State<Arc<AppState>>,
    Json(new_settings): Json<TendrilSettings>,
) -> impl IntoResponse {
    match save_config(&state.config_path, &new_settings) {
        Ok(_) => (StatusCode::OK, Json(json!({ "status": "ok", "message": "Config updated" }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("Failed to save config: {}", e) }))),
    }
}
