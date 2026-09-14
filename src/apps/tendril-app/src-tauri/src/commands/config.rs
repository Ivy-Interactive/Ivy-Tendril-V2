use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{ProjectSummaryDto, TendrilConfigDto};

#[tauri::command]
pub async fn cmd_list_projects() -> Result<Vec<ProjectSummaryDto>, BridgeError> {
    get_client_from_master()?.list_projects().await
}

#[tauri::command]
pub async fn cmd_get_config() -> Result<TendrilConfigDto, BridgeError> {
    get_client_from_master()?.get_config().await
}

#[tauri::command]
pub async fn cmd_execute_review_action(
    project_name: String,
    action_name: String,
    plan_id: Option<String>,
    worktree: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .execute_review_action(
            &project_name,
            &action_name,
            plan_id.as_deref(),
            worktree.as_deref(),
        )
        .await
}
