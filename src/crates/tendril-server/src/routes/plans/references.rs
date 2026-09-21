//! The plan's cross-reference collections — repos, PRs, commits, dependencies and related plans.
//!
//! Every one of these is the same shape: validate the reference, apply a small mutation to
//! `plan.yaml`, then tell the attached chat sessions what moved. [`modify_plan`] is that shape,
//! and the handlers below are the mutations poured into it.

use super::events::{broadcast_plan_edit, broadcast_pr_created};
use super::{error_response, message_response, plan_id_from_folder_name};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use std::sync::Arc;
use tendril_core::db::{open_database, sync_plan};
use tendril_core::models::PlanYaml;
use tendril_core::plans::{
    read_plan_file, read_plan_yaml, resolve_plan_folder, resolve_plan_folder_name, write_plan_yaml,
};

// --- Plan List Mutation Handlers (repos, PRs, commits, dependencies, related plans) ---

/// What a mutation closure did to the plan. `Unchanged` is an idempotent no-op: `plan.yaml` is not
/// rewritten and no chat session is notified, but the caller still answers 200.
enum PlanEdit {
    Applied(String),
    Unchanged(String),
}

struct PlanEditOutcome {
    folder_name: String,
    plan: PlanYaml,
    message: String,
    changed: bool,
}

/// Resolves the plan, applies `mutate`, and writes `plan.yaml` only when the mutation reports a
/// change. `Err((code, msg))` short-circuits with `code` `{error}` and never writes.
async fn modify_plan<F>(
    state: &Arc<AppState>,
    plan_id: &str,
    mutate: F,
) -> Result<PlanEditOutcome, (StatusCode, String)>
where
    F: FnOnce(&mut PlanYaml) -> Result<PlanEdit, (StatusCode, String)>,
{
    let folder = resolve_plan_folder(plan_id, &state.plans_dir).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            format!("Plan '{}' not found", plan_id),
        )
    })?;

    let (mut plan, _) = read_plan_yaml(&folder).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read plan.yaml: {}", e),
        )
    })?;

    let (message, changed) = match mutate(&mut plan)? {
        PlanEdit::Applied(m) => (m, true),
        PlanEdit::Unchanged(m) => (m, false),
    };

    if changed {
        plan.updated = Utc::now();
        write_plan_yaml(&folder, &plan).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to write plan.yaml: {}", e),
            )
        })?;

        if let Ok(pf) = read_plan_file(&folder) {
            if let Ok(conn) = open_database(&state.db_path) {
                let _ = sync_plan(&conn, &pf);
            }
        }
    }

    let folder_name = folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    Ok(PlanEditOutcome {
        folder_name,
        plan,
        message,
        changed,
    })
}

#[derive(Debug, Deserialize)]
pub struct PlanRepoBody {
    #[serde(rename = "repoPath", alias = "repo_path")]
    pub repo_path: String,
    pub reason: Option<String>,
    #[serde(rename = "sourceChatSessionId", default)]
    pub source_chat_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PlanPrBody {
    #[serde(rename = "prUrl", alias = "pr_url")]
    pub pr_url: String,
    pub reason: Option<String>,
    #[serde(rename = "sourceChatSessionId", default)]
    pub source_chat_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PlanCommitBody {
    pub sha: String,
    pub reason: Option<String>,
    #[serde(rename = "sourceChatSessionId", default)]
    pub source_chat_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PlanDependsOnBody {
    #[serde(rename = "dependsOn", alias = "depends_on")]
    pub depends_on: String,
    pub reason: Option<String>,
    #[serde(rename = "sourceChatSessionId", default)]
    pub source_chat_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PlanRelatedPlanBody {
    #[serde(rename = "relatedPlan", alias = "related_plan")]
    pub related_plan: String,
    pub reason: Option<String>,
    #[serde(rename = "sourceChatSessionId", default)]
    pub source_chat_session_id: Option<String>,
}

pub async fn add_plan_repo(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanRepoBody>,
) -> impl IntoResponse {
    let repo_path = body.repo_path.trim().to_string();
    if repo_path.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Repo path cannot be empty".to_string(),
        );
    }

    let outcome = match modify_plan(&state, &plan_id, |plan| {
        if plan
            .repos
            .iter()
            .any(|r| r.eq_ignore_ascii_case(&repo_path))
        {
            return Ok(PlanEdit::Unchanged(format!(
                "Repository already in plan: {}",
                repo_path
            )));
        }
        plan.repos.push(repo_path.clone());
        Ok(PlanEdit::Applied(format!(
            "Added repository: {}",
            repo_path
        )))
    })
    .await
    {
        Ok(o) => o,
        Err((code, msg)) => return error_response(code, msg),
    };

    if outcome.changed {
        broadcast_plan_edit(
            &state,
            &outcome.folder_name,
            &outcome.plan,
            &format!("repo added: {}", repo_path),
            body.reason.as_deref(),
            body.source_chat_session_id.as_deref(),
        )
        .await;
    }

    message_response(&outcome.message)
}

pub async fn remove_plan_repo(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanRepoBody>,
) -> impl IntoResponse {
    let repo_path = body.repo_path.trim().to_string();
    if repo_path.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Repo path cannot be empty".to_string(),
        );
    }

