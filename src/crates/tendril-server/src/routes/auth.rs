//! `POST /api/auth/login` and `GET /api/auth/status` — the password path from
//! `Auth/TendrilAuthProvider.cs` — plus `PUT`/`DELETE /api/auth/password`, the write side that the
//! original does in-process from `Apps/Settings/SecuritySetupView.cs`.
//!
//! Login and status are unauthenticated by necessity (a caller with no credential is exactly who logs
//! in), so login is rate-limited with the original's exponential backoff and says as little as possible:
//! a wrong username and a wrong password produce the same `401` with the same body.
//!
//! An install with no `auth` block, or one carrying an inherited `auth: {enabled: true}` with no
//! password, has password auth *unavailable* rather than open — `AuthConfig::is_active()` is what
//! decides, and the bearer secret keeps working regardless, so nobody is locked out.
//!
//! # Setting a password is the opposite kind of route
//!
//! [`set_password_handler`] and [`clear_password_handler`] are owner-only in three independent ways, and
//! `routes::mod` is where the first two are wired:
//!
//! 1. They are on a bearer-credentialled router, like the tunnel's own routes. A share visitor's
//!    capability token does not authorise them —
//!    [`tendril_core::share::policy::share_token_allows`] refuses every method but `GET` and `POST`, and
//!    refuses this path under all of them.
//! 2. They are refused when the request arrived over *either* tunnel
//!    (`share_exposure::refuse_on_any_tunnel_host`). Changing the credential that gates a public tunnel,
//!    over that same public tunnel, is not a thing to leave possible.
//! 3. Changing or clearing an existing password requires presenting the current one, exactly as
//!    `SecuritySetupView` does.
//!
//! Nothing here logs, echoes or returns a password. The success bodies carry a boolean and a message;
//! the plaintext goes into [`tendril_core::auth::credentials`] and stops there.

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
use tendril_core::auth::credentials::{self, CredentialError};
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

/// The body of `PUT /api/auth/password`, and — with `newPassword` unused — of `DELETE`.
///
/// `#[serde(default)]` on both so a `DELETE` with no body at all still deserialises: an install with no
/// password configured has no current password to send.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPasswordRequest {
    /// Required whenever a usable password is already configured. V1's "Current Password" field.
    #[serde(default)]
    pub current_password: Option<String>,
    #[serde(default)]
    pub new_password: String,
}

/// `PUT /api/auth/password` — sets or changes the session password.
///
/// Writes an Argon2 PHC string and a fresh base64 pepper into `auth` in `config.yaml` through
/// [`tendril_core::auth::credentials::set_password`], which is the same hasher
/// [`login_handler`] verifies against and the same one the original C# app reads. The plaintext is not
/// logged, not echoed and not stored.
///
/// A successful write invalidates every session token issued under the old password, because the pepper
/// is also the token signing key. That is intentional; see the module docs on
/// [`tendril_core::auth::credentials`].
pub async fn set_password_handler(
    State(state): State<Arc<AppState>>,
    body: Option<Json<SetPasswordRequest>>,
) -> Response {
    let Some(Json(body)) = body else {
        return credential_error(CredentialError::NewPasswordEmpty);
    };
    let outcome = credentials::set_password(
        &state.config_path,
        body.current_password.as_deref(),
        &body.new_password,
    );
    // Dropped whatever the outcome, for the same reason `put_config_handler` does it: a partial write
    // still changes what the next request must see, and mtime granularity means a same-tick write can
    // look identical to the cached snapshot.
    state.invalidate_settings_cache();

    match outcome {
        Ok(()) => {
            // Deliberately says *that* it happened and nothing about what was set.
            tracing::info!("Session password updated via PUT /api/auth/password");
            (
                StatusCode::OK,
                Json(json!({
                    "passwordAuthEnabled": true,
                    "message": "Password protection enabled",
                })),
            )
                .into_response()
        }
        Err(err) => credential_error(err),
    }
}

/// `DELETE /api/auth/password` — removes password protection, V1's `config.Settings.Auth = null`.
///
/// The current password is still required, so somebody at an unlocked session cannot turn the lock off
/// without knowing it. A full-access tunnel that is *running* blocks this: clearing the password while
/// the whole daemon is published would leave it published with no credential at all.
pub async fn clear_password_handler(
    State(state): State<Arc<AppState>>,
    body: Option<Json<SetPasswordRequest>>,
) -> Response {
    if tendril_core::tunnel::full_state::read(&state.tendril_home).is_some() {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "error": "A full-access tunnel is running. Stop it before removing password \
            protection, or it would be publishing this daemon with no credential at all.",
            })),
        )
            .into_response();
    }

    let current = body.and_then(|Json(body)| body.current_password);
    let outcome = credentials::clear_password(&state.config_path, current.as_deref());
    state.invalidate_settings_cache();

    match outcome {
        Ok(()) => {
            tracing::warn!("Session password removed via DELETE /api/auth/password");
            (
                StatusCode::OK,
                Json(json!({
                    "passwordAuthEnabled": false,
                    "message": "Password protection disabled",
                })),
            )
                .into_response()
        }
        Err(err) => credential_error(err),
    }
}

/// Maps a [`CredentialError`] onto a status code, passing its message through verbatim.
///
/// Every message is safe to return to a caller who has already cleared `auth_middleware`: none of them
/// distinguishes anything `GET /api/auth/status` does not already say, and none quotes the submitted
/// password. A wrong current password is a `403` rather than a `401`, because the caller *is*
/// authenticated — they simply have not proved they know the credential they are replacing, and a `401`
/// would invite a client to go and re-authenticate.
fn credential_error(err: CredentialError) -> Response {
    let status = match err {
        CredentialError::CurrentPasswordRequired | CredentialError::CurrentPasswordIncorrect => {
            StatusCode::FORBIDDEN
        }
        CredentialError::NewPasswordEmpty => StatusCode::BAD_REQUEST,
        CredentialError::NotConfigured => StatusCode::CONFLICT,
        CredentialError::Config(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    if matches!(err, CredentialError::Config(_)) {
        tracing::error!("Could not update the session password: {err}");
    }
    (status, Json(json!({ "error": err.to_string() }))).into_response()
}
