//! The share tunnel: exposing this daemon on a public `*.trycloudflare.com` URL so somebody who is
//! not on this machine can read a plan and comment on it.
//!
//! A port of the original Tendril's `Services/Tunnel/**` (`ShareTunnelService`, `CloudflaredService`,
//! `CloudflaredInstaller`, `TunnelSession`, `ChildProcessTracker`, `TunnelConfig`, `TunnelStatus`).
//!
//! # Why this lives in the daemon and not in the desktop app
//!
//! The original runs `cloudflared` inside the app process, because in the original the app *is* the
//! server. In V2 they are separate, and the tunnel's whole job is to publish the daemon's HTTP origin:
//! `cloudflared` has to run somewhere that can reach `http://127.0.0.1:<daemon port>`. That is the
//! daemon's machine, which is not necessarily the app's — a remotely hosted daemon is an explicit
//! goal. So the lifecycle lives here, `tendril-server` exposes it over `/api/tunnel/share`, and the
//! Tauri layer is a thin client of those routes like every other feature.
//!
//! # What is deliberately *not* ported
//!
//! - **Auto-start on boot.** The original persists `shareTunnel.enabled = true` into `config.yaml` on
//!   activation and re-establishes the tunnel on every subsequent start. Publishing a machine to the
//!   public internet as a side effect of restarting a daemon is not a decision a user made, so a share
//!   here is session-scoped: it lasts until it is stopped or the daemon exits. `shareTunnel` in
//!   `config.yaml` is still *read* for `binaryPath`/`maxRestarts` (see [`config::TunnelConfig`]).
//! - **Downloading `cloudflared`.** [`installer`] keeps the original's detection and its
//!   platform/asset logic, but a missing binary is a hard, actionable error rather than a silent
//!   fetch from GitHub.
//! - **The DNS-over-HTTPS fallback** in the original's `WaitForTunnelHealthyAsync`, which exists only
//!   to work around a locally poisoned negative-DNS cache. The registered-connection fallback it sits
//!   next to is ported; the 1.1.1.1 probe is not.
//!
//! # Security note: what a share publishes, and what is not yet fenced off
//!
//! A share puts the daemon's HTTP origin on the public internet. Almost every route needs a bearer
//! credential, which a visitor does not have, and [`crate::share::policy`] defines the narrow set a
//! visitor's capability token *should* buy. Two things are true today and are not this module's to fix:
//!
//! 1. **The routes that sit outside the auth layer become publicly reachable.** In `tendril-server`
//!    those are `/api/ping`, `/api/health`, `/api/auth/login`, `/api/auth/status`, and the WebViewer
//!    proxy (`/__proxy`, `/__view/*`, `/__lib/:file`, `/__capture`, `/__captures/:file`, `/__resolve`,
//!    `/sw.js`). The proxy is the one that matters: it is confined to loopback *targets*, which means a
//!    visitor could use it to reach services listening only on the daemon host's `localhost`.
//!    [`ShareTunnelService::start`] logs this list every time a share starts, so it is at least never
//!    silent. The fix is to refuse those routes for a request arriving on the tunnel host, which needs
//!    a change in `tendril-server`'s router.
//! 2. **A visitor's capability token is not yet honoured by the API.** It is honoured by the local-file
//!    guard (which is what makes a plan's images load), but `auth_middleware` does not know about it, so
//!    every `/api` call from a share page is a `401` until it does. See the report accompanying this
//!    change for the exact patch.

pub mod config;
pub mod installer;
pub mod registry;
pub mod service;
pub mod session;
pub mod share_state;
pub mod status;

pub use config::TunnelConfig;
pub use service::{ShareTunnelService, TunnelSnapshot, TunnelTimings};
pub use share_state::ShareSession;
pub use status::TunnelStatus;

use std::path::PathBuf;

/// Everything that can go wrong starting or running a share tunnel.
///
/// Each variant carries what the operator has to *do*, not just what failed: the message is surfaced
/// verbatim in the share dialog, which is the only place most users will ever see it.
#[derive(Debug, thiserror::Error)]
pub enum TunnelError {
    /// No `cloudflared` anywhere. The one error a fresh install is most likely to hit, so it names
    /// both places that were searched and both ways to fix it.
    #[error(
        "cloudflared is not installed. Tendril looked for it at {local} and on PATH. \
Install it with your package manager (macOS: `brew install cloudflared`, \
Linux: see https://pkg.cloudflare.com), or download {asset} from {url} and save it as {local}."
    )]
    NotInstalled {
        local: PathBuf,
        asset: String,
        url: String,
    },

    /// A `shareTunnel.binaryPath` that does not exist. Distinct from [`TunnelError::NotInstalled`]:
    /// the operator pointed at something, so telling them "not installed" would be misleading.
    #[error("shareTunnel.binaryPath is set to {0}, which is not an executable file")]
    ConfiguredBinaryMissing(PathBuf),

    #[error("could not start {binary}: {source}")]
    Spawn {
        binary: PathBuf,
        #[source]
        source: std::io::Error,
    },

    /// cloudflared started but never printed a `https://<name>.trycloudflare.com` URL. The tail of its
    /// output is the only useful diagnostic, so it is quoted.
    #[error("cloudflared did not produce a tunnel URL within {seconds}s ({recent})")]
    NoUrl { seconds: u64, recent: String },

    /// A URL exists but nothing routes to it. The original appends the same DNS/VPN hint, because a
    /// blocked `trycloudflare.com` is by far the most common cause.
    #[error(
        "the share tunnel did not become routable within {seconds}s ({url}). \
This usually means DNS or a network policy is blocking trycloudflare.com; \
try a different resolver (1.1.1.1, 8.8.8.8) or a VPN."
    )]
    NotRoutable { seconds: u64, url: String },

    /// The daemon does not know its own origin, so there is nothing to publish.
    #[error("could not work out this daemon's own address to publish: {0}")]
    NoOrigin(String),

    #[error("share tunnel state could not be written: {0}")]
    State(String),
}