    let outcome = match modify_plan(&state, &plan_id, |plan| {
        let before = plan.repos.len();
        plan.repos.retain(|r| !r.eq_ignore_ascii_case(&repo_path));
        if plan.repos.len() == before {
            return Err((
                StatusCode::NOT_FOUND,
                format!("Repository not found in plan: {}", repo_path),
            ));
        }
        Ok(PlanEdit::Applied(format!(
            "Removed repository: {}",
            repo_path
        )))
    })
    .await
    {
        Ok(o) => o,
        Err((code, msg)) => return error_response(code, msg),
    };

    broadcast_plan_edit(
        &state,
        &outcome.folder_name,
        &outcome.plan,
        &format!("repo removed: {}", repo_path),
        body.reason.as_deref(),
        body.source_chat_session_id.as_deref(),
    )
    .await;

    message_response(&outcome.message)
}

pub async fn add_plan_pr(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanPrBody>,
) -> impl IntoResponse {
    let pr_url = body.pr_url.trim().to_string();
    if pr_url.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "PR url cannot be empty".to_string(),
        );
    }

    let outcome = match modify_plan(&state, &plan_id, |plan| {
        if plan.prs.iter().any(|p| p == &pr_url) {
            return Ok(PlanEdit::Unchanged(format!(
                "Pull request already in plan: {}",
                pr_url
            )));
        }
        plan.prs.push(pr_url.clone());
        Ok(PlanEdit::Applied(format!("Added pull request: {}", pr_url)))
    })
    .await
    {
        Ok(o) => o,
        Err((code, msg)) => return error_response(code, msg),
    };

    // A PR gets its own announcement rather than the generic edit notification. Awaited inline so
    // the notification is observable the moment the endpoint answers.
    if outcome.changed {
        if let Err(e) = broadcast_pr_created(
            &state.chat_manager,
            &outcome.plan.title,
            plan_id_from_folder_name(&outcome.folder_name),
            &outcome.folder_name,
            outcome.plan.chat_session_id.as_deref(),
            &pr_url,
            body.source_chat_session_id.as_deref(),
            body.reason.as_deref(),
        )
        .await
        {
            // The PR is already recorded on disk; a failed announcement must not fail the request.
            tracing::warn!("Failed to announce PR for plan {}: {}", plan_id, e);
        }
    }

    message_response(&outcome.message)
}

pub async fn add_plan_commit(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanCommitBody>,
) -> impl IntoResponse {
    let sha = body.sha.trim().to_string();
    if sha.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Commit sha cannot be empty".to_string(),
        );
    }

    let outcome = match modify_plan(&state, &plan_id, |plan| {
        if plan.commits.iter().any(|c| c == &sha) {
            return Ok(PlanEdit::Unchanged(format!(
                "Commit already in plan: {}",
                sha
            )));
        }
        plan.commits.push(sha.clone());
        Ok(PlanEdit::Applied(format!("Added commit: {}", sha)))
    })
    .await
    {
        Ok(o) => o,
        Err((code, msg)) => return error_response(code, msg),
    };

    if outcome.changed {
        broadcast_plan_edit(
            &state,
            &outcome.folder_name,
            &outcome.plan,
            &format!("commit added: {}", sha),
            body.reason.as_deref(),
            body.source_chat_session_id.as_deref(),
        )
        .await;
    }

    message_response(&outcome.message)
}

/// Resolves a `dependsOn` / `relatedPlan` reference to its canonical folder name. The 404 wording is
/// deliberately distinct from the one for `{planId}` so a caller can tell which id was bad.
fn resolve_referenced_plan(
    state: &Arc<AppState>,
    plan_ref: &str,
) -> Result<String, (StatusCode, String)> {
    let trimmed = plan_ref.trim();
    if trimmed.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Plan reference cannot be empty".to_string(),
        ));
    }

    resolve_plan_folder_name(trimmed, &state.plans_dir).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            format!("Referenced plan '{}' not found", trimmed),
        )
    })
}

