//! A project's review actions — the configuration of them, whether each one's condition holds for a
//! plan, and running one.
//!
//! `execute_review_action` starts a PTY session; the session plumbing itself lives in
//! [`crate::pty`], and only the keystroke and resize routes that drive a running one are here.

use super::payloads::{ExecuteReviewActionParams, ReviewActionConditionsParams};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::config::{expand_variables, load_config, save_config};
use tendril_core::jobs::hooks::{
    evaluate_condition, shell_hook_executor, ConditionVerdict, HookCommandSpec, HookExecutor,
};
use tendril_core::models::{ProjectConfig, ReviewActionConfig};
use tendril_core::plans::helpers::resolve_plan_folder;

#[derive(Debug, Deserialize)]
pub struct AddReviewActionRequest {
    pub name: String,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub before: Option<String>,
    #[serde(default)]
    pub after: Option<String>,
}

pub async fn add_project_review_action(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<AddReviewActionRequest>,
) -> impl IntoResponse {
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

    let action_name = req.name.trim().to_string();
    if action_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Review action name cannot be empty" })),
        )
            .into_response();
    }

    settings.projects[proj_idx]
        .review_actions
        .retain(|a| !a.name.eq_ignore_ascii_case(&action_name));

    let review_actions = &settings.projects[proj_idx].review_actions;
    let insert_idx = if let Some(target) = req.before.as_deref() {
        match review_actions
            .iter()
            .position(|a| a.name.eq_ignore_ascii_case(target))
        {
            Some(idx) => idx,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!(
                            "Review action '{}' not found in project '{}'. Available: {}",
                            target,
                            name,
                            review_actions.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
                        )
                    })),
                )
                    .into_response();
            }
        }
    } else if let Some(target) = req.after.as_deref() {
        match review_actions
            .iter()
            .position(|a| a.name.eq_ignore_ascii_case(target))
        {
            Some(idx) => idx + 1,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!(
                            "Review action '{}' not found in project '{}'. Available: {}",
                            target,
                            name,
                            review_actions.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
                        )
                    })),
                )
                    .into_response();
            }
        }
    } else {
        review_actions.len()
    };

    settings.projects[proj_idx].review_actions.insert(
        insert_idx,
        ReviewActionConfig {
            name: action_name.clone(),
            condition: req.condition,
            command: req.command,
            paths: req.paths,
            extra: Default::default(),
        },
    );

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
            "message": format!("Review action '{}' added to project '{}'", action_name, name)
        })),
    )
        .into_response()
}

pub async fn remove_project_review_action(
    State(state): State<Arc<AppState>>,
    Path((name, action)): Path<(String, String)>,
) -> impl IntoResponse {
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

    let before = settings.projects[proj_idx].review_actions.len();
    settings.projects[proj_idx]
        .review_actions
        .retain(|a| !a.name.eq_ignore_ascii_case(&action));

    if settings.projects[proj_idx].review_actions.len() == before {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": format!("Review action '{}' not found in project '{}'", action, name)
            })),
        )
            .into_response();
    }

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
            "message": format!("Review action '{}' removed from project '{}'", action, name)
        })),
    )
        .into_response()
}

/// How long a review action's shell condition may run before it is killed and reported as
/// unevaluable. V1's `PlatformHelper.EvaluatePowerShellCondition(..., timeoutMs = 5000)`: half the
/// hooks' budget, because a reviewer is looking at the button while it is decided, and inside the
/// app's own 10s request timeout with room to spare.
pub const REVIEW_ACTION_CONDITION_TIMEOUT: Duration = Duration::from_secs(5);

/// How a review action's condition stands for one plan — what decides whether its button can be
/// pressed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewActionConditionState {
    /// The condition holds, or the action has none.
    Met,
    /// The condition was evaluated and does not hold. V1 disabled the button on exactly this.
    NotMet,
    /// The condition could not be evaluated at all. Not folded into `NotMet`: a condition nobody
    /// could check has not failed, and a button disabled "because the condition is not met" when it
    /// was never run would be a false statement to the reviewer.
    Unknown,
}

