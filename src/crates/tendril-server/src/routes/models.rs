use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::agents::model_cache;
use tendril_core::agents::model_specs;

/// Returns the active model catalog: models.dev-enriched entries merged with the
/// curated static `ModelSpec` table (static fallback when no enrichment is cached).
pub async fn list_models(State(_state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(model_specs::all_specs())
}

/// Manually triggers a synchronous refresh of the models.dev cache.
pub async fn refresh_models(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("failed to build http client: {err}") })),
            );
        }
    };

    match model_cache::fetch_live_models(&client, &state.tendril_home).await {
        Ok(count) => (
            StatusCode::OK,
            Json(json!({ "status": "ok", "modelsUpdated": count })),
        ),
        Err(err) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": format!("failed to refresh models.dev cache: {err}") })),
        ),
    }
}
