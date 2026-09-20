//! The plan record itself: listing, reading, creating and field-level updates, plus the
//! pre-flight validity check.

use super::error_response;
use super::events::broadcast_pr_merged;
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
use tendril_core::db::{get_plans_limited, open_database, sync_plan};
use tendril_core::git::cleanup_worktrees;
use tendril_core::jobs::firmware_values::find_project;
use tendril_core::models::{PlanStatus, PlanVerificationEntry, VerificationStatus};
use tendril_core::plans::seed_plan_from_project;
use tendril_core::plans::{
    check_plan_health, create_plan, get_plan_field, read_plan_file, read_plan_yaml,
    resolve_plan_folder, write_plan_yaml, CreatePlanOptions, PlanCompletionGuard,
    SUPPORTED_PLAN_FIELDS,
};

#[derive(Debug, Deserialize)]
pub struct PlanQuery {
    pub status: Option<String>,
    /// Alias for `status`, matching the original Tendril's `?state=` query parameter.
    /// `status` wins when both are present.
    pub state: Option<String>,
    pub project: Option<String>,
    pub level: Option<String>,
    pub q: Option<String>,
    pub field: Option<String>,
    /// Unlike the original Tendril (which defaults to 50), V2 defaults to unbounded: the
    /// desktop app's plan list depends on receiving all plans unless a caller opts in.
    pub limit: Option<usize>,
}