/// One review action's condition verdict, as `GET /api/projects/:name/review-actions` returns it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewActionCondition {
    pub name: String,
    /// The condition as configured, before variable expansion — what the reviewer wrote and would
    /// recognise in a tooltip.
    pub condition: String,
    pub state: ReviewActionConditionState,
    /// Why the condition could not be evaluated. Present only for `Unknown`: a condition that does
    /// not hold is explained by the condition itself, which is all V1's
    /// `Disabled: Condition not met (<condition>)` tooltip ever said.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Every review action of a project, each with its `condition` evaluated for one plan.
///
/// V1's `ContentView` precomputed `ReviewActionStates` with
/// `PlatformHelper.EvaluatePowerShellCondition(action.Condition, folderPath)` and
/// `ReviewActionsBarView.BuildActionButton` disabled every button whose condition did not hold. The
/// webview has neither a filesystem nor a shell, so it cannot answer that itself — this route is
/// where the answer comes from.
///
/// The evaluation is the hooks' own ([`evaluate_condition`]), not a second copy of it: V1 ran both
/// kinds of condition as PowerShell against the plan folder, and so does this. A PowerShell-shaped
/// condition (`Test-Path "Worktrees/Repo/src"`) is decided in-process against the plan folder; any
/// other is run through the shell from the plan folder, with the environment the action's own
/// command would get, and killed after [`REVIEW_ACTION_CONDITION_TIMEOUT`]. All of them run
/// concurrently, so one slow condition costs its own timeout rather than the sum of them.
///
/// `400` without a `planId`, `404` for an unknown project or plan. The answer is in config order.
pub async fn review_action_conditions(
    State(state): State<Arc<AppState>>,
    Path(project_name): Path<String>,
    Query(params): Query<ReviewActionConditionsParams>,
) -> impl IntoResponse {
    let Some(plan_id) = params
        .plan_id
        .map(|p| p.to_string_val())
        .filter(|s| !s.trim().is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "planId is required: a review action's condition is evaluated against a plan folder"
            })),
        )
            .into_response();
    };

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
        .find(|p| p.name.eq_ignore_ascii_case(&project_name))
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", project_name) })),
        )
            .into_response();
    };

    let Ok(plan_folder) = resolve_plan_folder(&plan_id, &state.plans_dir) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Plan '{}' not found", plan_id) })),
        )
            .into_response();
    };

    let ActionEnvironment { env, .. } =
        action_environment(&state, project, Some(&plan_id), Some(plan_folder.as_path()));
    let tendril_home = state.tendril_home.to_string_lossy().to_string();
    let executor = shell_hook_executor();

    let evaluations = project.review_actions.iter().map(|action| {
        evaluate_review_action_condition(
            action,
            HookCommandSpec {
                hook_name: action.name.clone(),
                command: expand_variables(&action.condition, &tendril_home),
                working_dir: plan_folder.clone(),
                env: env.clone(),
                timeout: REVIEW_ACTION_CONDITION_TIMEOUT,
            },
            &executor,
        )
    });
    let conditions = futures_util::future::join_all(evaluations).await;

    (StatusCode::OK, Json(conditions)).into_response()
}

/// One action's verdict. `spec.command` is its already-expanded condition.
async fn evaluate_review_action_condition(
    action: &ReviewActionConfig,
    spec: HookCommandSpec,
    executor: &HookExecutor,
) -> ReviewActionCondition {
    let (state, reason) = if spec.command.trim().is_empty() {
        // V1: `if (string.IsNullOrEmpty(action.Condition)) actionStates[i] = (action.Name, true)`.
        (ReviewActionConditionState::Met, None)
    } else {
        match evaluate_condition(spec, executor).await {
            ConditionVerdict::Holds => (ReviewActionConditionState::Met, None),
            ConditionVerdict::NotMet { .. } => (ReviewActionConditionState::NotMet, None),
            ConditionVerdict::Unevaluable { why, .. } => {
                (ReviewActionConditionState::Unknown, Some(why))
            }
        }
    };

    ReviewActionCondition {
        name: action.name.clone(),
        condition: action.condition.clone(),
        state,
        reason,
    }
}

/// The ports a review action runs with and the environment it runs in.
struct ActionEnvironment {
    ports: Vec<(String, u16)>,
    env: Vec<(String, String)>,
}

