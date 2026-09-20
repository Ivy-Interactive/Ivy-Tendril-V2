//! A reviewer's draft annotations on a revision's markdown body.

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
    clear_annotations, read_annotations, remove_annotation, resolve_plan_folder, upsert_annotation,
    write_annotations, Annotation,
};

// --- Draft Annotation Handlers ---
//
// A reviewer's draft annotations on a revision's markdown live in
// `<planFolder>/Artifacts/draft_annotations.yaml`, not in `plan.yaml`, so like the diff-comment
// handlers above these must not call `sync_plan`: there is no DB-projected field to refresh.
//
// These are annotations on a revision's **body**, not comments on a **diff** — a separate concept
// with a separate file, deliberately shaped like its sibling so the difference is easy to see.

#[derive(Debug, Deserialize)]
pub struct AnnotationQuery {
    pub id: Option<String>,
}

/// `PUT` accepts `{ "annotations": [...] }` and a bare array alike — the wrapper reads better from
/// a client, the bare form is what a naive caller sends.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ReplaceAnnotationsBody {
    Wrapped { annotations: Vec<Annotation> },
    Bare(Vec<Annotation>),
}

impl ReplaceAnnotationsBody {
    fn into_annotations(self) -> Vec<Annotation> {
        match self {
            Self::Wrapped { annotations } => annotations,
            Self::Bare(annotations) => annotations,
        }
    }
}

/// Tell every connected client that a plan's annotations moved.
///
/// Goes through [`AppState::dispatch_ws_event`] for the same reason as
/// [`broadcast_diff_comments_changed`]: so a resuming or backfilling client sees it too.
fn broadcast_annotations_changed(state: &AppState, folder_name: &str, count: usize) {
    state.dispatch_ws_event(json!({
        "type": "plan.annotations_changed",
        "planId": format!("{:05}", plan_id_from_folder_name(folder_name)),
        "folderName": folder_name,
        "count": count,
    }));
}

pub async fn list_annotations_handler(
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

    match read_annotations(&folder) {
        Ok(annotations) => (StatusCode::OK, Json(json!(annotations))).into_response(),
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read annotations: {}", e),
        ),
    }
}

pub async fn upsert_annotation_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(annotation): Json<Annotation>,
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

    match upsert_annotation(&folder, &annotation) {
        Ok(annotations) => {
            broadcast_annotations_changed(&state, &folder_name_of(&folder), annotations.len());
            (StatusCode::OK, Json(json!(annotations))).into_response()
        }
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save annotation: {}", e),
        ),
    }
}

pub async fn replace_annotations_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<ReplaceAnnotationsBody>,
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

    let annotations = body.into_annotations();
    match write_annotations(&folder, &annotations) {
        Ok(()) => {
            broadcast_annotations_changed(&state, &folder_name_of(&folder), annotations.len());
            (StatusCode::OK, Json(json!(annotations))).into_response()
        }
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to replace annotations: {}", e),
        ),
    }
}

/// `?id=..` removes one annotation; no query at all clears the plan's whole set.
///
/// There is no `BAD_REQUEST` branch here, unlike the diff-comment handler: an annotation's identity
/// is a single `id`, so there is no half-a-key case a client could send by mistake. The absence is
/// deliberate rather than an omission.
pub async fn delete_annotations_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Query(query): Query<AnnotationQuery>,
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

    let outcome = match query.id.as_deref() {
        Some(id) => remove_annotation(&folder, id),
        None => clear_annotations(&folder).map(|()| Vec::new()),
    };

    match outcome {
        Ok(annotations) => {
            broadcast_annotations_changed(&state, &folder_name_of(&folder), annotations.len());
            (StatusCode::OK, Json(json!(annotations))).into_response()
        }
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to delete annotations: {}", e),
        ),
    }
}
