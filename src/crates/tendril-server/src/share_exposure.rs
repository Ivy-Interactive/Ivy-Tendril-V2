//! Refuses parts of the daemon when the request arrives over a public tunnel.
//!
//! There are two tunnels ([`tendril_core::tunnel::TunnelKind`]) and they need different answers, so
//! there are two middlewares here:
//!
//! | | share host | full-access host | loopback / LAN |
//! |---|---|---|---|
//! | WebViewer proxy | refused | refused | allowed |
//! | `/api/auth/login`, `/api/auth/status` | refused | **allowed** | allowed |
//! | `/api/auth/password`, `/api/tunnel/full` | refused | refused | allowed |
//!
//! The one asymmetry is login, and it is the reason the two tunnels keep separate state files. A share
//! visitor has no business logging in. An operator reaching their *own* daemon over a full-access
//! tunnel has nothing else they could present — the bearer secret is in `.master` on the daemon's
//! machine — so refusing login there would publish a daemon nobody could authenticate to, which is the
//! worst of both outcomes.
//!
//! Two routers sit outside `auth_middleware` for good reasons that stop being good the moment a
//! tunnel publishes the daemon on a public URL:
//!
//! - **The WebViewer proxy.** Its own comment explains why it is unauthenticated — an `<iframe src>`
//!   navigation carries no `Authorization` header, and neither do the subresource requests the
//!   service worker reissues from inside the proxied page — and states what keeps it safe: "a
//!   loopback-only target allow-list is what keeps these from being an open relay". That is true of a
//!   daemon reachable only from its own machine. Published on a public hostname it inverts: the
//!   loopback confinement stops being a restriction on the *caller* and becomes a guarantee that an
//!   anonymous visitor can reach services bound to the daemon host's localhost, which is the one
//!   place an operator is entitled to assume nothing outside the machine can see.
//! - **Password auth.** `/api/auth/login` is rate limited, so this is not the same order of problem,
//!   but a share visitor has no business logging in: a share is a read-only view of some plans, and
//!   exposing a credential check to the internet buys the operator nothing.
//!
//! The check is deliberately narrow. It compares the request's `Host` against the host recorded for
//! the *active* share and refuses only on a match, so a loopback or LAN request pays one state-file
//! read and nothing else changes. With no share recorded there is no tunnel host, and every request
//! behaves exactly as before.

use crate::state::AppState;
use axum::body::Body;
use axum::extract::State;
use axum::http::{header, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::sync::Arc;

/// The host a request addressed itself to, without its port.
fn request_host(req: &Request<Body>) -> String {
    tendril_core::security::host_policy::strip_port(
        req.headers()
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default(),
    )
    .to_string()
}

/// True when this request arrived on the hostname the active share tunnel publishes.
pub fn arrived_over_share(state: &AppState, req: &Request<Body>) -> bool {
    let host = request_host(req);
    if host.is_empty() {
        return false;
    }
    tendril_core::tunnel::share_state::read(&state.tendril_home)
        .is_some_and(|session| session.host.eq_ignore_ascii_case(&host))
}

/// True when this request arrived on the hostname the active full-access tunnel publishes.
///
/// Reads `.full-tunnel.json`, never `.share-tunnel.json`: the two records are deliberately separate so
/// that a full-access tunnel can never be mistaken for a share (which would mint it a capability token
/// and refuse it `/api/auth/login`) and a share can never be mistaken for a full-access tunnel (which
/// would open login to a reviewer). See [`tendril_core::tunnel::full_state`].
pub fn arrived_over_full_access(state: &AppState, req: &Request<Body>) -> bool {
    let host = request_host(req);
    if host.is_empty() {
        return false;
    }
    tendril_core::tunnel::full_state::read(&state.tendril_home)
        .is_some_and(|session| session.host.eq_ignore_ascii_case(&host))
}

/// Refuses the wrapped routes for a request that came in over the share tunnel.
pub async fn refuse_on_tunnel_host(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if arrived_over_share(&state, &req) {
        return refusal(&req, "share tunnel");
    }
    next.run(req).await
}

/// Refuses the wrapped routes for a request that came in over *either* tunnel.
///
/// Two things wear this rather than [`refuse_on_tunnel_host`]:
///
/// - **The WebViewer proxy.** Loopback-target confinement is a restriction on a locally-bound daemon and
///   a guarantee of reachability on a published one. That inversion does not care which tunnel published
///   it.
/// - **`/api/auth/password` and the full-access tunnel's own switch.** Both are bearer-credentialled
///   already, so this is defence in depth rather than the only guard — but changing the credential that
///   gates a public tunnel, over that same public tunnel, is not a thing to leave possible. A session
///   token obtained with the password satisfies `auth_middleware`, so without this a remote caller who
///   had the password could rotate it and lock the operator out of their own daemon.
pub async fn refuse_on_any_tunnel_host(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if arrived_over_share(&state, &req) {
        return refusal(&req, "share tunnel");
    }
    if arrived_over_full_access(&state, &req) {
        return refusal(&req, "full-access tunnel");
    }
    next.run(req).await
}

/// Named rather than a bare 403: an operator debugging a tunnel needs to know this was a deliberate
/// refusal and not the route being absent or the tunnel misrouting.
fn refusal(req: &Request<Body>, over: &str) -> Response {
    tracing::warn!(
        "Refused {} {} over the {over}: this surface is not published",
        req.method(),
        req.uri().path()
    );
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "Access denied: not available over a tunnel" })),
    )
        .into_response()
}
