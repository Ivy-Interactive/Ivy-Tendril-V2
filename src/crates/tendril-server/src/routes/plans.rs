use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::load_config;
use tendril_core::db::{delete_plan as delete_plan_row, get_plans, open_database, sync_plan};
use tendril_core::error::TendrilError;
use tendril_core::git::{cleanup_worktrees, run_git};
use tendril_core::models::{PlanStatus, PlanVerificationEntry, VerificationStatus};
use tendril_core::plans::{
    add_plan_verification, add_recommendation, create_plan, get_revision, list_plan_verifications,
    list_recommendations, read_plan_file, read_plan_yaml, remove_plan_verification,
    remove_recommendation, resolve_plan_folder, set_plan_verification_status,
    set_recommendation_state, write_plan_yaml, write_revision, CreatePlanOptions,
    PlanCompletionGuard,
};

#[derive(Debug, Deserialize)]
pub struct PlanQuery {
    pub status: Option<String>,
    pub project: Option<String>,
    pub level: Option<String>,
    pub q: Option<String>,
    pub field: Option<String>,
}

pub async fn list_plans(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PlanQuery>,
) -> impl IntoResponse {
    let status_filter = query.status.as_deref().and_then(PlanStatus::from_str_loose);
    let project_filter = query.project.as_deref();
    let text_filter = query.q.as_deref();

    let conn = match open_database(&state.db_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Database error: {}", e) })),
            )
                .into_response()
        }
    };

    match get_plans(&conn, status_filter, project_filter, text_filter) {
        Ok(plans) => Json(json!(plans)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to fetch plans: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn get_plan(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Query(query): Query<PlanQuery>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response()
        }
    };

    let plan_file = match read_plan_file(&folder) {
        Ok(pf) => pf,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read plan: {}", e) })),
            )
                .into_response()
        }
    };

    if let Some(field) = query.field {
        let val = match field.to_ascii_lowercase().as_str() {
            "title" => plan_file.metadata.title,
            "state" => plan_file.metadata.state.to_string(),
            "project" => plan_file.metadata.project,
            "level" => plan_file.metadata.level,
            "id" => plan_file.metadata.id.to_string(),
            "initialprompt" => plan_file.metadata.initial_prompt.unwrap_or_default(),
            "sourceurl" => plan_file.metadata.source_url.unwrap_or_default(),
            _ => String::new(),
        };
        return val.into_response();
    }

    Json(json!(plan_file)).into_response()
}

#[derive(Debug, Deserialize)]
pub struct CreatePlanBody {
    pub title: String,
    pub project: String,
    pub level: Option<String>,
    #[serde(rename = "initialPrompt")]
    pub initial_prompt: Option<String>,
    #[serde(rename = "sourceUrl")]
    pub source_url: Option<String>,
    #[serde(rename = "executionProfile")]
    pub execution_profile: Option<String>,
    pub priority: Option<i32>,
    #[serde(default)]
    pub repos: Vec<String>,
    #[serde(default)]
    pub verifications: Vec<PlanVerificationEntry>,
    #[serde(rename = "dependsOn", default)]
    pub depends_on: Vec<String>,
    #[serde(rename = "relatedPlans", default)]
    pub related_plans: Vec<String>,
    #[serde(rename = "chatSessionId", default)]
    pub chat_session_id: Option<String>,
}

