//! `POST /api/auth/login` and `GET /api/auth/status` — the password path from
//! `Auth/TendrilAuthProvider.cs`.
//!
//! Both routes are unauthenticated by necessity (a caller with no credential is exactly who logs in),
//! so login is rate-limited with the original's exponential backoff and says as little as possible:
//! a wrong username and a wrong password produce the same `401` with the same body.
//!
//! An install with no `auth` block, or one carrying an inherited `auth: {enabled: true}` with no
//! password, has password auth *unavailable* rather than open — `AuthConfig::is_active()` is what
//! decides, and the bearer secret keeps working regardless, so nobody is locked out.

use crate::auth::{issue_session_token, SESSION_TOKEN_TTL_SECONDS};
use crate::state::AppState;
use axum::{
    extract::{ConnectInfo, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tendril_core::auth::password::verify_password;
use tendril_core::auth::rate_limit::GLOBAL_KEY;
use tendril_core::config::AuthConfig;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

/// Identical answer for every credential failure, so the endpoint never reveals whether the username
/// or the password was the wrong one.
fn invalid_credentials() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Invalid credentials" })),
    )
        .into_response()
}

/// The rate-limiter key: the socket peer address only. `X-Forwarded-For` is deliberately ignored —
/// it is caller-supplied, so honouring it would let one client rotate its own key and sidestep the
/// backoff entirely. Falls back to a single shared key when the peer address is unavailable, matching
/// the original's literal `"global"`.
fn client_key(peer: Option<SocketAddr>) -> String {
    peer.map(|addr| addr.ip().to_string())
        .unwrap_or_else(|| GLOBAL_KEY.to_string())
}

pub async fn login_handler(
    State(state): State<Arc<AppState>>,
    peer: Option<ConnectInfo<SocketAddr>>,
    Json(body): Json<LoginRequest>,
) -> Response {
    let key = client_key(peer.map(|ConnectInfo(addr)| addr));
    let limiter = &state.login_rate_limiter;

    // 1. Backoff first: a blocked client must not get so much as a password comparison.
    if !limiter.is_login_allowed(&key) {
        // Rounded *up*: a client that waits exactly `Retry-After` seconds must find itself allowed,
        // which truncating a 29.4s remainder to 29 would not deliver.
        let delay = limiter.required_delay(&key);
        let retry_after = (delay.as_secs_f64().ceil() as u64).max(1);
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [("Retry-After", retry_after.to_string())],
            Json(json!({
                "error": "Too many failed login attempts",
                "retryAfterSeconds": retry_after,
            })),
        )
            .into_response();
    }

    let snapshot = state.settings_snapshot();
    let auth = snapshot.settings.auth.as_ref();

    // 2. No password configured means no login, rather than a login that anything satisfies.
    let Some(auth) = auth.filter(|auth| auth.is_active()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Password authentication is not configured" })),
        )
            .into_response();
    };

    // 3. Username (when one is configured) then password. A failure of either is recorded and
    //    answered identically.
    if !username_matches(auth, &body.username) {
        limiter.record_failed_attempt(&key);
        return invalid_credentials();
    }
    if !verify_password(&auth.password, &body.password, &auth.hash_secret) {
        limiter.record_failed_attempt(&key);
        return invalid_credentials();
    }

    // 4. Success clears the record outright, so a user who eventually gets it right is not still
    //    serving out a backoff.
    limiter.record_successful_login(&key);

    let subject = if auth
        .username
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        "tendril".to_string()
    } else {
        auth.username.clone().unwrap_or_default()
    };

    match issue_session_token(auth, &subject, chrono::Utc::now().timestamp()) {
        Ok(token) => (
            StatusCode::OK,
            Json(json!({
                "token": token,
                "tokenType": "Bearer",
                "expiresIn": SESSION_TOKEN_TTL_SECONDS,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("Failed to issue a session token: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to issue a session token" })),
            )
                .into_response()
        }
    }
}

/// A configured username must match case-insensitively; an unset or blank one is not checked at all,
/// as in the original.
fn username_matches(auth: &AuthConfig, presented: &str) -> bool {
    match auth.username.as_deref().map(str::trim) {
        None | Some("") => true,
        Some(expected) => expected.eq_ignore_ascii_case(presented.trim()),
    }
}

/// Lets a login UI decide whether to offer a password form, without disclosing anything an
/// unauthenticated caller could not already infer by attempting a login.
pub async fn status_handler(State(state): State<Arc<AppState>>) -> Response {
    let snapshot = state.settings_snapshot();
    let enabled = snapshot
        .settings
        .auth
        .as_ref()
        .is_some_and(|auth| auth.is_active());

    Json(json!({ "passwordAuthEnabled": enabled })).into_response()
}
