//! Tunnel control: `/api/tunnel/share` and `/api/tunnel/full`.
//!
//! The port of the original's `ShareTunnelModal` and of both blocks in `TunnelSetupView` — Activate,
//! Deactivate, and the install check they all make first. In the original those views call
//! `IShareTunnelService` and `ICloudflaredService` in-process, because the UI and the server are the
//! same process. In V2 they are not, so the lifecycle sits behind these routes and both the desktop app
//! and the CLI drive it the same way. See [`tendril_core::tunnel`] for why a tunnel belongs to the
//! daemon at all.
//!
//! # These routes are for the *owner*, not the visitor
//!
//! Every route here needs the bearer credential. A share visitor's capability token does not authorise
//! any of them — starting and stopping a tunnel is not something a share may do, and
//! `GET /api/tunnel/share` returns the token itself, which a visitor must never be able to read for a
//! *different* share. [`tendril_core::share::policy::share_token_allows`] refuses `/api/tunnel/**` for
//! exactly this reason.
//!
//! The full-access routes carry one guard more: they are refused when the request arrived over either
//! tunnel (`share_exposure::refuse_on_any_tunnel_host`, wired in [`super`]), so the switch that
//! publishes the daemon cannot be thrown from the internet it publishes to.

use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use tendril_core::tunnel::{installer, registry, TunnelConfig, TunnelError};

/// The share tunnel for this daemon's home. Creating one starts nothing.
fn service(state: &Arc<AppState>) -> Arc<tendril_core::tunnel::TunnelService> {
    registry::for_home(&state.tendril_home)
}

/// The full-access tunnel for this daemon's home. A separate service from [`service`], so the two can be
/// up independently and stopping one cannot stop the other.
fn full_service(state: &Arc<AppState>) -> Arc<tendril_core::tunnel::TunnelService> {
    registry::full_for_home(&state.tendril_home)
}

/// Maps a tunnel failure onto a status code.
///
/// A missing or wrong binary is the caller's environment, not a server fault, so it is a `409` rather
/// than a `500`: the request was well-formed and the daemon is healthy, but the precondition is not
/// met. The message is the operator-facing one from [`TunnelError`] and is passed through verbatim —
/// it is the only place the install instructions appear.
///
/// A missing password is a `428 Precondition Required` rather than a `409`: `409` in this handler means
/// "your machine is not set up", and this one means "you have not made a decision yet". The desktop app
/// branches on the code to offer the password form instead of just showing the message.
fn error_response(err: TunnelError) -> (StatusCode, Json<serde_json::Value>) {
    let status = match err {
        TunnelError::NotInstalled { .. } | TunnelError::ConfiguredBinaryMissing(_) => {
            StatusCode::CONFLICT
        }
        TunnelError::PasswordRequired => StatusCode::PRECONDITION_REQUIRED,
        // Same family as a missing binary: the request was fine and the daemon is healthy, but the
        // caller's environment (network, platform, a read-only tools directory) did not cooperate.
        TunnelError::InstallFailed { .. } => StatusCode::CONFLICT,
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

/// `GET /api/tunnel/share/install` — port of `CheckInstalledAsync`, widened to say what to install and
/// how a running install is getting on.
///
/// Serves both tunnels: they run the same `cloudflared` from the same place, so a second route would be
/// the same answer under a different name.
///
/// This is also the progress endpoint for [`install_cloudflared`]. Polling an existing read rather than
/// adding a stream keeps the client shape the tunnel status already uses, and the pane is polling the
/// tunnel anyway.
pub async fn get_cloudflared_install_state(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    Json(installer::state_with_progress(
        &state.tendril_home,
        configured_binary(&state).as_deref(),
        Some(registry::install_for_home(&state.tendril_home).as_ref()),
    ))
}

/// `POST /api/tunnel/share/install` — port of the original's `EnsureInstalledAsync`/`InstallAsync`.
///
/// Downloads the release asset the GitHub API describes, checks it against the SHA-256 that API
/// published, and installs it into `$TENDRIL_HOME/tools`. See [`tendril_core::tunnel::installer`] for
/// why the download exists at all and what makes it defensible.
///
/// **Only ever reached because a user pressed Install.** Nothing in the daemon calls this on start, on a
/// status read or as a side effect of starting a tunnel — a tunnel with no binary still fails with
/// [`TunnelError::NotInstalled`] and its manual instructions.
///
/// Returns `202 Accepted` with the current state: the download is a background task, and the caller
/// watches it through the `GET`. A second `POST` while one is in flight is a no-op rather than a second
/// download, so a double-click is harmless.
pub async fn install_cloudflared(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // An operator-configured `binaryPath` is a statement about which binary to use. Fetching a
    // different one into `tools/` would not even be picked up — `resolve_binary` honours the override —
    // so this is refused rather than silently doing nothing useful.
    if let Some(configured) = configured_binary(&state) {
        if let Err(err) = installer::resolve_binary(&state.tendril_home, Some(&configured)) {
            return error_response(err).into_response();
        }
    }

    let install = registry::install_for_home(&state.tendril_home);
    let home = state.tendril_home.clone();
    let spawned = Arc::clone(&install);
    tokio::spawn(async move {
        spawned
            .run(&home, &installer::InstallOptions::default())
            .await;
    });

    (
        StatusCode::ACCEPTED,
        Json(installer::state_with_progress(
            &state.tendril_home,
            configured_binary(&state).as_deref(),
            Some(install.as_ref()),
        )),
    )
        .into_response()
}

/// `DELETE /api/tunnel/share/install` — cancels a running install.
///
/// A ~40 MB download with no way out is as bad as one with no progress bar. Cancelling removes the
/// partial file, so it can never leave a truncated binary where the resolver would find it. Cancelling
/// when nothing is running is not an error: the caller wanted no install running, and there is none.
pub async fn cancel_cloudflared_install(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let install = registry::install_for_home(&state.tendril_home);
    install.cancel();
    Json(installer::state_with_progress(
        &state.tendril_home,
        configured_binary(&state).as_deref(),
        Some(install.as_ref()),
    ))
}

/// `GET /api/tunnel/full` — the full-access tunnel's status, as `TunnelSetupView`'s first block reads it
/// on every build.
///
/// The snapshot's `passwordConfigured` is what lets the settings screen explain why Activate is
/// unavailable rather than just greying it out.
pub async fn get_full_tunnel(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(full_service(&state).snapshot())
}

/// `POST /api/tunnel/full` — port of `CloudflaredService.ActivateAsync`.
///
/// Refuses with `428` unless a session password is configured. That check lives in
/// [`tendril_core::tunnel::TunnelService::start`], not here, so the CLI and any other caller get it too —
/// see its docs for why a full-access tunnel without a password is all cost and no benefit.
///
/// Returns as soon as the supervisor is running, with the status at `connecting`; the caller polls or
/// re-reads. Idempotent: activating a live tunnel returns the live snapshot.
pub async fn start_full_tunnel(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match full_service(&state).start().await {
        Ok(snapshot) => (StatusCode::OK, Json(json!(snapshot))),
        Err(err) => error_response(err),
    }
}

/// `DELETE /api/tunnel/full` — port of `CloudflaredService.DeactivateAsync`. Kills cloudflared and
/// clears the record, so the daemon stops treating that hostname as its own public host.
pub async fn stop_full_tunnel(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(full_service(&state).stop().await)
}
