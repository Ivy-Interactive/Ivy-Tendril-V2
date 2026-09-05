use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::db::{get_plans, open_database, sync_plan};
use tendril_core::models::{PlanStatus, PlanVerificationEntry};
use tendril_core::plans::{
    create_plan, get_revision, read_plan_file, read_plan_yaml, resolve_plan_folder,
    write_plan_yaml, write_revision, CreatePlanOptions, PlanCompletionGuard,
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
            match PlanCompletionGuard::apply_state(
                &mut plan,
                new_state,
                body.allow_failed_verifications,
                &plan_id,
            ) {
                Ok(_) => {}
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

    match write_revision(&folder, &body.content) {
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
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write revision: {}", e) })),
        ),
    }
}
