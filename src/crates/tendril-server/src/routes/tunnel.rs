//! Share-tunnel control: `/api/tunnel/share`.
//!
//! The port of the original's `ShareTunnelModal` and `TunnelSetupView` buttons — Activate, Deactivate,
//! and the install check they both make first. In the original those views call
//! `IShareTunnelService` in-process, because the UI and the server are the same process. In V2 they
//! are not, so the lifecycle sits behind these routes and both the desktop app and the CLI drive it
//! the same way. See [`tendril_core::tunnel`] for why the tunnel belongs to the daemon at all.
//!
//! # These routes are for the *owner*, not the visitor
//!
//! Every route here is registered on the protected router, so it needs the bearer credential. A share
//! visitor's capability token does not authorise any of them — starting and stopping a share is not
//! something a share may do, and `GET` returns the token itself, which a visitor must never be able to
//! read for a *different* share. [`tendril_core::share::policy::share_token_allows`] refuses
//! `/api/tunnel/**` for exactly this reason.

use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use tendril_core::tunnel::{installer, registry, TunnelConfig, TunnelError};

/// The service for this daemon's home. Creating one starts nothing.
fn service(state: &Arc<AppState>) -> Arc<tendril_core::tunnel::ShareTunnelService> {
    registry::for_home(&state.tendril_home)
}

/// Maps a tunnel failure onto a status code.
///
/// A missing or wrong binary is the caller's environment, not a server fault, so it is a `409` rather
/// than a `500`: the request was well-formed and the daemon is healthy, but the precondition is not
/// met. The message is the operator-facing one from [`TunnelError`] and is passed through verbatim —
/// it is the only place the install instructions appear.
fn error_response(err: TunnelError) -> (StatusCode, Json<serde_json::Value>) {
    let status = match err {
        TunnelError::NotInstalled { .. } | TunnelError::ConfiguredBinaryMissing(_) => {
            StatusCode::CONFLICT
        }
        TunnelError::NoOrigin(_) => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "error": err.to_string() })))
}

fn configured_binary(state: &Arc<AppState>) -> Option<String> {
    let snapshot = state.settings_snapshot();
    TunnelConfig::from_settings(&snapshot.settings)
        .binary_override()
        .map(str::to_string)
}

/// `GET /api/tunnel/share` — the current status, as `TunnelSetupView` and `ShareTunnelModal` read it
/// on every build.
pub async fn get_share_tunnel(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(service(&state).snapshot())
}

/// `POST /api/tunnel/share` — port of `ActivateAsync`.
///
/// Returns as soon as the supervisor is running, with the status at `connecting`; the caller polls or
/// re-reads. That is the original's behaviour too (`ActivateAsync` starts the supervisor and returns),
/// and it is why the modal renders a "this takes 15-30 seconds" callout rather than blocking.
///
/// Idempotent: activating a live share returns the live snapshot.
pub async fn start_share_tunnel(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match service(&state).start().await {
        Ok(snapshot) => (StatusCode::OK, Json(json!(snapshot))),
        Err(err) => error_response(err),
    }
}

/// `DELETE /api/tunnel/share` — port of `DeactivateAsync`. Kills cloudflared and revokes the link.
pub async fn stop_share_tunnel(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(service(&state).stop().await)
}

/// `GET /api/tunnel/share/install` — port of `CheckInstalledAsync`, widened to say what to install.
///
/// There is deliberately no `POST` counterpart: the original's `InstallAsync` downloads an unpinned
/// binary from GitHub and runs it. See [`tendril_core::tunnel::installer`].
pub async fn get_cloudflared_install_state(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    Json(installer::install_state(
        &state.tendril_home,
        configured_binary(&state).as_deref(),
    ))
}
