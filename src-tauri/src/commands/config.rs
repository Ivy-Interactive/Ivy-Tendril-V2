use super::get_client_from_master;
use crate::models::{ProjectSummaryDto, TendrilConfigDto};

#[tauri::command]
pub async fn cmd_list_projects() -> Result<Vec<ProjectSummaryDto>, String> {
    let client = get_client_from_master()?;
    client.list_projects().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_get_config() -> Result<TendrilConfigDto, String> {
    let client = get_client_from_master()?;
    client.get_config().await.map_err(|e| e.to_string())
}
