use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::AgentOptionDto;

#[tauri::command]
pub async fn cmd_list_agents() -> Result<Vec<AgentOptionDto>, BridgeError> {
    get_client_from_master()?.list_agents().await
}

/// Live model discovery for a bring-your-own-LLM endpoint, via `POST /api/agents/models`.
///
/// Only a command can make this call in the packaged app: the daemon's bearer secret is read from
/// `.master` natively and never crosses into the webview, and there is no `/api` proxy outside the dev
/// server, so a relative `fetch` resolves against the asset origin and reaches neither the daemon nor a
/// credential. `api/providerModelsApi.ts` picks between this and `fetch` once, by host — the two paths
/// are exclusive, not a fallback chain, so a real rejection here stays the reason the operator sees.
///
/// Unlike `cmd_query_table` there is no path parameter to validate: this targets one route, named here.
/// `request` is passed straight through and the reply handed back untouched, deliberately: the body may
/// carry an API key the operator typed and has not saved, so nothing on this path reads it, logs it or
/// puts it in a message. That is a property the daemon side pins with its own tests, and it holds here
/// only as long as this stays a delegation.
#[tauri::command]
pub async fn cmd_fetch_provider_models(
    request: serde_json::Value,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .fetch_provider_models(request)
        .await
}
