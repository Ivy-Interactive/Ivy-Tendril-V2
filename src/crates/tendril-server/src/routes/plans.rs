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
use tendril_core::db::{
    delete_plan as delete_plan_row, get_plans_limited, open_database, sync_plan,
};
use tendril_core::error::TendrilError;
use tendril_core::git::{build_plan_git_data, cleanup_worktrees, run_git};
use tendril_core::jobs::firmware_values::find_project;
use tendril_core::models::{
    PlanStatus, PlanVerificationEntry, PlanYaml, RecommendationStatus, VerificationStatus,
};
use tendril_core::plans::seed_plan_from_project;
use tendril_core::plans::{
    accept_recommendation, add_plan_verification, add_recommendation, check_plan_health,
    clear_annotations, clear_diff_comments, create_plan, decline_recommendation, get_plan_field,
    get_revision, list_plan_verifications, list_recommendations, read_annotations,
    read_diff_comments, read_plan_file, read_plan_yaml, remove_annotation, remove_diff_comment,
    remove_plan_verification, remove_recommendation, resolve_plan_folder, resolve_plan_folder_name,
    set_plan_verification_status, set_recommendation_field, set_recommendation_state,
    update_latest_revision, upsert_annotation, upsert_diff_comment, write_annotations,
    write_diff_comments, write_plan_yaml, write_revision, Annotation, CreatePlanOptions,
    DraftComment, PlanCompletionGuard, SUPPORTED_PLAN_FIELDS,
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

/// `plan.yaml` does not carry the plan id — it lives in the folder name (`00042-FixLoginBug`).
fn plan_id_from_folder_name(folder_name: &str) -> i32 {
    folder_name
        .split('-')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn error_response(code: StatusCode, message: String) -> axum::response::Response {
    (code, Json(json!({ "error": message }))).into_response()
}

fn message_response(message: &str) -> axum::response::Response {
    (StatusCode::OK, Json(json!({ "message": message }))).into_response()
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

#[derive(Debug, Deserialize)]
pub struct UpdateLatestRevisionBody {
    pub content: String,
}

/// Overwrites the newest revision in place, keeping its number.
///
/// This is the route answering a question needs, and it is deliberately not the `POST` above.
/// Answering a question is not a new revision of the plan, it is filling in a blank the plan left —
/// V1 says so and routes answers through `UpdateLatestRevision` for that reason. Appending would
/// claim the agent produced a new plan, and would inflate `revisionCount`, which the client's
/// unfolded-answer guard reads as `revisionCount === 1`; one answer would switch that guard off.
///
/// `revision` comes back unchanged so a caller can assert nothing moved.
pub async fn update_latest_revision_handler(
    State(state): State<Arc<AppState>>,
    Path(plan_id): Path<String>,
    Json(body): Json<UpdateLatestRevisionBody>,
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

    match update_latest_revision(&folder, &body.content) {
        Ok(rev_num) => {
            // `updated` moves because the plan's content changed, but the revision count does not —
            // which is the whole point of this route, so `sync_plan` must run to refresh the row
            // without it appearing to gain a revision.
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
                    "message": format!("Revision {:03} updated", rev_num)
                })),
            )
        }
        Err(TendrilError::Validation(e)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Validation failed: {}", e) })),
        ),
        // "no revision to update" is the caller asking to fill a blank in a plan that has no body
        // yet. That is a bad request, not a server fault.
        Err(TendrilError::Plan(e)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to update revision: {}", e) })),
        ),
    }
}

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

fn folder_name_of(folder: &std::path::Path) -> String {
    folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string()
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

// --- Recommendations Handlers ---

#[derive(Debug, Deserialize)]
pub struct AddRecommendationBody {
    pub title: String,
    pub description: String,
    pub impact: Option<String>,
}

/// Body of `PUT /api/plans/:id/recommendations/:title`. Every field is optional so the two shapes
/// coexist: `{field, value}` edits one field of the recommendation, while `{state, declineReason}` is
/// the state-only contract the desktop app and the contract tests already send.
#[derive(Debug, Deserialize)]
pub struct UpdateRecommendationBody {
    pub state: Option<String>,
    #[serde(rename = "declineReason")]
    pub decline_reason: Option<String>,
    pub notes: Option<String>,
    pub field: Option<String>,
    pub value: Option<String>,
}

/// Body of `PUT /api/plans/:id/recommendations/:title/accept`. The notes are optional, and so is the
/// body itself.
#[derive(Debug, Default, Deserialize)]
pub struct AcceptRecommendationBody {
    pub notes: Option<String>,
}

/// Body of `PUT /api/plans/:id/recommendations/:title/decline`.
#[derive(Debug, Default, Deserialize)]
pub struct DeclineRecommendationBody {
    pub reason: Option<String>,
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

    // `{field, value}` edits content, `{state, ...}` moves the recommendation through its lifecycle.
    // Neither is a 404 case, so the failure modes are distinguished below rather than collapsed into
    // one status the way this handler used to.
    let result = match (body.field.as_deref(), body.state.as_deref()) {
        (Some(field), _) => {
            let Some(value) = body.value.as_deref() else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Field edits require a 'value'" })),
                )
                    .into_response();
            };
            set_recommendation_field(&folder, &title, field, value)
        }
        (None, Some(new_state)) => set_recommendation_state(
            &folder,
            &title,
            new_state,
            body.notes.as_deref().or(body.decline_reason.as_deref()),
        ),
        (None, None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Provide either 'field' and 'value', or 'state'" })),
            )
                .into_response();
        }
    };

    match result {
        Ok(_) => {
            sync_plan_folder(&state, &folder);
            (
                StatusCode::OK,
                Json(json!({ "message": "Recommendation updated" })),
            )
                .into_response()
        }
        Err(e) => recommendation_error_response(e, "update"),
    }
}

