use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{ModelCatalogStatusDto, ProjectSummaryDto, TendrilConfigDto, VersionInfoDto};

#[tauri::command]
pub async fn cmd_list_projects() -> Result<Vec<ProjectSummaryDto>, BridgeError> {
    get_client_from_master()?.list_projects().await
}

#[tauri::command]
pub async fn cmd_get_config() -> Result<TendrilConfigDto, BridgeError> {
    get_client_from_master()?.get_config().await
}

#[tauri::command]
pub async fn cmd_get_models_status() -> Result<ModelCatalogStatusDto, BridgeError> {
    get_client_from_master()?.get_models_status().await
}

#[tauri::command]
pub async fn cmd_refresh_models() -> Result<ModelCatalogStatusDto, BridgeError> {
    get_client_from_master()?.refresh_models().await
}

#[tauri::command]
pub async fn cmd_get_version_info() -> Result<VersionInfoDto, BridgeError> {
    get_client_from_master()?.get_version_info().await
}

#[tauri::command]
pub async fn cmd_check_version_now() -> Result<VersionInfoDto, BridgeError> {
    get_client_from_master()?.check_version_now().await
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