pub async fn create_plan_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreatePlanBody>,
) -> impl IntoResponse {
    let opts = CreatePlanOptions {
        title: body.title,
        project: body.project,
        level: body.level,
        initial_prompt: body.initial_prompt,
        source_url: body.source_url,
        execution_profile: body.execution_profile,
        priority: body.priority,
        repos: body.repos,
        verifications: body.verifications,
        depends_on: body.depends_on,
        related_plans: body.related_plans,
        chat_session_id: body.chat_session_id,
    };

    match create_plan(&state.plans_dir, opts) {
        Ok(plan_file) => {
            if let Ok(conn) = open_database(&state.db_path) {
                let _ = sync_plan(&conn, &plan_file);
            }
            (StatusCode::CREATED, Json(json!(plan_file))).into_response()
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Failed to create plan: {}", e) })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateFieldBody {
    pub field: String,
    pub value: String,
    #[serde(rename = "allowFailedVerifications", default)]
    pub allow_failed_verifications: bool,
}

pub async fn update_plan_field(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<UpdateFieldBody>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
        }
    };

    let (mut plan, _) = match read_plan_yaml(&folder) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read plan.yaml: {}", e) })),
            )
        }
    };

    if body.field.eq_ignore_ascii_case("state") {
        if let Some(new_state) = PlanStatus::from_str_loose(&body.value) {
            let was_completed = plan.state.eq_ignore_ascii_case("completed");
            let will_be_completed = new_state == PlanStatus::Completed;
            match PlanCompletionGuard::apply_state(
                &mut plan,
                new_state,
                body.allow_failed_verifications,
                &plan_id,
            ) {
                Ok(_) => {
                    if !was_completed && will_be_completed {
                        let folder_name = folder
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or_default()
                            .to_string();
                        let p_id: i32 = folder_name
                            .split('-')
                            .next()
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(0);
                        let chat_mgr = state.chat_manager.clone();
                        let title = plan.title.clone();
                        let cs_id = plan.chat_session_id.clone();
                        tokio::spawn(async move {
                            let _ = broadcast_pr_merged(
                                &chat_mgr,
                                &title,
                                p_id,
                                &folder_name,
                                cs_id.as_deref(),
                            )
                            .await;
                        });
                    }
                }
                Err(e) => {
                    return (
                        StatusCode::CONFLICT,
                        Json(json!({ "error": e.to_string() })),
                    )
                }
            }
        } else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Invalid state: {}", body.value) })),
            );
        }
    } else if body.field.to_ascii_lowercase().starts_with("verification.") {
        let verif_name = &body.field["verification.".len()..];
        let status = match VerificationStatus::from_str_loose(&body.value) {
            Some(s) => s,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(
                        json!({ "error": format!("Invalid verification status: {}", body.value) }),
                    ),
                );
            }
        };

        if let Some(entry) = plan
            .verifications
            .iter_mut()
            .find(|v| v.name.eq_ignore_ascii_case(verif_name))
        {
            entry.status = status;
        } else {
            plan.verifications.push(PlanVerificationEntry {
                name: verif_name.to_string(),
                status,
            });
        }
    } else if body.field.eq_ignore_ascii_case("title") {
        plan.title = body.value;
    } else if body.field.eq_ignore_ascii_case("level") {
        plan.level = body.value;
    } else if body.field.eq_ignore_ascii_case("project") {
        plan.project = body.value;
    } else if body.field.eq_ignore_ascii_case("executionprofile") {
        plan.execution_profile = Some(body.value);
    } else if body.field.eq_ignore_ascii_case("initialprompt") {
        plan.initial_prompt = Some(body.value);
    } else if body.field.eq_ignore_ascii_case("sourceurl") {
        plan.source_url = Some(body.value);
    } else if body.field.eq_ignore_ascii_case("priority") {
        if let Ok(p) = body.value.parse::<i32>() {
            plan.priority = p;
        }
    }

    plan.updated = Utc::now();
    if let Err(e) = write_plan_yaml(&folder, &plan) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write plan.yaml: {}", e) })),
        );
    }

    if let Ok(pf) = read_plan_file(&folder) {
        if let Ok(conn) = open_database(&state.db_path) {
            let _ = sync_plan(&conn, &pf);
        }
    }

    (
        StatusCode::OK,
        Json(json!({ "message": format!("Field '{}' updated", body.field) })),
    )
}

#[derive(Debug, Deserialize)]
pub struct RevisionQuery {
    pub number: Option<i32>,
}

pub async fn get_revision_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Query(query): Query<RevisionQuery>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
                .into_response()
        }
    };

    match get_revision(&folder, query.number) {
        Ok(content) => content.into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Failed to get revision: {}", e) })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct WriteRevisionBody {
    pub content: String,
    #[serde(default)]
    pub no_question_check: bool,
}

pub async fn write_revision_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<WriteRevisionBody>,
) -> impl IntoResponse {
    let folder = match resolve_plan_folder(&plan_id, &state.plans_dir) {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
            )
        }
    };

    match write_revision(&folder, &body.content, !body.no_question_check) {
        Ok(rev_num) => {
            // Update plan timestamp and sync to db
            if let Ok((mut plan, _)) = read_plan_yaml(&folder) {
                plan.updated = Utc::now();
                let _ = write_plan_yaml(&folder, &plan);
            }
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::OK,
                Json(json!({
                    "revision": rev_num,
                    "message": format!("Revision {:03} written", rev_num)
                })),
            )
        }
        Err(TendrilError::Validation(e)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Validation failed: {}", e) })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write revision: {}", e) })),
        ),
    }
}

// --- Recommendations Handlers ---

