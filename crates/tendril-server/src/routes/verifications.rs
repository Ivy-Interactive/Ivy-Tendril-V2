use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::{load_config, save_config};
use tendril_core::db::open_database;
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
    #[serde(rename = "newName", alias = "new_name")]
    pub new_name: Option<String>,
    pub prompt: Option<String>,
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

    let rename_target = req.new_name.or(req.name);
    let mut renamed_to: Option<String> = None;
    if let Some(target) = rename_target {
        let trimmed = target.trim().to_string();
        if trimmed.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Verification name cannot be empty" })),
            )
                .into_response();
        }

        if !trimmed.eq_ignore_ascii_case(&name) {
            if settings
                .verifications
                .iter()
                .any(|v| v.name.eq_ignore_ascii_case(&trimmed))
            {
                return (
                    StatusCode::CONFLICT,
                    Json(json!({ "error": format!("Verification '{}' already exists", trimmed) })),
                )
                    .into_response();
            }

            settings.verifications[idx].name = trimmed.clone();

            for p in &mut settings.projects {
                for v in &mut p.verifications {
                    if v.name.eq_ignore_ascii_case(&name) {
                        v.name = trimmed.clone();
                    }
                }
            }

            renamed_to = Some(trimmed);
        }
    }

    if let Some(prompt) = req.prompt {
        settings.verifications[idx].prompt = prompt;
    }

    let updated = settings.verifications[idx].clone();

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    if let Some(new_name) = renamed_to {
        let _ =
            tendril_core::plans::rename_verification_in_plans(&state.plans_dir, &name, &new_name);
        if let Ok(conn) = open_database(&state.db_path) {
            let _ = tendril_core::db::rename_verification(&conn, &name, &new_name);
        }
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
