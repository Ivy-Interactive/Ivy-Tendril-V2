//! A project's repositories — adding, removing, and the sync pass that refreshes them.

use super::cloning::{clone_error_response, materialize_repos, remove_cloned_repos};
use super::payloads::RepoInput;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::{load_config, save_config};
use tendril_core::git::sync::{diagnostic_prompt, sync_project, ProjectSyncResult};
use tendril_core::models::RepoRef;

#[derive(Debug, Deserialize, Default)]
pub struct RemoveRepoParams {
    pub path: Option<String>,
}

/// `POST /api/projects/:name/repos` — adds one repository, cloning it first when it is a URL.
///
/// Same contract as [`create_project`]: what is stored is a path on disk, never a URL.
pub async fn add_project_repo(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(input): Json<RepoInput>,
) -> impl IntoResponse {
    let settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let Some(project) = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&name))
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", name) })),
        )
            .into_response();
    };
    let project_name = project.name.clone();

    let repo_ref: RepoRef = input.into();
    if repo_ref.path.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Repo path cannot be empty" })),
        )
            .into_response();
    }

    // The URL is deduped before the clone as well as the path after it, so pasting the same remote
    // twice answers from config instead of going back to the network.
    if let Some(existing) = project
        .repos
        .iter()
        .find(|r| r.path.eq_ignore_ascii_case(&repo_ref.path))
    {
        return (StatusCode::OK, Json(json!(existing))).into_response();
    }

    let mut materialized = match materialize_repos(
        state.tendril_home.clone(),
        project_name.clone(),
        vec![repo_ref],
    )
    .await
    {
        Ok(materialized) => materialized,
        Err(e) => return clone_error_response(e),
    };
    let created = std::mem::take(&mut materialized.created);
    let repo_ref = materialized.repos.remove(0);

    // Re-read: the clone may have run for minutes, and this handler is about to rewrite the file.
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            remove_cloned_repos(&created);
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
            remove_cloned_repos(&created);
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    if let Some(existing) = settings.projects[proj_idx]
        .repos
        .iter()
        .find(|r| r.path.eq_ignore_ascii_case(&repo_ref.path))
    {
        // The same remote was added by something else while this clone ran, and it resolved to the
        // same directory. The clone is kept: it *is* the repository the config now points at, and
        // it was a refresh of that directory rather than a second copy.
        return (StatusCode::OK, Json(json!(existing))).into_response();
    }

    settings.projects[proj_idx].repos.push(repo_ref.clone());
    if let Err(e) = save_config(&state.config_path, &settings) {
        remove_cloned_repos(&created);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(json!(repo_ref))).into_response()
}

pub async fn remove_project_repo(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Query(query): Query<RemoveRepoParams>,
    body_bytes: axum::body::Bytes,
) -> impl IntoResponse {
    let target_path = if let Some(p) = query.path.filter(|s| !s.trim().is_empty()) {
        p
    } else if !body_bytes.is_empty() {
        if let Ok(input) = serde_json::from_slice::<RepoInput>(&body_bytes) {
            let r: RepoRef = input.into();
            r.path
        } else if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body_bytes) {
            val.get("path")
                .and_then(|p| p.as_str())
                .unwrap_or_default()
                .to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    if target_path.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Repo path is required" })),
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
        .repos
        .retain(|r| !r.path.eq_ignore_ascii_case(&target_path));

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
            "message": format!("Repo '{}' removed from project '{}'", target_path, name)
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize, Default)]
pub struct SyncReposParams {
    /// Narrows the pass to one repo, matched the way `tendril project sync --repo` matches: by
    /// configured path, expanded path, or final path segment.
    pub repo: Option<String>,
}

/// One repository's outcome. `diagnosticPrompt` is present exactly when `canFixWithAgent` is set,
/// so a client can offer "Fix with Agent" without composing the prompt itself — the wording is a
/// contract shared with the CLI and must not be re-derived per client.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSyncResultDto {
    pub repo_path: String,
    pub base_branch: Option<String>,
    pub success: bool,
    pub message: String,
    pub git_error_details: Option<String>,
    pub can_fix_with_agent: bool,
    pub diagnostic_prompt: Option<String>,
    /// Commit counts on each side, set only when the refusal was a genuine divergence.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub diverged: bool,
}

impl From<&ProjectSyncResult> for RepoSyncResultDto {
    fn from(result: &ProjectSyncResult) -> Self {
        Self {
            repo_path: result.repo_path.clone(),
            base_branch: result.base_branch.clone(),
            success: result.success,
            message: result.message.clone(),
            git_error_details: result.git_error_details.clone(),
            can_fix_with_agent: result.can_fix_with_agent,
            diagnostic_prompt: result.can_fix_with_agent.then(|| diagnostic_prompt(result)),
            ahead: result.divergence.map(|d| d.ahead),
            behind: result.divergence.map(|d| d.behind),
            diverged: result.divergence.is_some(),
        }
    }
}

/// `POST /api/projects/:name/sync` — fast-forwards each of a project's repos onto its base branch,
/// and hands back the escalation for the ones it refused.
///
/// The refusals are the point. A dirty tree, a feature branch, a detached HEAD or a diverged history
/// all stop the pass for that repo with `canFixWithAgent` and a ready-made `diagnosticPrompt`; the
/// daemon never reconciles any of them, because a divergence has no safe automatic answer. Nothing
/// in this path force-pushes, resets, deletes a branch, or discards uncommitted work.
///
/// A repo that failed is reported in the body, not as an HTTP error: the caller asked about every
/// repo, and a 500 would throw away the results for the ones that succeeded. `success` is the
/// whole-pass verdict.
pub async fn sync_project_repos(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Query(params): Query<SyncReposParams>,
) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    let Some(project) = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&name))
        .cloned()
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", name) })),
        )
            .into_response();
    };

    if project.repos.is_empty() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "No repositories found in project.",
                "total": 0,
                "failed": 0,
                "results": Vec::<RepoSyncResultDto>::new(),
            })),
        )
            .into_response();
    }

    // `sync_project` shells out to `git fetch`, which can take tens of seconds per repo, so it runs
    // off the async runtime rather than blocking a worker thread for the whole pass.
    let repo_filter = params.repo.clone();
    let tendril_home = state.tendril_home.clone();
    let joined = tokio::task::spawn_blocking(move || {
        sync_project(&project, repo_filter.as_deref(), &tendril_home)
    })
    .await;

    let results = match joined {
        Ok(results) => results,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Repository sync task panicked: {}", e) })),
            )
                .into_response();
        }
    };

    if results.is_empty() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "No matching repositories found to sync.",
                "total": 0,
                "failed": 0,
                "results": Vec::<RepoSyncResultDto>::new(),
            })),
        )
            .into_response();
    }

    let dtos: Vec<RepoSyncResultDto> = results.iter().map(RepoSyncResultDto::from).collect();
    let failed = dtos.iter().filter(|r| !r.success).count();

    (
        StatusCode::OK,
        Json(json!({
            "success": failed == 0,
            "total": dtos.len(),
            "failed": failed,
            "results": dtos,
        })),
    )
        .into_response()
}
