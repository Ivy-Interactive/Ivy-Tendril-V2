//! `GET /api/pull-requests` — every PR recorded on a plan, joined to its cached status.
//! `POST /api/pull-requests/sync` — reconcile now, or `409` if a pass is already running.

use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tendril_core::db::open_database;
use tendril_core::db::pr_status::get_all_pr_statuses;
use tendril_core::error::Result;
use tendril_core::git::pr_sync::PrSyncReport;
use tendril_core::jobs::firmware_values::extract_plan_id_from_folder;
use tendril_core::models::{canonical_pr_url, parse_pr_url, PrState, PrStatusRecord};
use tendril_core::plans::reader::read_plan_yaml;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusDto {
    pub pr_url: String,
    pub owner: String,
    pub repo: String,
    pub number: u64,
    pub status: String,
    pub branch: Option<String>,
    /// `null` until the PR has been through one reconciliation pass.
    pub last_checked: Option<String>,
    pub plan_id: String,
    pub plan_folder: String,
    pub plan_title: String,
    pub project: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrTransitionDto {
    pub pr_url: String,
    pub from: Option<String>,
    pub to: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrSyncReportDto {
    pub tracked: usize,
    pub checked: usize,
    pub skipped_merged: usize,
    pub skipped_fresh: usize,
    pub transitions: Vec<PrTransitionDto>,
    pub completed_plans: Vec<String>,
    pub refused_completions: Vec<String>,
    pub unblocked_plans: Vec<String>,
    pub errors: Vec<String>,
    pub changed: bool,
}

impl From<&PrSyncReport> for PrSyncReportDto {
    fn from(report: &PrSyncReport) -> Self {
        Self {
            tracked: report.tracked,
            checked: report.checked,
            skipped_merged: report.skipped_merged,
            skipped_fresh: report.skipped_fresh,
            transitions: report
                .transitions
                .iter()
                .map(|t| PrTransitionDto {
                    pr_url: t.pr_url.clone(),
                    from: t.from.map(|s| s.as_str().to_string()),
                    to: t.to.as_str().to_string(),
                })
                .collect(),
            completed_plans: report.completed_plans.clone(),
            refused_completions: report.refused_completions.clone(),
            unblocked_plans: report.unblocked_plans.clone(),
            errors: report.errors.clone(),
            changed: report.changed(),
        }
    }
}

pub async fn list_pull_requests(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match collect_pull_requests(&state) {
        Ok(rows) => Json(json!(rows)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to list pull requests: {}", e) })),
        )
            .into_response(),
    }
}

/// The plans are the source of truth for *which* PRs exist; the cache only supplies status. A PR that
/// has never been synced is therefore still listed, as `Unknown` with no `lastChecked`.
fn collect_pull_requests(state: &AppState) -> Result<Vec<PrStatusDto>> {
    let cached: HashMap<String, PrStatusRecord> = {
        let conn = open_database(&state.db_path)?;
        get_all_pr_statuses(&conn)?
            .into_iter()
            .map(|rec| (rec.pr_url.clone(), rec))
            .collect()
    };

    let mut rows: Vec<PrStatusDto> = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    if state.plans_dir.exists() {
        for entry in std::fs::read_dir(&state.plans_dir)?.flatten() {
            let folder = entry.path();
            if !folder.is_dir() || !folder.join("plan.yaml").exists() {
                continue;
            }
            let Ok((plan, _)) = read_plan_yaml(&folder) else {
                continue;
            };
            let plan_folder = folder
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            let plan_id = extract_plan_id_from_folder(&folder).unwrap_or_default();

            for raw in &plan.prs {
                let Some((owner, repo, number)) = parse_pr_url(raw) else {
                    continue;
                };
                let pr_url = canonical_pr_url(raw).unwrap_or_else(|| raw.clone());
                // The same PR recorded twice on one plan is one row.
                let dedupe_key = format!("{}|{}", plan_folder, pr_url);
                if seen.contains(&dedupe_key) {
                    continue;
                }
                seen.push(dedupe_key);

                let record = cached.get(&pr_url);
                rows.push(PrStatusDto {
                    pr_url,
                    owner,
                    repo,
                    number,
                    status: record
                        .map(|r| r.status)
                        .unwrap_or(PrState::Unknown)
                        .as_str()
                        .to_string(),
                    branch: record.and_then(|r| r.branch.clone()),
                    last_checked: record.map(|r| r.last_checked.to_rfc3339()),
                    plan_id: plan_id.clone(),
                    plan_folder: plan_folder.clone(),
                    plan_title: plan.title.clone(),
                    project: plan.project.clone(),
                });
            }
        }
    }

    // Newest plan first, and within a plan the highest PR number first.
    rows.sort_by(|a, b| {
        b.plan_id
            .cmp(&a.plan_id)
            .then_with(|| b.number.cmp(&a.number))
    });

    Ok(rows)
}

pub async fn sync_pull_requests(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let pass = crate::pr_sync::run_pr_sync_pass(
        &state.db_path,
        &state.plans_dir,
        &state.pr_sync_running,
        &state.ws_tx,
    )
    .await;

    match pass {
        Some(Ok(report)) => {
            crate::pr_sync::log_report(&report);
            Json(json!(PrSyncReportDto::from(&report))).into_response()
        }
        Some(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("PR status sync failed: {}", e) })),
        )
            .into_response(),
        None => (
            StatusCode::CONFLICT,
            Json(json!({ "error": "A pull request sync is already running" })),
        )
            .into_response(),
    }
}
