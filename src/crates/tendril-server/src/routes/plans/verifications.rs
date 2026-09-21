//! A plan's verification entries: listing them, adding one, moving its status and removing it.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::db::{open_database, sync_plan};
use tendril_core::models::VerificationStatus;
use tendril_core::plans::{
    add_plan_verification, list_plan_verifications, read_plan_file, remove_plan_verification,
    resolve_plan_folder, set_plan_verification_status,
};

// --- Verifications Handlers ---

#[derive(Debug, Deserialize)]
pub struct AddVerificationBody {
    pub name: String,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateVerificationBody {
    pub status: String,
}

pub async fn list_plan_verifications_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
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

    match list_plan_verifications(&folder) {
        Ok(verifs) => (StatusCode::OK, Json(json!(verifs))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to list verifications: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn add_plan_verification_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<AddVerificationBody>,
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

    let status = match body.status.as_deref() {
        Some(s) => match VerificationStatus::from_str_loose(s) {
            Some(st) => Some(st),
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("Invalid verification status: {}", s) })),
                )
                    .into_response();
            }
        },
        None => None,
    };

    match add_plan_verification(&folder, &body.name, status) {
        Ok(entry) => {
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (StatusCode::CREATED, Json(json!(entry))).into_response()
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Failed to add verification: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn update_plan_verification_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, name)): Path<(String, String)>,
    Json(body): Json<UpdateVerificationBody>,
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

    let status = match VerificationStatus::from_str_loose(&body.status) {
        Some(st) => st,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Invalid verification status: {}", body.status) })),
            )
                .into_response();
        }
    };

    match set_plan_verification_status(&folder, &name, status) {
        Ok(entry) => {
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (StatusCode::OK, Json(json!(entry))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to update verification: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn delete_plan_verification_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, name)): Path<(String, String)>,
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

    match remove_plan_verification(&folder, &name) {
        Ok(_) => {
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::OK,
                Json(json!({ "message": "Verification removed" })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Failed to remove verification: {}", e) })),
        )
            .into_response(),
    }
}
