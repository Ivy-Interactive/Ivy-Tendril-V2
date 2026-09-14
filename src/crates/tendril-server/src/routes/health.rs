use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use tendril_core::config::default_capabilities;

pub async fn health_handler() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "pid": std::process::id(),
        "version": env!("CARGO_PKG_VERSION"),
        "apiVersion": 1,
        "capabilities": default_capabilities()
    }))
}
