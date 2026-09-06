use super::get_client_from_master;
use crate::models::{PlanDetailDto, PlanQueryDto, PlanSummaryDto, RevisionResultDto};

#[tauri::command]
pub async fn cmd_list_plans(query: Option<PlanQueryDto>) -> Result<Vec<PlanSummaryDto>, String> {
    let client = get_client_from_master()?;
    client.list_plans(query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_get_plan(id: String) -> Result<PlanDetailDto, String> {
    let client = get_client_from_master()?;
    client.get_plan(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_update_plan_field(
    id: String,
    field: String,
    value: String,
    allow_failed: Option<bool>,
) -> Result<(), String> {
    let client = get_client_from_master()?;
    client
        .update_plan_field(&id, &field, &value, allow_failed.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_get_revision(id: String, number: Option<i32>) -> Result<String, String> {
    let client = get_client_from_master()?;
    client
        .get_revision(&id, number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_write_revision(id: String, content: String) -> Result<RevisionResultDto, String> {
    let client = get_client_from_master()?;
    client
        .write_revision(&id, &content)
        .await
        .map_err(|e| e.to_string())
}
