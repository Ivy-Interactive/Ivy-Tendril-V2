use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{
    CreateProjectDto, DoctorCheckDto, ModelCatalogStatusDto, OnboardingStatusDto,
    ProjectSummaryDto, TendrilConfigDto, VersionInfoDto,
};

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

/// Writes a single top-level config key, merged into `config.yaml` server-side. The wizard uses it
/// for `codingAgent`; nothing else is touched.
#[tauri::command]
pub async fn cmd_put_config(key: String, value: serde_json::Value) -> Result<(), BridgeError> {
    get_client_from_master()?.put_config(&key, value).await
}

#[tauri::command]
pub async fn cmd_get_onboarding_status() -> Result<OnboardingStatusDto, BridgeError> {
    get_client_from_master()?.get_onboarding_status().await
}

#[tauri::command]
pub async fn cmd_complete_onboarding() -> Result<(), BridgeError> {
    get_client_from_master()?.complete_onboarding().await
}

#[tauri::command]
pub async fn cmd_dismiss_onboarding() -> Result<(), BridgeError> {
    get_client_from_master()?.dismiss_onboarding().await
}

#[tauri::command]
pub async fn cmd_run_doctor() -> Result<Vec<DoctorCheckDto>, BridgeError> {
    get_client_from_master()?.run_doctor().await
}

#[tauri::command]
pub async fn cmd_create_project(
    request: CreateProjectDto,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.create_project(request).await
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
