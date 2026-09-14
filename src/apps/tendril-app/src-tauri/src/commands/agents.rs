use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::AgentOptionDto;

#[tauri::command]
pub async fn cmd_list_agents() -> Result<Vec<AgentOptionDto>, BridgeError> {
    get_client_from_master()?.list_agents().await
}
