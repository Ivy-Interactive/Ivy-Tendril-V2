//! Handlers for plan review surfaces: code changes, summary, and artifacts.

use super::lifecycle::effective_repos;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::git::build_plan_changes_data;
use tendril_core::plans::{read_plan_yaml, resolve_plan_folder};

/// `GET /api/plans/:id/changes` — file diffs and metrics for code changes made by the plan.
pub async fn plan_changes_handler(
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

    let repo_paths: Vec<PathBuf> = effective_repos(&state, &plan)
        .into_iter()
        .map(PathBuf::from)
        .collect();

    let data = build_plan_changes_data(&folder, &plan.commits, &repo_paths);
    (StatusCode::OK, Json(json!(data))).into_response()
}

fn extract_last_agent_text(lines: &[String]) -> Option<String> {
    for line in lines.iter().rev() {
        if let Some(text) = tendril_core::jobs::failure_analysis::agent_text(line) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                let snippet = if trimmed.len() > 3000 {
                    let start = trimmed.len() - 3000;
                    format!("... (earlier output omitted)\n{}", &trimmed[start..])
                } else {
                    trimmed.to_string()
                };
                return Some(snippet);
            }
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(resp) = v
                .get("result")
                .and_then(|r| r.get("response"))
                .and_then(|s| s.as_str())
            {
                let trimmed = resp.trim();
                if !trimmed.is_empty() {
                    let snippet = if trimmed.len() > 3000 {
                        let start = trimmed.len() - 3000;
                        format!("... (earlier output omitted)\n{}", &trimmed[start..])
                    } else {
                        trimmed.to_string()
                    };
                    return Some(snippet);
                }
            }
        }
    }
    None
}

fn resolve_diagnostic_summary(state: &AppState, folder: &std::path::Path) -> Option<String> {
    let conn = tendril_core::db::open_database(&state.db_path).ok()?;
    let folder_name = folder.file_name()?.to_str()?;
    let pattern = format!("%{}%", folder_name);

    let mut stmt = conn
        .prepare(
            "SELECT Id, Type, Status, StatusMessage, ReportedFailureReason \
             FROM Jobs WHERE PlanFile LIKE ?1 COLLATE NOCASE ORDER BY Id DESC LIMIT 1",
        )
        .ok()?;

    let row = stmt
        .query_row([pattern], |r| {
            let id: String = r.get(0)?;
            let job_type: String = r.get(1)?;
            let status: String = r.get(2)?;
            let status_msg: Option<String> = r.get(3)?;
            let failure_reason: Option<String> = r.get(4)?;
            Ok((id, job_type, status, status_msg, failure_reason))
        })
        .ok()?;

    let (job_id, job_type, status, status_msg, failure_reason) = row;

    let mut agent_output: Option<String> = None;
    if let Ok(Some(lines)) =
        tendril_core::jobs::logger::read_eventwire_log(&state.tendril_home, &job_id, None)
    {
        agent_output = extract_last_agent_text(&lines);
    }
    if agent_output.is_none() {
        if let Ok(Some(lines)) =
            tendril_core::jobs::logger::read_raw_log(&state.tendril_home, &job_id, None)
        {
            agent_output = extract_last_agent_text(&lines);
        }
    }

    let detail = failure_reason
        .or(status_msg)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| status.clone());

    if let Some(output) = agent_output {
        Some(format!(
            "# Execution Summary\n\n> [!CAUTION]\n> No summary was generated because execution did not complete successfully.\n>\n> **Job {job_id} ({job_type}):** {detail}\n>\n> `Reset to Draft` or `Request Changes` to retry the plan.\n\n### Last Agent Output\n\n```\n{output}\n```\n"
        ))
    } else if matches!(status.as_str(), "Failed" | "Timeout" | "Stopped" | "Cancelled") {
        Some(format!(
            "# Execution Summary\n\n> [!CAUTION]\n> No summary was generated because execution did not complete successfully.\n>\n> **Job {job_id} ({job_type}):** {detail}\n>\n> `Reset to Draft` or `Request Changes` to retry the plan.\n"
        ))
    } else {
        None
    }
}

/// `GET /api/plans/:id/summary` — reads `<planFolder>/Artifacts/summary.md` if present,
/// or synthesizes a diagnostic summary from the latest job when execution failed.
pub async fn plan_summary_handler(
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

    let summary_path = folder.join("Artifacts").join("summary.md");
    let summary = if summary_path.is_file() {
        std::fs::read_to_string(&summary_path)
            .ok()
            .filter(|s| !s.trim().is_empty())
    } else {
        None
    }
    .or_else(|| resolve_diagnostic_summary(&state, &folder));

    (StatusCode::OK, Json(json!({ "summary": summary }))).into_response()
}

/// `GET /api/plans/:id/artifacts` — lists screenshot and other files in `<planFolder>/Artifacts`.
pub async fn plan_artifacts_handler(
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

    let artifacts_dir = folder.join("Artifacts");
    let mut screenshots = Vec::new();
    let mut other = Vec::new();

    if artifacts_dir.is_dir() {
        let screenshots_dir = artifacts_dir.join("screenshots");
        if screenshots_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&screenshots_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let is_img = path
                            .extension()
                            .and_then(|ext| ext.to_str())
                            .map(|ext| {
                                matches!(
                                    ext.to_ascii_lowercase().as_str(),
                                    "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
                                )
                            })
                            .unwrap_or(false);
                        if is_img {
                            screenshots.push(path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }

        if let Ok(entries) = std::fs::read_dir(&artifacts_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with("draft_") && name != "summary.md" {
                        other.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    screenshots.sort();
    other.sort();

    (
        StatusCode::OK,
        Json(json!({
            "screenshots": screenshots,
            "other": other,
        })),
    )
        .into_response()
}
