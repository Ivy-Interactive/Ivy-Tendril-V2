//! Bridge commands for the assigned-issue importer.
//!
//! Thin wrappers over the service routes: the daemon owns the sweep, the dedup rules and the
//! proposal store, so there is nothing to duplicate here. `serde_json::Value` passes through
//! unmodelled on purpose — the shapes are `tendril_core::inbox`'s and the frontend's `api.ts`
//! declares them once, rather than a third copy living in this crate.

use crate::commands::get_client_from_master;
use crate::error::BridgeError;

/// Forces a sweep now. `outcome` distinguishes `Ran` from `AlreadyRunning`; a daemon that is not the
/// master answers `409`, which arrives here as a `BridgeError`.
#[tauri::command]
pub async fn cmd_check_inbox() -> Result<serde_json::Value, BridgeError> {
    let client = get_client_from_master()?;
    client.check_inbox().await
}

/// Swept issues awaiting a decision. `state` of `None` uses the service default (`Pending`).
#[tauri::command]
pub async fn cmd_list_inbox_proposals(
    state: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    let client = get_client_from_master()?;
    client.list_inbox_proposals(state.as_deref()).await
}

#[tauri::command]
pub async fn cmd_accept_inbox_proposal(id: i64) -> Result<serde_json::Value, BridgeError> {
    let client = get_client_from_master()?;
    client.accept_inbox_proposal(id).await
}

#[tauri::command]
pub async fn cmd_dismiss_inbox_proposal(id: i64) -> Result<serde_json::Value, BridgeError> {
    let client = get_client_from_master()?;
    client.dismiss_inbox_proposal(id).await
}