pub async fn add_plan_depends_on(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanDependsOnBody>,
) -> impl IntoResponse {
    // Resolve before touching the plan, so a bad reference never writes plan.yaml.
    let folder = match resolve_referenced_plan(&state, &body.depends_on) {
        Ok(f) => f,
        Err((code, msg)) => return error_response(code, msg),
    };

    let outcome = match modify_plan(&state, &plan_id, |plan| {
        if plan
            .depends_on
            .iter()
            .any(|d| d.eq_ignore_ascii_case(&folder))
        {
            return Ok(PlanEdit::Unchanged(format!(
                "Dependency already present: {}",
                folder
            )));
        }
        plan.depends_on.push(folder.clone());
        Ok(PlanEdit::Applied(format!("Added dependency: {}", folder)))
    })
    .await
    {
        Ok(o) => o,
        Err((code, msg)) => return error_response(code, msg),
    };

    if outcome.changed {
        broadcast_plan_edit(
            &state,
            &outcome.folder_name,
            &outcome.plan,
            &format!("dependency added: {}", folder),
            body.reason.as_deref(),
            body.source_chat_session_id.as_deref(),
        )
        .await;
    }

    message_response(&outcome.message)
}

pub async fn remove_plan_depends_on(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanDependsOnBody>,
) -> impl IntoResponse {
    let folder = match resolve_referenced_plan(&state, &body.depends_on) {
        Ok(f) => f,
        Err((code, msg)) => return error_response(code, msg),
    };

    let outcome = match modify_plan(&state, &plan_id, |plan| {
        let before = plan.depends_on.len();
        plan.depends_on.retain(|d| !d.eq_ignore_ascii_case(&folder));
        if plan.depends_on.len() == before {
            return Err((
                StatusCode::NOT_FOUND,
                format!("Dependency not found: {}", folder),
            ));
        }
        Ok(PlanEdit::Applied(format!("Removed dependency: {}", folder)))
    })
    .await
    {
        Ok(o) => o,
        Err((code, msg)) => return error_response(code, msg),
    };

    broadcast_plan_edit(
        &state,
        &outcome.folder_name,
        &outcome.plan,
        &format!("dependency removed: {}", folder),
        body.reason.as_deref(),
        body.source_chat_session_id.as_deref(),
    )
    .await;

    message_response(&outcome.message)
}

pub async fn add_plan_related(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanRelatedPlanBody>,
) -> impl IntoResponse {
    let folder = match resolve_referenced_plan(&state, &body.related_plan) {
        Ok(f) => f,
        Err((code, msg)) => return error_response(code, msg),
    };

    let outcome = match modify_plan(&state, &plan_id, |plan| {
        if plan
            .related_plans
            .iter()
            .any(|r| r.eq_ignore_ascii_case(&folder))
        {
            return Ok(PlanEdit::Unchanged(format!(
                "Related plan already present: {}",
                folder
            )));
        }
        plan.related_plans.push(folder.clone());
        Ok(PlanEdit::Applied(format!("Added related plan: {}", folder)))
    })
    .await
    {
        Ok(o) => o,
        Err((code, msg)) => return error_response(code, msg),
    };

    if outcome.changed {
        broadcast_plan_edit(
            &state,
            &outcome.folder_name,
            &outcome.plan,
            &format!("related plan added: {}", folder),
            body.reason.as_deref(),
            body.source_chat_session_id.as_deref(),
        )
        .await;
    }

    message_response(&outcome.message)
}

pub async fn remove_plan_related(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanRelatedPlanBody>,
) -> impl IntoResponse {
    let folder = match resolve_referenced_plan(&state, &body.related_plan) {
        Ok(f) => f,
        Err((code, msg)) => return error_response(code, msg),
    };

    let outcome = match modify_plan(&state, &plan_id, |plan| {
        let before = plan.related_plans.len();
        plan.related_plans
            .retain(|r| !r.eq_ignore_ascii_case(&folder));
        if plan.related_plans.len() == before {
            return Err((
                StatusCode::NOT_FOUND,
                format!("Related plan not found: {}", folder),
            ));
        }
        Ok(PlanEdit::Applied(format!(
            "Removed related plan: {}",
            folder
        )))
    })
    .await
    {
        Ok(o) => o,
        Err((code, msg)) => return error_response(code, msg),
    };

    broadcast_plan_edit(
        &state,
        &outcome.folder_name,
        &outcome.plan,
        &format!("related plan removed: {}", folder),
        body.reason.as_deref(),
        body.source_chat_session_id.as_deref(),
    )
    .await;

    message_response(&outcome.message)
}
