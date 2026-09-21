//! System-event announcements into the chat sessions attached to a plan.
//!
//! Three kinds share one addressing rule — every session on the plan except the one that caused
//! the change: a direct edit, a PR opening, and a PR merging. `POST /api/plans/:id/events` is the
//! route the CLI reaches them through, since it has no `ChatExecutionManager` of its own.

use super::plan_id_from_folder_name;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::models::PlanYaml;
use tendril_core::plans::{read_plan_file, resolve_plan_folder};

#[derive(Debug, Deserialize)]
pub struct PlanEventRequest {
    pub summary: String,
    pub reason: Option<String>,
    #[serde(rename = "sourceChatSessionId", default)]
    pub source_chat_session_id: Option<String>,
    #[serde(rename = "revisionFile", default)]
    pub revision_file: Option<String>,
    /// `edit` (default) or `pr-created`. The CLI has no `ChatExecutionManager` of its own, so this is
    /// how it reaches the PR announcer.
    #[serde(rename = "eventKind", default)]
    pub event_kind: Option<String>,
    #[serde(rename = "prUrl", default)]
    pub pr_url: Option<String>,
}

/// ` Reason: <r>.` with the trailing period normalized away, or empty when there is no reason.
fn reason_clause(reason: Option<&str>) -> String {
    match reason.map(str::trim).filter(|r| !r.is_empty()) {
        Some(r) => format!(" Reason: {}.", r.trim_end_matches('.')),
        None => String::new(),
    }
}

fn plan_edit_message(
    plan_title: &str,
    plan_id: i32,
    summary: &str,
    reason: Option<&str>,
) -> String {
    let clean_summary = summary.trim().trim_end_matches('.');
    let reason_clause = reason_clause(reason);
    format!(
        "[System Event] Plan '{}' (#{plan_id:05}) was edited directly: {clean_summary}.{reason_clause} Check whether this changes your understanding of the plan, and tell the user if anything needs follow-up.",
        plan_title
    )
}

/// Broadcasts "[System Event] Plan '<title>' (#<id>) was edited directly: <summary>. Reason: ..."
/// to every chat session attached to the plan except `source_chat_session_id`. The write it reports
/// already succeeded, so a broadcast failure is logged rather than surfaced.
pub(crate) async fn broadcast_plan_edit(
    state: &AppState,
    folder_name: &str,
    plan: &PlanYaml,
    summary: &str,
    reason: Option<&str>,
    source_chat_session_id: Option<&str>,
) -> Vec<String> {
    let message = plan_edit_message(
        &plan.title,
        plan_id_from_folder_name(folder_name),
        summary,
        reason,
    );

    match state
        .chat_manager
        .broadcast_plan_system_message(
            folder_name,
            plan.chat_session_id.as_deref(),
            source_chat_session_id,
            &message,
        )
        .await
    {
        Ok(recipients) => recipients,
        Err(e) => {
            tracing::warn!("Failed to broadcast edit for plan {}: {}", folder_name, e);
            Vec::new()
        }
    }
}

pub async fn post_plan_event_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<PlanEventRequest>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response();
        }
    };

    let plan = match read_plan_file(&folder) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read plan: {}", e) })),
            )
                .into_response();
        }
    };

    let folder_name = folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();

    let is_pr_created = body
        .event_kind
        .as_deref()
        .map(|k| k.eq_ignore_ascii_case("pr-created"))
        .unwrap_or(false);

    let broadcast = if is_pr_created {
        let pr_url = match body
            .pr_url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
        {
            Some(u) => u,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "prUrl is required for eventKind 'pr-created'" })),
                )
                    .into_response();
            }
        };

        broadcast_pr_created(
            &state.chat_manager,
            &plan.metadata.title,
            plan.metadata.id,
            folder_name,
            plan.metadata.chat_session_id.as_deref(),
            pr_url,
            body.source_chat_session_id.as_deref(),
            body.reason.as_deref(),
        )
        .await
    } else {
        let message = plan_edit_message(
            &plan.metadata.title,
            plan.metadata.id,
            &body.summary,
            body.reason.as_deref(),
        );
        state
            .chat_manager
            .broadcast_plan_system_message(
                folder_name,
                plan.metadata.chat_session_id.as_deref(),
                body.source_chat_session_id.as_deref(),
                &message,
            )
            .await
    };

    match broadcast {
        Ok(recipients) => (
            StatusCode::OK,
            Json(json!({
                "broadcasted": true,
                "recipientCount": recipients.len(),
                "recipients": recipients,
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to broadcast event: {}", e) })),
        )
            .into_response(),
    }
}

// The signature mirrors broadcast_plan_system_message's addressing plus the announcement's own
// fields; bundling them into a struct for one call site would obscure more than it saves.
#[allow(clippy::too_many_arguments)]
pub async fn broadcast_pr_created(
    chat_manager: &tendril_core::chat::execution::ChatExecutionManager,
    plan_title: &str,
    plan_id: i32,
    folder_name: &str,
    plan_chat_session_id: Option<&str>,
    pr_url: &str,
    source_chat_session_id: Option<&str>,
    reason: Option<&str>,
) -> tendril_core::error::Result<Vec<String>> {
    let reason_clause = reason_clause(reason);
    let message = format!(
        "[System Event] Pull request for plan '{}' (#{plan_id:05}) has been created: {pr_url}.{reason_clause} Please review the pull request and next steps.",
        plan_title
    );
    chat_manager
        .broadcast_plan_system_message(
            folder_name,
            plan_chat_session_id,
            source_chat_session_id,
            &message,
        )
        .await
}

pub async fn broadcast_pr_merged(
    chat_manager: &tendril_core::chat::execution::ChatExecutionManager,
    plan_title: &str,
    plan_id: i32,
    folder_name: &str,
    plan_chat_session_id: Option<&str>,
) -> tendril_core::error::Result<Vec<String>> {
    let message = format!(
        "[System Event] Pull request for plan '{}' (#{plan_id:05}) has been merged. Plan execution is complete.",
        plan_title
    );
    chat_manager
        .broadcast_plan_system_message(folder_name, plan_chat_session_id, None, &message)
        .await
}