pub async fn list_plans(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PlanQuery>,
) -> impl IntoResponse {
    let status_value = query.status.as_deref().or(query.state.as_deref());
    let status_filter = match status_value {
        Some(v) => match PlanStatus::from_str_loose(v) {
            Some(s) => Some(s),
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!("Unknown plan state '{}'", v),
                        "supportedStates": [
                            "Draft", "Creating", "Updating", "Executing", "Completed",
                            "Failed", "Review", "Skipped", "Icebox", "Blocked",
                        ],
                    })),
                )
                    .into_response()
            }
        },
        None => None,
    };
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

    match get_plans_limited(
        &conn,
        status_filter,
        project_filter,
        text_filter,
        query.limit,
    ) {
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
        if field.eq_ignore_ascii_case("id") {
            return plan_file.metadata.id.to_string().into_response();
        }

        let (plan_yaml, _) = match read_plan_yaml(&folder) {
            Ok(y) => y,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": format!("Failed to read plan: {}", e) })),
                )
                    .into_response()
            }
        };

        return match get_plan_field(&plan_yaml, &field) {
            Some(val) => val.into_response(),
            None => (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": format!("Unknown field '{}'", field),
                    "supportedFields": SUPPORTED_PLAN_FIELDS,
                })),
            )
                .into_response(),
        };
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
    // The plan inherits its project's repos and verification set, as V1's `PlanController` does.
    // This is the path the desktop app creates plans through, so without it every plan made from the
    // UI reached `ExecutePlan` with no repo to build a worktree from and no gate to run.
    //
    // An explicit `repos` in the body wins — a caller that named them meant them. `verifications`
    // are treated as overrides on top of the project set rather than replacing it, which is how the
    // CLI's `--verification` behaves.
    let settings = load_config(&state.config_path).unwrap_or_default();
    let (repos, verifications) = match find_project(&settings, &body.project) {
        Some(project) => {
            let (project_repos, seeded) = seed_plan_from_project(project, body.verifications);
            let repos = if body.repos.is_empty() {
                project_repos
            } else {
                body.repos
            };
            (repos, seeded)
        }
        // An unknown project is not rejected here: `create_plan` is the only writer and the CLI
        // already refuses it, while the app can legitimately create a plan for a project whose
        // config has not been reloaded yet.
        None => (body.repos, body.verifications),
    };

    let opts = CreatePlanOptions {
        title: body.title,
        project: body.project,
        level: body.level,
        initial_prompt: body.initial_prompt,
        source_url: body.source_url,
        execution_profile: body.execution_profile,
        priority: body.priority,
        repos,
        verifications,
        depends_on: body.depends_on,
        related_plans: body.related_plans,
        chat_session_id: body.chat_session_id,
    };

    // No `create_plan_for_job` here: this route is the New Plan dialog, driven by a person. A plan
    // created by a `CreatePlan` run goes through the CLI, which stamps its own job id.

    match create_plan(&state.plans_dir, opts) {
        Ok(plan_file) => {
            // `create_plan` is all-or-nothing, so reaching here means the folder is complete on disk.
            // The database write is what the app actually reads its plan list from, though, and this
            // used to be `let _ =`: a sync that failed produced a 201 with the plan's JSON, a folder
            // on disk, and no row -- a plan the UI could not see and the operator could not explain.
            //
            // 500 rather than rolling the folder back. The plan is valid and the operator's intent is
            // recorded; deleting it because a database write failed would destroy the one durable
            // copy over the recoverable half of the pair. The status says the request did not fully
            // succeed and the body names the plan, so a client can retry the sync rather than the
            // create -- and `plan doctor` reports the gap in the meantime.
            let sync_error = match open_database(&state.db_path) {
                Ok(conn) => sync_plan(&conn, &plan_file).err().map(|e| e.to_string()),
                Err(e) => Some(e.to_string()),
            };

            match sync_error {
                None => (StatusCode::CREATED, Json(json!(plan_file))).into_response(),
                Some(message) => {
                    tracing::error!(
                        "Plan {} was created on disk but could not be written to the database: {}",
                        plan_file.folder_name,
                        message
                    );
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "error": format!(
                                "Plan was created on disk but could not be written to the database: {}",
                                message
                            ),
                            "plan": plan_file,
                        })),
                    )
                        .into_response()
                }
            }
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

    // Set when this request moves the plan *into* `Skipped`, so the worktree reclaim below can be
    // spawned only after `plan.yaml` has actually been written.
    let mut reclaim_worktrees = false;

    if body.field.eq_ignore_ascii_case("state") {
        if let Some(new_state) = PlanStatus::from_str_loose(&body.value) {
            let was_completed = plan.state.eq_ignore_ascii_case("completed");
            let will_be_completed = new_state == PlanStatus::Completed;
            let was_skipped = plan.state.eq_ignore_ascii_case("skipped");
            match PlanCompletionGuard::apply_state(
                &mut plan,
                new_state,
                body.allow_failed_verifications,
                &plan_id,
            ) {
                Ok(_) => {
                    // V1's `DiscardPlanDialog` paired its `Skipped` transition with
                    // `WorktreeCleanupService.RemoveWorktreesInBackground`, with the reason: "Discard
                    // is an explicit 'I don't want this' — reclaim the worktree promptly instead of
                    // waiting for the background reaper." Discard is gone from the UI, but the
                    // behaviour belongs to the *transition*, not to the button that used to make it,
                    // so it lives here now and covers every route to `Skipped` — the delete dialog's
                    // "Move to Skipped", the CLI, and anything else that writes the field.
                    //
                    // `spawn_worktree_reaper` would get there eventually, but only after
                    // `worktreeReaperGrace`; a plan the operator has explicitly given up on should
                    // not hold a checkout for that long.
                    reclaim_worktrees = !was_skipped && new_state == PlanStatus::Skipped;

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

    // Fire-and-forget, as V1's `Task.Run(() => RemoveWorktrees(...))` is: the caller gets its 200 for
    // a state change that has already been persisted, and does not wait on `git worktree remove` plus
    // a recursive delete. Ordered after the write on purpose — reclaiming for a transition that then
    // failed to persist would destroy a checkout the plan still believes it has.
    //
    // `cleanup_worktrees` is best-effort per directory and leaves branches alone, which is the same
    // call `reset_plan_handler` makes: the branch is often the only ref holding what execution
    // produced, and the reaper's configured `worktreeBranchDeleteMode` is what decides its fate.
    if reclaim_worktrees {
        let plan_folder = folder.clone();
        tokio::task::spawn_blocking(move || {
            if let Err(e) = cleanup_worktrees(&plan_folder) {
                tracing::warn!(
                    "Background worktree cleanup failed for {}: {}",
                    plan_folder.display(),
                    e
                );
            }
        });
    }

    (
        StatusCode::OK,
        Json(json!({ "message": format!("Field '{}' updated", body.field) })),
    )
}

/// Answers 200 whether or not the plan is valid: a caller pre-flighting a plan needs "the plan is
/// invalid" to be distinguishable from "the request was malformed". Only an unknown plan is a 404.
pub async fn validate_plan_handler(
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

    let issues = check_plan_health(&folder);
    let valid = !issues
        .iter()
        .any(|i| i.severity.eq_ignore_ascii_case("Error"));
    let message = if issues.is_empty() {
        "Plan is valid".to_string()
    } else {
        issues
            .iter()
            .map(|i| i.message.clone())
            .collect::<Vec<_>>()
            .join("; ")
    };

    (
        StatusCode::OK,
        Json(json!({
            "valid": valid,
            "message": message,
            "issues": issues
                .iter()
                .map(|i| json!({ "severity": i.severity, "message": i.message }))
                .collect::<Vec<_>>(),
        })),
    )
        .into_response()
}
