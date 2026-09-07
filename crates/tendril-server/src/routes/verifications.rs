use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::{load_config, save_config};
use tendril_core::models::VerificationConfig;

#[derive(Debug, Deserialize)]
pub struct CreateVerificationRequest {
    pub name: String,
    #[serde(default)]
    pub prompt: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateVerificationRequest {
    #[serde(default)]
    pub name: Option<String>,
    pub prompt: String,
}

pub async fn list_verifications(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    Json(settings.verifications)
}

pub async fn get_verification(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    if let Some(v) = settings
        .verifications
        .iter()
        .find(|v| v.name.eq_ignore_ascii_case(&name))
    {
        (StatusCode::OK, Json(v.clone())).into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Verification '{}' not found", name) })),
        )
            .into_response()
    }
}

pub async fn add_verification(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateVerificationRequest>,
) -> impl IntoResponse {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Verification name cannot be empty" })),
        )
            .into_response();
    }

    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    if settings
        .verifications
        .iter()
        .any(|v| v.name.eq_ignore_ascii_case(&name))
    {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": format!("Verification '{}' already exists", name) })),
        )
            .into_response();
    }

    let created = VerificationConfig {
        name,
        prompt: req.prompt,
    };
    settings.verifications.push(created.clone());

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(created)).into_response()
}

pub async fn update_verification(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<UpdateVerificationRequest>,
) -> impl IntoResponse {
    if let Some(new_name) = &req.name {
        if !new_name.eq_ignore_ascii_case(&name) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Verification name cannot be changed" })),
            )
                .into_response();
        }
    }

    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let idx = settings
        .verifications
        .iter()
        .position(|v| v.name.eq_ignore_ascii_case(&name));

    let Some(idx) = idx else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Verification '{}' not found", name) })),
        )
            .into_response();
    };

    settings.verifications[idx].prompt = req.prompt;
    let updated = settings.verifications[idx].clone();

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(updated)).into_response()
}

pub async fn delete_verification(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let idx = settings
        .verifications
        .iter()
        .position(|v| v.name.eq_ignore_ascii_case(&name));

    let Some(idx) = idx else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Verification '{}' not found", name) })),
        )
            .into_response();
    };

    let _removed = settings.verifications.remove(idx);

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({ "message": format!("Verification '{}' removed", name) })),
    )
        .into_response()
}
