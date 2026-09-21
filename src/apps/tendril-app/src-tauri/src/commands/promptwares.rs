//! The prompt a promptware runs, for the Settings pane that configures it.

use super::get_client_from_master;
use crate::error::BridgeError;

/// One promptware's deployed `Program.md` (`GET /api/promptwares/:name/program`).
///
/// A command rather than a `fetch` for the reason every route in this crate is one: the daemon's
/// bearer secret is read from `.master` natively and never crosses into the webview, and there is no
/// `/api` proxy outside the dev server, so a relative `fetch` from the packaged app resolves against
/// the asset origin and reaches neither the daemon nor a credential.
///
/// The reply is passed through untouched. It is the program text plus its provenance, and nothing on
/// this side has a reason to read either.
#[tauri::command]
pub async fn cmd_get_promptware_program(name: String) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .get_promptware_program(&name)
        .await
}