/// What [`execute_review_action`] hands the pty, and what [`review_action_conditions`] hands a shell
/// condition — the same, so a condition asking about `$WORKTREE_DIR` asks about the directory the
/// command it gates would run against.
///
/// `plan_folder` is the resolved folder of `plan_id`, when there is one.
fn action_environment(
    state: &AppState,
    project: &ProjectConfig,
    plan_id: Option<&str>,
    plan_folder: Option<&std::path::Path>,
) -> ActionEnvironment {
    let plan_yaml = plan_folder
        .and_then(|folder| tendril_core::plans::reader::read_plan_yaml(folder).ok())
        .map(|(plan, _)| plan);

    let ports = crate::pty::resolve_ports(
        Some(project),
        plan_yaml.as_ref().and_then(|p| p.allocated_ports.as_ref()),
    );

    // `PLAN_ID` is the padded form a plan is known by everywhere else, so a review action can build
    // a path out of it.
    let padded_plan_id = plan_id.map(|pid| {
        let trimmed = pid.trim();
        trimmed
            .parse::<u32>()
            .map(|n| format!("{n:05}"))
            .unwrap_or_else(|_| trimmed.to_string())
    });
    let plan_context = match (padded_plan_id.as_deref(), plan_folder, plan_yaml.as_ref()) {
        (Some(id), Some(folder), Some(plan)) => Some(crate::pty::PlanEnvContext {
            plan_id: id,
            plan_folder: folder,
            project: &project.name,
            repos: &plan.repos,
        }),
        _ => None,
    };

    let mut env = vec![(
        "TENDRIL_HOME".to_string(),
        state.tendril_home.to_string_lossy().to_string(),
    )];
    env.extend(crate::pty::build_environment(
        &ports,
        plan_context.as_ref(),
        Some(&project.name),
    ));

    ActionEnvironment { ports, env }
}

pub async fn execute_review_action(
    State(state): State<Arc<AppState>>,
    Path((project_name, action_name)): Path<(String, String)>,
    Query(query): Query<ExecuteReviewActionParams>,
    body_bytes: axum::body::Bytes,
) -> impl IntoResponse {
    let body_params: Option<ExecuteReviewActionParams> = if !body_bytes.is_empty() {
        serde_json::from_slice(&body_bytes).ok()
    } else {
        None
    };

    let plan_id = body_params
        .as_ref()
        .and_then(|b| b.plan_id.as_ref())
        .or(query.plan_id.as_ref())
        .map(|p| p.to_string_val())
        .filter(|s| !s.trim().is_empty());

    let worktree = body_params
        .as_ref()
        .and_then(|b| b.worktree.clone())
        .or(query.worktree)
        .filter(|s| !s.trim().is_empty());

    let settings = load_config(&state.config_path).unwrap_or_default();
    let project = match settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&project_name))
    {
        Some(p) => p,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", project_name) })),
            )
                .into_response();
        }
    };

    let action = match project
        .review_actions
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case(&action_name))
    {
        Some(a) => a,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({
                    "error": format!(
                        "Review action '{}' not found for project '{}'",
                        action_name, project_name
                    )
                })),
            )
                .into_response();
        }
    };

    if action.command.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Review action '{}' has no command configured", action.name)
            })),
        )
            .into_response();
    }

    let working_dir: PathBuf = if let Some(ref pid) = plan_id {
        let plan_folder = match resolve_plan_folder(pid, &state.plans_dir) {
            Ok(f) => f,
            Err(_) => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": format!("Plan '{}' not found", pid) })),
                )
                    .into_response();
            }
        };

        if action.command.contains("Worktrees/") || action.command.contains("cd Worktrees") {
            plan_folder
        } else if let Some(ref wt) = worktree {
            let candidate1 = plan_folder.join("Worktrees").join(wt);
            if candidate1.exists() {
                candidate1
            } else {
                let candidate2 = plan_folder.join(wt);
                if candidate2.exists() {
                    candidate2
                } else {
                    candidate1
                }
            }
        } else {
            let worktrees_dir = plan_folder.join("Worktrees");
            let mut resolved = plan_folder.clone();
            if worktrees_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&worktrees_dir) {
                    let mut subdirs: Vec<_> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| p.is_dir())
                        .collect();
                    subdirs.sort();
                    if subdirs.len() == 1 {
                        let single = &subdirs[0];
                        if let Ok(sub_entries) = std::fs::read_dir(single) {
                            let mut nested: Vec<_> = sub_entries
                                .filter_map(|e| e.ok())
                                .map(|e| e.path())
                                .filter(|p| {
                                    p.is_dir() && !p.file_name().is_some_and(|n| n == ".git")
                                })
                                .collect();
                            nested.sort();
                            if nested.len() == 1 {
                                resolved = nested[0].clone();
                            } else {
                                resolved = single.clone();
                            }
                        } else {
                            resolved = single.clone();
                        }
                    } else if !subdirs.is_empty() {
                        resolved = subdirs[0].clone();
                    }
                }
            }
            resolved
        }
    } else if let Some(first_repo) = project.repos.first() {
        let expanded = tendril_core::config::expand_variables(
            &first_repo.path,
            &state.tendril_home.to_string_lossy(),
        );
        PathBuf::from(expanded)
    } else {
        state.tendril_home.clone()
    };

    // Everything from here on is the plan's ports and environment, then the pty. The resolution
    // above — project, action, working directory — is all this route still does itself.
    let plan_folder = plan_id
        .as_deref()
        .and_then(|pid| resolve_plan_folder(pid, &state.plans_dir).ok());
    let ActionEnvironment { ports, env } =
        action_environment(&state, project, plan_id.as_deref(), plan_folder.as_deref());

    // `sh` will not expand `%PORT%`, so the command has to carry the resolved values before it is
    // handed over; the injected environment covers only what the command reads itself.
    let command = crate::pty::interpolate_command(&action.command, &ports);

    let stream = match crate::pty::spawn_review_action(
        &command,
        working_dir.exists().then_some(working_dir.as_path()),
        &env,
    ) {
        Ok(stream) => stream,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e })),
            )
                .into_response();
        }
    };

    // Shutdown-aware, so a terminal left open does not hold the daemon on its graceful-shutdown
    // grace period. See `pty::shutdown_aware_body`.
    let body = crate::pty::shutdown_aware_body(stream.frames, state.shutdown_rx.clone());
    axum::response::sse::Sse::new(body).into_response()
}

