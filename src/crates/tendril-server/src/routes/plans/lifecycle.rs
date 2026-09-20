//! The plan folder's lifecycle: inspecting the repos it would touch, its git worktrees and
//! commits, resetting it to Draft, and deleting it outright.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::load_config;
use tendril_core::db::{delete_plan as delete_plan_row, open_database, sync_plan};
use tendril_core::git::{build_plan_git_data, cleanup_worktrees, run_git};
use tendril_core::models::PlanStatus;
use tendril_core::plans::{read_plan_file, read_plan_yaml, resolve_plan_folder, write_plan_yaml};

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