#[derive(Debug, Deserialize)]
pub struct AddRecommendationBody {
    pub title: String,
    pub description: String,
    pub impact: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRecommendationBody {
    pub state: String,
    #[serde(rename = "declineReason")]
    pub decline_reason: Option<String>,
}

pub async fn list_recommendations_handler(
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

    match list_recommendations(&folder) {
        Ok(recs) => (StatusCode::OK, Json(json!(recs))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to list recommendations: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn add_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<AddRecommendationBody>,
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

    match add_recommendation(
        &folder,
        &body.title,
        &body.description,
        body.impact.as_deref(),
    ) {
        Ok(_) => {
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::CREATED,
                Json(json!({
                    "title": body.title,
                    "description": body.description,
                    "impact": body.impact,
                    "state": "Pending"
                })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Failed to add recommendation: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn update_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, title)): Path<(String, String)>,
    Json(body): Json<UpdateRecommendationBody>,
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

    match set_recommendation_state(&folder, &title, &body.state, body.decline_reason.as_deref()) {
        Ok(_) => {
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::OK,
                Json(json!({ "message": "Recommendation updated" })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Failed to update recommendation: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn delete_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, title)): Path<(String, String)>,
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

    match remove_recommendation(&folder, &title) {
        Ok(_) => {
            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&state.db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }
            (
                StatusCode::OK,
                Json(json!({ "message": "Recommendation removed" })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Failed to remove recommendation: {}", e) })),
        )
            .into_response(),
    }
}

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

#[derive(Debug, Deserialize)]
pub struct PlanEventRequest {
    pub summary: String,
    pub reason: Option<String>,
    #[serde(rename = "sourceChatSessionId", default)]
    pub source_chat_session_id: Option<String>,
    #[serde(rename = "revisionFile", default)]
    pub revision_file: Option<String>,
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
    let clean_summary = body.summary.trim().trim_end_matches('.');
    let reason_clause = match body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        Some(r) => format!(" Reason: {}.", r.trim_end_matches('.')),
        None => String::new(),
    };

    let message = format!(
        "[System Event] Plan '{}' (#{id:05}) was edited directly: {clean_summary}.{reason_clause} Check whether this changes your understanding of the plan, and tell the user if anything needs follow-up.",
        plan.metadata.title,
        id = plan.metadata.id
    );

    match state
        .chat_manager
        .broadcast_plan_system_message(
            folder_name,
            plan.metadata.chat_session_id.as_deref(),
            body.source_chat_session_id.as_deref(),
            &message,
        )
        .await
    {
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

pub async fn broadcast_pr_created(
    chat_manager: &tendril_core::chat::execution::ChatExecutionManager,
    plan_title: &str,
    plan_id: i32,
    folder_name: &str,
    plan_chat_session_id: Option<&str>,
    pr_url: &str,
) -> tendril_core::error::Result<Vec<String>> {
    let message = format!(
        "[System Event] Pull request for plan '{}' (#{plan_id:05}) has been created: {pr_url}. Please review the pull request and next steps.",
        plan_title
    );
    chat_manager
        .broadcast_plan_system_message(folder_name, plan_chat_session_id, None, &message)
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

// --- Lifecycle Handlers (repo status, reset, delete) ---

/// Uncommitted-change lines reported per repo. Enough for the dirty-repo guard
/// to show what is in the way without streaming a whole `git status`.
const MAX_STATUS_LINES: usize = 20;

/// States held by a running promptware job. Resetting or deleting a plan while
/// one of them owns the folder would pull the ground out from under the agent.
fn is_in_flight(state: &str) -> bool {
    matches!(
        state.to_ascii_lowercase().as_str(),
        "executing" | "creating" | "updating"
    )
}

/// States a plan does not come back from. `Reset to Draft` refuses these; the
/// UI disables the action too, but the 409 is the authority.
fn is_terminal(state: &str) -> bool {
    matches!(
        state.to_ascii_lowercase().as_str(),
        "completed" | "skipped"
    )
}

/// The repos a plan's execution would actually touch: its own `repos` when set,
/// otherwise its project's, mirroring how ExecutePlan resolves them.
fn effective_repos(state: &AppState, plan: &tendril_core::models::PlanYaml) -> Vec<String> {
    if !plan.repos.is_empty() {
        return plan.repos.clone();
    }

    let settings = load_config(&state.config_path).unwrap_or_default();
    settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&plan.project))
        .map(|p| p.repo_paths())
        .unwrap_or_default()
}

/// `GET /api/plans/:id/repo-status` — uncommitted work in the plan's repos.
///
/// Read-only, and deliberately forgiving: a repo that cannot be inspected is
/// reported with an `error` and `isDirty: false` rather than failing the whole
/// request, because the caller is a pre-execution guard and an unreadable repo
/// must not become a permanent block on executing the plan.
pub async fn repo_status_handler(
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
        }
    };

    let (plan, _) = match read_plan_yaml(&folder) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read plan.yaml: {}", e) })),
            )
        }
    };

    let mut repos = Vec::new();
    for repo in effective_repos(&state, &plan) {
        let repo_path = std::path::PathBuf::from(&repo);
        if !repo_path.is_dir() {
            repos.push(json!({
                "path": repo,
                "isDirty": false,
                "changes": [],
                "error": "Repository path does not exist",
            }));
            continue;
        }

        match run_git(&["status", "--porcelain"], &repo_path) {
            Ok((0, stdout, _)) => {
                let lines: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();
                let changes: Vec<String> = lines
                    .iter()
                    .take(MAX_STATUS_LINES)
                    .map(|l| l.to_string())
                    .collect();
                repos.push(json!({
                    "path": repo,
                    "isDirty": !lines.is_empty(),
                    "changes": changes,
                    "changeCount": lines.len(),
                }));
            }
            Ok((code, _, stderr)) => repos.push(json!({
                "path": repo,
                "isDirty": false,
                "changes": [],
                "error": format!("git status exited {}: {}", code, stderr.trim()),
            })),
            Err(e) => repos.push(json!({
                "path": repo,
                "isDirty": false,
                "changes": [],
                "error": format!("git status failed: {}", e),
            })),
        }
    }

    (StatusCode::OK, Json(json!({ "repos": repos })))
}

/// `POST /api/plans/:id/reset` — back to Draft, worktrees removed.
///
/// State change and worktree cleanup happen in one request so the UI cannot
/// leave a plan half-reset (Draft, but still holding the previous execution's
/// worktrees). Cleanup runs first: a failure there leaves the plan in its old
/// state, which is retryable, where the reverse would not be.
pub async fn reset_plan_handler(
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
        }
    };

    let (mut plan, _) = match read_plan_yaml(&folder) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read plan.yaml: {}", e) })),
            )
        }
    };

    if is_terminal(&plan.state) {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "error": format!(
                    "Plan '{}' is {} and cannot be reset to Draft",
                    plan_id, plan.state
                )
            })),
        );
    }
    if is_in_flight(&plan.state) {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "error": format!(
                    "Plan '{}' is {}: cancel the running job before resetting it",
                    plan_id, plan.state
                )
            })),
        );
    }

    if let Err(e) = cleanup_worktrees(&folder) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to remove worktrees: {}", e) })),
        );
    }

    plan.state = PlanStatus::Draft.to_string();
    plan.updated = Utc::now();
    if let Err(e) = write_plan_yaml(&folder, &plan) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write plan.yaml: {}", e) })),
        );
    }

    if let Ok(pf) = read_plan_file(&folder) {
        if let Ok(conn) = open_database(&state.db_path) {
            let _ = sync_plan(&conn, &pf);
        }
    }

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Plan '{}' reset to Draft and worktrees removed", plan_id),
            "state": plan.state,
        })),
    )
}

