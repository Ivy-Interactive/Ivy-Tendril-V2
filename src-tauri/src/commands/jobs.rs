use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{JobDetailDto, JobDto, StartJobResponseDto};

#[tauri::command]
pub async fn cmd_list_jobs(
    status: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<JobDto>, BridgeError> {
    get_client_from_master()?
        .list_jobs(status.as_deref(), limit)
        .await
}

#[tauri::command]
pub async fn cmd_get_job(id: String) -> Result<JobDetailDto, BridgeError> {
    get_client_from_master()?.get_job(&id).await
}

#[tauri::command]
pub async fn cmd_start_job(args: serde_json::Value) -> Result<StartJobResponseDto, BridgeError> {
    get_client_from_master()?.start_job(args).await
}

#[tauri::command]
pub async fn cmd_cancel_job(id: String, message: Option<String>) -> Result<(), BridgeError> {
    get_client_from_master()?
        .cancel_job(&id, message.as_deref())
        .await
}
