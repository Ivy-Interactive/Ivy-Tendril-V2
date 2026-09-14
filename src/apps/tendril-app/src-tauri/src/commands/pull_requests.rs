use crate::commands::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{PrStatusDto, PrSyncReportDto};

#[tauri::command]
pub async fn cmd_list_pull_requests() -> Result<Vec<PrStatusDto>, BridgeError> {
    get_client_from_master()?.list_pull_requests().await
}

/// Reconciles now. Fails with `PR_SYNC_IN_PROGRESS` when the daemon's periodic pass already holds the
/// lock, which the UI surfaces as a notice rather than an error.
#[tauri::command]
pub async fn cmd_sync_pull_requests() -> Result<PrSyncReportDto, BridgeError> {
    get_client_from_master()?.sync_pull_requests().await
}
