//! Tauri commands for the share tunnel.
//!
//! Thin wrappers over [`crate::service::TunnelClient`], following the same rule as every other command
//! module: the daemon's bearer secret is read natively from `.master` and never crosses into the
//! webview. The share *capability* token does cross — the dialog has to put it in the link the operator
//! is about to send — and that is the only credential in the app that deliberately does.

use crate::error::BridgeError;
use crate::service::tunnel_client::{CloudflaredInstallDto, ShareTunnelDto, TunnelClient};

/// `GET /api/tunnel/share`. Port of the `Status`/`TunnelUrl`/`ErrorMessage` reads
/// `ShareTunnelModal.Build` does on every render.
#[tauri::command]
pub async fn cmd_get_share_tunnel() -> Result<ShareTunnelDto, BridgeError> {
    TunnelClient::from_master()?.status().await
}

/// `POST /api/tunnel/share`. Port of `ActivateAsync`.
///
/// Returns while the tunnel is still `connecting`; the dialog polls [`cmd_get_share_tunnel`] from
/// there. Deliberately not a long-poll: a share takes 15-30 seconds to become routable and a command
/// that blocked for that long would be indistinguishable from a hung app.
#[tauri::command]
pub async fn cmd_start_share_tunnel() -> Result<ShareTunnelDto, BridgeError> {
    TunnelClient::from_master()?.start().await
}

/// `DELETE /api/tunnel/share`. Port of `DeactivateAsync`.
#[tauri::command]
pub async fn cmd_stop_share_tunnel() -> Result<ShareTunnelDto, BridgeError> {
    TunnelClient::from_master()?.stop().await
}

/// `GET /api/tunnel/share/install`. Port of `CheckInstalledAsync`.
///
/// The original pairs this with an "install it for you?" prompt that downloads from GitHub. There is no
/// command for that here on purpose — see `tendril_core::tunnel::installer` — so the dialog shows the
/// install instructions instead of offering to fetch a binary.
#[tauri::command]
pub async fn cmd_get_cloudflared_install_state() -> Result<CloudflaredInstallDto, BridgeError> {
    TunnelClient::from_master()?.install_state().await
}

// The commands themselves resolve the daemon through `.master`, so calling one in a unit test would
// read the operator's real `~/.tendril`. `tests/share_tunnel_bridge_test.rs` exercises the same code
// path against a mock daemon on a loopback port instead, with no ambient home involved.
