use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{
    CreateProjectDto, DoctorCheckDto, ModelCatalogStatusDto, OnboardingStatusDto,
    ProjectSummaryDto, TendrilConfigDto,
};
use crate::service::review_action_bridge::{self, StartedReviewAction};

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

/// Starts a review action and returns the session the webview must address to talk to it.
///
/// The stream itself is consumed natively — `invoke` cannot stream, and the route is
/// bearer-authenticated with a native-only secret — and re-emitted as `review-action-event`. The
/// caller should already be listening for those: the process can write before this return value has
/// crossed back over the `invoke` boundary.
#[tauri::command]
pub async fn cmd_execute_review_action(
    app_handle: tauri::AppHandle,
    project_name: String,
    action_name: String,
    plan_id: Option<String>,
    worktree: Option<String>,
) -> Result<StartedReviewAction, BridgeError> {
    let response = get_client_from_master()?
        .execute_review_action(
            &project_name,
            &action_name,
            plan_id.as_deref(),
            worktree.as_deref(),
        )
        .await?;

    review_action_bridge::start(app_handle, response).await
}

/// Forwards keystrokes to a running review action. `data` is base64 of the raw bytes.
#[tauri::command]
pub async fn cmd_send_review_action_input(
    project_name: String,
    action_name: String,
    session_id: String,
    data: String,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .review_action_input(&project_name, &action_name, &session_id, &data)
        .await
}

/// Reports the terminal's size to a running review action, so a process that wraps its own output
/// redraws to fit.
#[tauri::command]
pub async fn cmd_resize_review_action(
    project_name: String,
    action_name: String,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .review_action_resize(&project_name, &action_name, &session_id, rows, cols)
        .await
}

/// Stops consuming a review action's stream, without stopping the process: the app it started has to
/// keep serving the preview that replaces the terminal.
#[tauri::command]
pub async fn cmd_close_review_action(session_id: String) -> Result<bool, BridgeError> {
    Ok(review_action_bridge::close(&session_id))
}
