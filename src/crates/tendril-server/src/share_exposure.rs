//! Refuses the daemon's unauthenticated surface when the request arrives over a share tunnel.
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

/// Refuses the wrapped routes for a request that came in over the share tunnel.
pub async fn refuse_on_tunnel_host(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if arrived_over_share(&state, &req) {
        // Named rather than a bare 403: an operator debugging a share needs to know this was a
        // deliberate refusal and not the route being absent or the tunnel misrouting.
        tracing::warn!(
            "Refused {} {} over the share tunnel: this surface is not shared",
            req.method(),
            req.uri().path()
        );
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Access denied: not available over a share" })),
        )
            .into_response();
    }
    next.run(req).await
}
