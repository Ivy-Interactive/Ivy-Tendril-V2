use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::AgentOptionDto;

#[tauri::command]
pub async fn cmd_list_agents() -> Result<Vec<AgentOptionDto>, BridgeError> {
    get_client_from_master()?.list_agents().await
}

/// How to install and sign in to each coding agent, via `GET /api/agents/hints`.
///
/// The Coding Agent pane's Help section renders this. It comes from the daemon rather than living in
/// the webview because the same table is what a failed auth probe hints from - keeping a second copy
/// in TypeScript is what drifted, and three hints ended up naming commands their CLI does not have.
///
/// A command rather than a plain `fetch` for the same reason the others here are: there is no `/api`
/// proxy outside the dev server, so a relative fetch in the packaged app resolves against the asset
/// origin and reaches no daemon. Nothing here is credential-bearing - the route reads no config and
/// takes no parameters - so it is only the transport that needs the native side.
#[tauri::command]
pub async fn cmd_get_agent_hints() -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.get_agent_hints().await
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

/// V1's Test Agent dialog, via `POST /api/agents/{agent}/test`.
///
/// A command rather than a `fetch` for the same reason as `cmd_fetch_provider_models`: the daemon's
/// bearer secret is read natively and never crosses into the webview, and the route reads a saved
/// API key out of `config.yaml` that the renderer must never see either. `request` goes through
/// untouched and the reply comes back untouched - the daemon has already redacted it.
#[tauri::command]
pub async fn cmd_test_agent(
    agent: String,
    request: serde_json::Value,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.test_agent(&agent, request).await
}

/// The rate-limit windows for one agent, via `GET /api/agents/{agent}/usage`.
///
/// Returns `null` for the agents whose providers publish no usage, which the settings pane reads as
/// "draw no strip".
#[tauri::command]
pub async fn cmd_get_agent_usage(agent: String) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.get_agent_usage(&agent).await
}