/// Keystrokes for a running review action, addressed by the session id from its `meta` frame.
///
/// `data` is base64 for the same reason the `log` frames are: an arrow key or a Ctrl-C is a control
/// byte, and round-tripping those through JSON as text loses them.
#[derive(Debug, Deserialize)]
pub struct ReviewActionInputRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(default)]
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct ReviewActionResizeRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    pub rows: u16,
    pub cols: u16,
}

/// Writes the client's keystrokes into the action's pty.
///
/// The project and action in the path are not what identifies the target — the session id is, so two
/// runs of the same action never write into each other. They stay in the path so this sits beside
/// `execute` rather than in a namespace of its own.
pub async fn review_action_input(
    Path((_project_name, _action_name)): Path<(String, String)>,
    Json(request): Json<ReviewActionInputRequest>,
) -> impl IntoResponse {
    let Some(session) = crate::pty::session(&request.session_id) else {
        return session_not_found(&request.session_id);
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(request.data.as_bytes()) {
        Ok(bytes) => bytes,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Input data is not valid base64: {}", e) })),
            )
                .into_response();
        }
    };

    match session.write_input(&bytes) {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ok" }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write to the terminal: {}", e) })),
        )
            .into_response(),
    }
}

/// Tells the action's pty how big the client's terminal is, which is what makes a process that
/// wraps its own output redraw to fit.
pub async fn review_action_resize(
    Path((_project_name, _action_name)): Path<(String, String)>,
    Json(request): Json<ReviewActionResizeRequest>,
) -> impl IntoResponse {
    let Some(session) = crate::pty::session(&request.session_id) else {
        return session_not_found(&request.session_id);
    };

    // A zero dimension is what a client sends before its terminal has been laid out; applying it
    // would tell the process it has no window at all.
    if request.rows == 0 || request.cols == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Terminal size must be at least 1x1" })),
        )
            .into_response();
    }

    match session.resize(request.rows, request.cols) {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ok" }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to resize the terminal: {}", e) })),
        )
            .into_response(),
    }
}

/// A session that has exited is indistinguishable from one that never existed, and both are a `404`
/// rather than an error: a client racing the `end` frame has done nothing wrong.
fn session_not_found(session_id: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": format!("Review action session '{}' is not running", session_id)
        })),
    )
        .into_response()
}
