//! A reviewer's inline diff comments on a plan's changes.

use super::{error_response, folder_name_of, plan_id_from_folder_name};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::plans::{
    clear_diff_comments, read_diff_comments, remove_diff_comment, resolve_plan_folder,
    upsert_diff_comment, write_diff_comments, DraftComment,
};

// --- Draft Diff Comment Handlers ---
//
// A reviewer's inline diff comments live in `<planFolder>/Artifacts/draft_diff_comments.yaml`, not
// in `plan.yaml`, so unlike the verification handlers these must not call `sync_plan`: there is no
// DB-projected field to refresh.

#[derive(Debug, Deserialize)]
pub struct DiffCommentQuery {
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    #[serde(rename = "changeKey")]
    pub change_key: Option<String>,
}

/// `PUT` accepts `{ "comments": [...] }` and a bare array alike — the wrapper reads better from a
/// client, the bare form is what a naive caller sends.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ReplaceDiffCommentsBody {
    Wrapped { comments: Vec<DraftComment> },
    Bare(Vec<DraftComment>),
}

impl ReplaceDiffCommentsBody {
    fn into_comments(self) -> Vec<DraftComment> {
        match self {
            Self::Wrapped { comments } => comments,
            Self::Bare(comments) => comments,
        }
    }
}

/// Tell every connected client that a plan's diff comments moved.
///
/// Goes through [`AppState::dispatch_ws_event`] rather than `ws_tx.send` directly, so a client that
/// missed this while disconnected can pick it up via `?since=<seq>` resume or the backfill endpoint.
fn broadcast_diff_comments_changed(state: &AppState, folder_name: &str, count: usize) {
    state.dispatch_ws_event(json!({
        "type": "plan.diff_comments_changed",
        "planId": format!("{:05}", plan_id_from_folder_name(folder_name)),
        "folderName": folder_name,
        "count": count,
    }));
}

pub async fn list_diff_comments_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Plan '{}' not found", plan_id),
            )
        }
    };

    match read_diff_comments(&folder) {
        Ok(comments) => (StatusCode::OK, Json(json!(comments))).into_response(),
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read diff comments: {}", e),
        ),
    }
}

pub async fn upsert_diff_comment_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(comment): Json<DraftComment>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Plan '{}' not found", plan_id),
            )
        }
    };

    match upsert_diff_comment(&folder, &comment) {
        Ok(comments) => {
            broadcast_diff_comments_changed(&state, &folder_name_of(&folder), comments.len());
            (StatusCode::OK, Json(json!(comments))).into_response()
        }
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save diff comment: {}", e),
        ),
    }
}

pub async fn replace_diff_comments_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<ReplaceDiffCommentsBody>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Plan '{}' not found", plan_id),
            )
        }
    };

    let comments = body.into_comments();
    match write_diff_comments(&folder, &comments) {
        Ok(()) => {
            broadcast_diff_comments_changed(&state, &folder_name_of(&folder), comments.len());
            (StatusCode::OK, Json(json!(comments))).into_response()
        }
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to replace diff comments: {}", e),
        ),
    }
}

/// `?filePath=..&changeKey=..` removes one comment; no query at all clears the plan's whole review.
pub async fn delete_diff_comments_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Query(query): Query<DiffCommentQuery>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Plan '{}' not found", plan_id),
            )
        }
    };

    let outcome = match (query.file_path.as_deref(), query.change_key.as_deref()) {
        (Some(file_path), Some(change_key)) => remove_diff_comment(&folder, file_path, change_key),
        (None, None) => clear_diff_comments(&folder).map(|()| Vec::new()),
        // Half a key is a client bug, not a request to clear everything.
        _ => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "filePath and changeKey must be given together; omit both to clear all comments"
                    .to_string(),
            )
        }
    };

    match outcome {
        Ok(comments) => {
            broadcast_diff_comments_changed(&state, &folder_name_of(&folder), comments.len());
            (StatusCode::OK, Json(json!(comments))).into_response()
        }
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to delete diff comments: {}", e),
        ),
    }
}
