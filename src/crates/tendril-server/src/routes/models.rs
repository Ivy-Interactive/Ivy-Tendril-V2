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
use tendril_core::config::load_config;

/// Returns the active model catalog: models.dev-enriched entries merged with the
/// curated static `ModelSpec` table (static fallback when no enrichment is cached).
pub async fn list_models(State(_state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(model_specs::all_specs())
}

fn models_status_body(
    tendril_home: &std::path::Path,
    config_path: &std::path::Path,
) -> serde_json::Value {
    let dynamic_count = model_specs::dynamic_specs_count();
    let static_count = model_specs::SPECS.len();
    let total_count = model_specs::all_specs().len();
    let enrich_models = load_config(config_path).unwrap_or_default().enrich_models;
    let status = model_cache::cache_status(tendril_home);

    json!({
        "source": if dynamic_count > 0 { "models.dev" } else { "static" },
        "totalModelCount": total_count,
        "dynamicModelCount": dynamic_count,
        "staticModelCount": static_count,
        "enrichModels": enrich_models,
        "cachedAt": status.cached_at,
        "cachePath": status.path.display().to_string(),
    })
}

/// Reports whether the active catalog is models.dev-enriched or static, plus cache staleness.
pub async fn models_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(models_status_body(&state.tendril_home, &state.config_path))
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
        Ok(count) => {
            let mut body = models_status_body(&state.tendril_home, &state.config_path);
            body["status"] = json!("ok");
            body["modelsUpdated"] = json!(count);
            (StatusCode::OK, Json(body))
        }
        Err(err) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": format!("failed to refresh models.dev cache: {err}") })),
        ),
    }
}
