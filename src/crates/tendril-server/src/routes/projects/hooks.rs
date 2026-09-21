//! A project's promptware hooks.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::{load_config, save_config};
use tendril_core::models::PromptwareHookConfig;

#[derive(Debug, Deserialize)]
pub struct AddHookRequest {
    pub name: String,
    #[serde(default = "default_hook_when")]
    pub when: String,
    #[serde(default)]
    pub promptwares: Vec<String>,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub action: String,
}

fn default_hook_when() -> String {
    "before".to_string()
}

/// Adds or replaces a project hook, keyed by name — the same upsert as
/// [`add_project_review_action`](super::review_actions::add_project_review_action), so
/// re-running the request does not accumulate duplicates.
///
/// An unrecognised `when` is rejected here rather than stored: the config model treats it as
/// matching no phase, which would leave the caller with a hook that silently never fires.
pub async fn add_project_hook(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<AddHookRequest>,
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

    let hook_name = req.name.trim().to_string();
    if hook_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Hook name cannot be empty" })),
        )
            .into_response();
    }

    let when = req.when.trim().to_ascii_lowercase();
    if when != "before" && when != "after" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Hook 'when' must be 'before' or 'after', got '{}'", req.when)
            })),
        )
            .into_response();
    }

    let hooks = &mut settings.projects[proj_idx].hooks;
    hooks.retain(|h| !h.name.eq_ignore_ascii_case(&hook_name));
    hooks.push(PromptwareHookConfig {
        name: hook_name.clone(),
        when,
        promptwares: req.promptwares,
        condition: req.condition,
        action: req.action,
        extra: Default::default(),
    });

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
            "message": format!("Hook '{}' added to project '{}'", hook_name, name)
        })),
    )
        .into_response()
}

pub async fn remove_project_hook(
    State(state): State<Arc<AppState>>,
    Path((name, hook)): Path<(String, String)>,
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

    let before = settings.projects[proj_idx].hooks.len();
    settings.projects[proj_idx]
        .hooks
        .retain(|h| !h.name.eq_ignore_ascii_case(&hook));

    if settings.projects[proj_idx].hooks.len() == before {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": format!("Hook '{}' not found in project '{}'", hook, name)
            })),
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

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Hook '{}' removed from project '{}'", hook, name)
        })),
    )
        .into_response()
}