/// `DELETE /api/plans/:id` — permanent removal of the plan folder.
///
/// Worktrees go first: a worktree still registered against a folder that no
/// longer exists is the one state git cannot recover from on its own. The
/// resolved folder is checked to be inside the plans root before anything is
/// removed, since `resolve_plan_folder` also accepts absolute paths.
pub async fn delete_plan_handler(
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
        }
    };

    let plans_root = std::fs::canonicalize(&state.plans_dir).unwrap_or_else(|_| state.plans_dir.clone());
    let resolved = std::fs::canonicalize(&folder).unwrap_or_else(|_| folder.clone());
    if !resolved.starts_with(&plans_root) || resolved == plans_root {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!(
                    "Refusing to delete '{}': it is not a plan folder inside {}",
                    resolved.display(),
                    plans_root.display()
                )
            })),
        );
    }

    let (plan, _) = match read_plan_yaml(&folder) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read plan.yaml: {}", e) })),
            )
        }
    };

    if is_in_flight(&plan.state) {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "error": format!(
                    "Plan '{}' is {}: cancel the running job before deleting it",
                    plan_id, plan.state
                )
            })),
        );
    }

    if let Err(e) = cleanup_worktrees(&folder) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to remove worktrees: {}", e) })),
        );
    }

    let numeric_id: i32 = resolved
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.split('-').next())
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);

    if let Err(e) = std::fs::remove_dir_all(&resolved) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to remove plan folder: {}", e) })),
        );
    }

    if numeric_id > 0 {
        if let Ok(conn) = open_database(&state.db_path) {
            let _ = delete_plan_row(&conn, numeric_id);
        }
    }

    (
        StatusCode::OK,
        Json(json!({ "message": format!("Plan '{}' deleted", plan_id) })),
    )
}
