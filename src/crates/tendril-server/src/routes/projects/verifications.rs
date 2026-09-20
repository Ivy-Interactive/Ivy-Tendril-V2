//! A project's verification steps: adding one at a chosen position, moving it, removing it.

use super::payloads::VerificationInput;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::{
    insert_project_verification, load_config, move_project_verification, save_config,
    VerificationPlacement,
};
use tendril_core::models::ProjectVerificationRef;

pub async fn add_project_verification(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(input): Json<VerificationInput>,
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

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let after = input.after().map(|s| s.to_string());
    let ver_ref: ProjectVerificationRef = input.into();
    if ver_ref.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Verification name cannot be empty" })),
        )
            .into_response();
    }

    if let Some(existing) = settings.projects[proj_idx]
        .verifications
        .iter_mut()
        .find(|v| v.name.eq_ignore_ascii_case(&ver_ref.name))
    {
        existing.required = ver_ref.required;
        let updated = existing.clone();
        if let Err(e) = save_config(&state.config_path, &settings) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to save config: {}", e) })),
            )
                .into_response();
        }
        return (StatusCode::OK, Json(json!(updated))).into_response();
    }

    if let Err(e) = insert_project_verification(
        &mut settings.projects[proj_idx],
        ver_ref.clone(),
        after.as_deref(),
    ) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
            .into_response();
    }

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(json!(ver_ref))).into_response()
}

#[derive(Debug, Deserialize)]
pub struct MoveVerificationRequest {
    pub name: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub position: Option<usize>,
}

/// Reorders a project's verifications. Verifications run in configured order, so this is how a
/// caller says "this one runs before that one".
pub async fn move_project_verification_route(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<MoveVerificationRequest>,
) -> impl IntoResponse {
    let placement = match (&req.before, &req.after, req.position) {
        (Some(target), None, None) => VerificationPlacement::Before(target.clone()),
        (None, Some(target), None) => VerificationPlacement::After(target.clone()),
        (None, None, Some(pos)) => VerificationPlacement::Position(pos),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Specify exactly one of before, after, or position" })),
            )
                .into_response();
        }
    };

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

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let index =
        match move_project_verification(&mut settings.projects[proj_idx], &req.name, &placement) {
            Ok(idx) => idx,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": e.to_string() })),
                )
                    .into_response();
            }
        };

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "name": req.name,
            "position": index,
            "verifications": settings.projects[proj_idx].verifications,
        })),
    )
        .into_response()
}

pub async fn remove_project_verification(
    State(state): State<Arc<AppState>>,
    Path((name, verification)): Path<(String, String)>,
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

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    settings.projects[proj_idx]
        .verifications
        .retain(|v| !v.name.eq_ignore_ascii_case(&verification));

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Verification '{}' removed from project '{}'", verification, name)
        })),
    )
        .into_response()
}
