//! Tauri commands for both tunnels and for the session password — everything V1's
//! `Apps/Settings/SecuritySetupView.cs` and the `TunnelSetupView` it composes drive.
//!
//! Thin wrappers over [`crate::service::TunnelClient`], following the same rule as every other command
//! module: the daemon's bearer secret is read natively from `.master` and never crosses into the
//! webview.
//!
//! Two credentials do cross, both deliberately and in opposite directions:
//!
//! - The share *capability* token comes **out**, because the dialog has to put it in the link the
//!   operator is about to send.
//! - A password goes **in**, because the operator typed it into the webview and the daemon is the only
//!   thing that may hash it. It is passed straight into a request body: never logged, never persisted
//!   app-side, and never returned. See `tendril_core::auth::credentials`.

use crate::error::BridgeError;
use crate::service::tunnel_client::{
    CloudflaredInstallDto, PasswordStatusDto, TunnelClient, TunnelSnapshotDto,
};

/// `GET /api/tunnel/share`. Port of the `Status`/`TunnelUrl`/`ErrorMessage` reads
/// `ShareTunnelModal.Build` does on every render.
#[tauri::command]
pub async fn cmd_get_share_tunnel() -> Result<TunnelSnapshotDto, BridgeError> {
    TunnelClient::from_master()?.status().await
}

/// `POST /api/tunnel/share`. Port of `ActivateAsync`.
///
/// Returns while the tunnel is still `connecting`; the dialog polls [`cmd_get_share_tunnel`] from
/// there. Deliberately not a long-poll: a share takes 15-30 seconds to become routable and a command
/// that blocked for that long would be indistinguishable from a hung app.
#[tauri::command]
pub async fn cmd_start_share_tunnel() -> Result<TunnelSnapshotDto, BridgeError> {
    TunnelClient::from_master()?.start().await
}

/// `DELETE /api/tunnel/share`. Port of `DeactivateAsync`.
#[tauri::command]
pub async fn cmd_stop_share_tunnel() -> Result<TunnelSnapshotDto, BridgeError> {
    TunnelClient::from_master()?.stop().await
}

/// `GET /api/tunnel/share/install`. Port of `CheckInstalledAsync`, and the progress read for
/// [`cmd_install_cloudflared`].
#[tauri::command]
pub async fn cmd_get_cloudflared_install_state() -> Result<CloudflaredInstallDto, BridgeError> {
    TunnelClient::from_master()?.install_state().await
}

/// `POST /api/tunnel/share/install`. Port of the original's "install it for you?" prompt.
///
/// The download happens in the daemon rather than here, because the daemon is the machine that has to
/// run `cloudflared` and may not be this one. Reached only when the user presses Install; the app
/// never calls it on start or in the background. See `tendril_core::tunnel::installer` for what makes
/// the fetch verifiable.
#[tauri::command]
pub async fn cmd_install_cloudflared() -> Result<CloudflaredInstallDto, BridgeError> {
    TunnelClient::from_master()?.install().await
}

/// `DELETE /api/tunnel/share/install`. Cancels a running download.
#[tauri::command]
pub async fn cmd_cancel_cloudflared_install() -> Result<CloudflaredInstallDto, BridgeError> {
    TunnelClient::from_master()?.cancel_install().await
}

/// `GET /api/tunnel/full`. Port of the `Status`/`TunnelUrl`/`ErrorMessage` reads
/// `TunnelSetupView.Build` does on its first block.
#[tauri::command]
pub async fn cmd_get_full_tunnel() -> Result<TunnelSnapshotDto, BridgeError> {
    TunnelClient::from_master()?.full_status().await
}

/// `POST /api/tunnel/full`. Port of `CloudflaredService.ActivateAsync`.
///
/// Fails with `TUNNEL_PASSWORD_REQUIRED` when no session password is configured. V1 has no such check;
/// see `tendril_core::tunnel::TunnelService::start` for why V2 does.
#[tauri::command]
pub async fn cmd_start_full_tunnel() -> Result<TunnelSnapshotDto, BridgeError> {
    TunnelClient::from_master()?.full_start().await
}

/// `DELETE /api/tunnel/full`. Port of `CloudflaredService.DeactivateAsync`.
#[tauri::command]
pub async fn cmd_stop_full_tunnel() -> Result<TunnelSnapshotDto, BridgeError> {
    TunnelClient::from_master()?.full_stop().await
}

/// `GET /api/auth/status`. Whether a session password is configured — V1's
/// `config.Settings.Auth != null`.
#[tauri::command]
pub async fn cmd_get_password_status() -> Result<PasswordStatusDto, BridgeError> {
    TunnelClient::from_master()?.password_status().await
}

/// `PUT /api/auth/password`. Port of `SecuritySetupView`'s Save button in its "enabled" branch.
///
/// `current_password` is required whenever a password is already configured, exactly as V1 requires its
/// "Current Password" field. Nothing here inspects, logs or stores either value.
#[tauri::command]
pub async fn cmd_set_password(
    current_password: Option<String>,
    new_password: String,
) -> Result<PasswordStatusDto, BridgeError> {
    TunnelClient::from_master()?
        .set_password(current_password, new_password)
        .await
}

/// `DELETE /api/auth/password`. Port of `SecuritySetupView`'s Save button in its "disabled" branch
/// (`config.Settings.Auth = null`).
#[tauri::command]
pub async fn cmd_clear_password(
    current_password: Option<String>,
) -> Result<PasswordStatusDto, BridgeError> {
    TunnelClient::from_master()?
        .clear_password(current_password)
        .await
}

// The commands themselves resolve the daemon through `.master`, so calling one in a unit test would
// read the operator's real `~/.tendril`. `tests/share_tunnel_bridge_test.rs` exercises the same code
// path against a mock daemon on a loopback port instead, with no ambient home involved.
