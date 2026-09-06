use super::get_client_from_master;
use crate::models::{JobDetailDto, JobDto, StartJobResponseDto};

#[tauri::command]
pub async fn cmd_list_jobs(
    status: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<JobDto>, String> {
    let client = get_client_from_master()?;
    client
        .list_jobs(status.as_deref(), limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_get_job(id: String) -> Result<JobDetailDto, String> {
    let client = get_client_from_master()?;
    client.get_job(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_start_job(args: serde_json::Value) -> Result<StartJobResponseDto, String> {
    let client = get_client_from_master()?;
    client.start_job(args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_cancel_job(id: String, message: Option<String>) -> Result<(), String> {
    let client = get_client_from_master()?;
    client
        .cancel_job(&id, message.as_deref())
        .await
        .map_err(|e| e.to_string())
}