/// Syncs a plan folder into the database, best-effort. Every recommendation write path ends here,
/// which is what keeps the `Recommendations` projection in step with `plan.yaml`.
fn sync_plan_folder(state: &Arc<AppState>, folder: &std::path::Path) {
    if let Ok(pf) = read_plan_file(folder) {
        if let Ok(conn) = open_database(&state.db_path) {
            let _ = sync_plan(&conn, &pf);
        }
    }
}

/// Maps a recommendation write failure onto a status code. The core layer reports all of these as
/// `TendrilError::Plan`, so the message is what distinguishes them: a missing recommendation is a
/// `404`, a rename onto an existing title is a `409`, and an invalid field, state or impact is a
/// `400`.
fn recommendation_error_response(e: TendrilError, verb: &str) -> axum::response::Response {
    let message = e.to_string();
    let status = if message.contains("not found") {
        StatusCode::NOT_FOUND
    } else if message.contains("already exists") {
        StatusCode::CONFLICT
    } else {
        StatusCode::BAD_REQUEST
    };

    (
        status,
        Json(json!({ "error": format!("Failed to {} recommendation: {}", verb, message) })),
    )
        .into_response()
}

/// `PUT /api/plans/:id/recommendations/:title/accept` — accepts a recommendation, storing any notes.
/// The response echoes the state it landed in, so the caller sees whether the notes promoted it to
/// `AcceptedWithNotes`.
pub async fn accept_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, title)): Path<(String, String)>,
    body: Option<Json<AcceptRecommendationBody>>,
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

    let notes = body.and_then(|Json(b)| b.notes);

    match accept_recommendation(&folder, &title, notes.as_deref()) {
        Ok(new_state) => {
            sync_plan_folder(&state, &folder);
            (StatusCode::OK, Json(json!({ "state": new_state }))).into_response()
        }
        Err(e) => recommendation_error_response(e, "accept"),
    }
}

/// `PUT /api/plans/:id/recommendations/:title/decline` — declines a recommendation with an optional
/// reason.
pub async fn decline_recommendation_handler(
    State(state): State<Arc<AppState>>,
    Path((plan_id, title)): Path<(String, String)>,
    body: Option<Json<DeclineRecommendationBody>>,
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

    let reason = body.and_then(|Json(b)| b.reason);

    match decline_recommendation(&folder, &title, reason.as_deref()) {
        Ok(_) => {
            sync_plan_folder(&state, &folder);
            (
                StatusCode::OK,
                Json(json!({ "state": RecommendationStatus::DECLINED })),
            )
                .into_response()
        }
        Err(e) => recommendation_error_response(e, "decline"),
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
    matches!(state.to_ascii_lowercase().as_str(), "completed" | "skipped")
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

/// `GET /api/plans/:id/git` — the plan's worktrees, its commits grouped under them, and a
/// reachability verdict for the commits no worktree accounts for.
///
/// A sub-resource rather than a field on `GET /api/plans/:id`: answering it runs several git
/// processes per worktree, and the plan detail is polled by views that never open the Git tab.
///
/// Read-only and forgiving in the same way as `repo-status` — a repo that cannot be inspected
/// contributes no answer rather than failing the request.
pub async fn plan_git_handler(
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
                .into_response()
        }
    };

    let (plan, _) = match read_plan_yaml(&folder) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read plan.yaml: {}", e) })),
            )
                .into_response()
        }
    };

    let repo_paths: Vec<std::path::PathBuf> = effective_repos(&state, &plan)
        .into_iter()
        .map(std::path::PathBuf::from)
        .collect();

    let data = build_plan_git_data(&folder, &plan.commits, &repo_paths);
    (StatusCode::OK, Json(json!(data))).into_response()
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

    let plans_root =
        std::fs::canonicalize(&state.plans_dir).unwrap_or_else(|_| state.plans_dir.clone());
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
