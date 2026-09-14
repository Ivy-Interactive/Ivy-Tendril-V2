use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{
    DraftCommentDto, PlanDetailDto, PlanGitDto, PlanQueryDto, PlanSummaryDto, RecommendationDto,
    RepoStatusDto, RevisionResultDto, VerificationReportDto,
};

#[tauri::command]
pub async fn cmd_list_plans(
    query: Option<PlanQueryDto>,
) -> Result<Vec<PlanSummaryDto>, BridgeError> {
    get_client_from_master()?.list_plans(query).await
}

#[tauri::command]
pub async fn cmd_get_plan(id: String) -> Result<PlanDetailDto, BridgeError> {
    get_client_from_master()?.get_plan(&id).await
}

#[tauri::command]
pub async fn cmd_update_plan_field(
    id: String,
    field: String,
    value: String,
    allow_failed: Option<bool>,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .update_plan_field(&id, &field, &value, allow_failed.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn cmd_get_revision(id: String, number: Option<i32>) -> Result<String, BridgeError> {
    get_client_from_master()?.get_revision(&id, number).await
}

#[tauri::command]
pub async fn cmd_write_revision(
    id: String,
    content: String,
) -> Result<RevisionResultDto, BridgeError> {
    get_client_from_master()?
        .write_revision(&id, &content)
        .await
}

/// Permanently delete a plan: its folder on disk and its database row.
///
/// Irreversible, and the service refuses it while a job still holds the plan, so
/// the caller is expected to have confirmed with the operator first.
#[tauri::command]
pub async fn cmd_delete_plan(id: String) -> Result<(), BridgeError> {
    get_client_from_master()?.delete_plan(&id).await
}

/// Send a plan back to Draft, removing its worktrees. Refused for Completed or
/// Skipped plans and for plans a job is still running.
#[tauri::command]
pub async fn cmd_reset_plan(id: String) -> Result<(), BridgeError> {
    get_client_from_master()?.reset_plan(&id).await
}

/// Uncommitted-change status of each repo a plan targets, for the dirty-repo
/// pre-execution guard.
#[tauri::command]
pub async fn cmd_get_repo_status(id: String) -> Result<Vec<RepoStatusDto>, BridgeError> {
    get_client_from_master()?.get_repo_status(&id).await
}

/// The plan's worktrees, the commits grouped under them, and the reachability
/// verdict for the commits no worktree accounts for — the Git tab's data.
#[tauri::command]
pub async fn cmd_get_plan_git(id: String) -> Result<PlanGitDto, BridgeError> {
    get_client_from_master()?.get_plan_git(&id).await
}

/// Read one verification report for a plan.
///
/// Verification reports are markdown files ExecutePlan writes into
/// `<planFolder>/Verification/<name>.md`. The service exposes no route for
/// their content — only the global verification *definitions* — but the plan
/// folder is on the same machine as the app (the daemon is loopback-only and
/// its `.master` file lives under `TENDRIL_HOME`), so the native side reads
/// them straight off disk using `folderPath` from the plan detail.
#[tauri::command]
pub async fn cmd_get_verification_report(
    plan_id: String,
    name: String,
) -> Result<VerificationReportDto, BridgeError> {
    let folder = plan_folder(&plan_id).await?;
    crate::verification_reports::read_report(std::path::Path::new(&folder), &name)
}

/// Read every verification report that exists on disk for a plan. A
/// verification that has not run yet has no report file and is simply absent
/// from the result.
#[tauri::command]
pub async fn cmd_list_verification_reports(
    plan_id: String,
) -> Result<Vec<VerificationReportDto>, BridgeError> {
    let client = get_client_from_master()?;
    let plan = client.get_plan(&plan_id).await?;
    let folder = plan.folder_path.clone().ok_or_else(|| {
        BridgeError::not_found(format!("Plan '{plan_id}' reported no folder path"))
    })?;
    let folder = std::path::Path::new(&folder);

    let mut reports = Vec::new();
    for verification in &plan.verifications {
        match crate::verification_reports::read_report(folder, &verification.name) {
            Ok(report) => reports.push(report),
            Err(err) if err.code == "NOT_FOUND" => {}
            Err(err) => return Err(err),
        }
    }

    Ok(reports)
}

/// The plan's recommendations, as recorded in its `plan.yaml`.
#[tauri::command]
pub async fn cmd_list_recommendations(
    plan_id: String,
) -> Result<Vec<RecommendationDto>, BridgeError> {
    let plan = get_client_from_master()?.get_plan(&plan_id).await?;
    Ok(plan.recommendations)
}

/// Accept or decline a recommendation. `state` must be one of `Accepted`,
/// `AcceptedWithNotes`, `Declined` or `Pending`; `declineReason` is only
/// meaningful for `Declined` and `notes` only for `AcceptedWithNotes`.
#[tauri::command]
pub async fn cmd_set_recommendation_state(
    plan_id: String,
    title: String,
    state: String,
    decline_reason: Option<String>,
    notes: Option<String>,
) -> Result<(), BridgeError> {
    const STATES: [&str; 4] = ["Pending", "Accepted", "AcceptedWithNotes", "Declined"];
    if !STATES.contains(&state.as_str()) {
        return Err(BridgeError::validation(format!(
            "Unknown recommendation state '{state}', expected one of {}",
            STATES.join(", ")
        )));
    }

    get_client_from_master()?
        .update_recommendation(
            &plan_id,
            &title,
            &state,
            decline_reason.as_deref(),
            notes.as_deref(),
        )
        .await
}

/// Set a plan's verification status (Pending, Pass, Fail, Skipped).
#[tauri::command]
pub async fn cmd_set_verification_status(
    plan_id: String,
    name: String,
    status: String,
) -> Result<(), BridgeError> {
    const STATUSES: [&str; 4] = ["Pending", "Pass", "Fail", "Skipped"];
    if !STATUSES.contains(&status.as_str()) {
        return Err(BridgeError::validation(format!(
            "Unknown verification status '{status}', expected one of {}",
            STATUSES.join(", ")
        )));
    }

    get_client_from_master()?
        .update_verification(&plan_id, &name, &status)
        .await
}

/// Every inline diff comment drafted against a plan.
#[tauri::command]
pub async fn cmd_list_diff_comments(plan_id: String) -> Result<Vec<DraftCommentDto>, BridgeError> {
    get_client_from_master()?.list_diff_comments(&plan_id).await
}

/// Add or edit one comment. Returns the plan's whole list, so the caller can replace its state
/// wholesale instead of reconciling.
#[tauri::command]
pub async fn cmd_upsert_diff_comment(
    plan_id: String,
    comment: DraftCommentDto,
) -> Result<Vec<DraftCommentDto>, BridgeError> {
    get_client_from_master()?
        .upsert_diff_comment(&plan_id, &comment)
        .await
}

#[tauri::command]
pub async fn cmd_delete_diff_comment(
    plan_id: String,
    file_path: String,
    change_key: String,
) -> Result<Vec<DraftCommentDto>, BridgeError> {
    get_client_from_master()?
        .delete_diff_comment(&plan_id, &file_path, &change_key)
        .await
}

#[tauri::command]
pub async fn cmd_clear_diff_comments(plan_id: String) -> Result<(), BridgeError> {
    get_client_from_master()?
        .clear_diff_comments(&plan_id)
        .await
}

async fn plan_folder(plan_id: &str) -> Result<String, BridgeError> {
    let plan = get_client_from_master()?.get_plan(plan_id).await?;
    plan.folder_path
        .ok_or_else(|| BridgeError::not_found(format!("Plan '{plan_id}' reported no folder path")))
}
