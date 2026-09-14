//! Request credentials: the bearer secret the desktop app and CLI use, the optional `api.apiKey`
//! layer, and the session tokens `POST /api/auth/login` issues.
//!
//! The bearer path is the only credential V2 has ever had, so nothing here may make it stop working:
//! [`auth_middleware`] still accepts `Bearer <state.secret>` and `/api/ws?token=<secret>` first and
//! unchanged, and only then considers a session token. The API-key layer runs *in front of* this
//! middleware and is a no-op unless `api.apiKey` is set, so an install that has never configured one
//! behaves exactly as it did before.

use crate::state::AppState;
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::AuthConfig;

/// Session token lifetime, matching the original's access-token expiry.
pub const SESSION_TOKEN_TTL_SECONDS: i64 = 15 * 60;

const ISSUER: &str = "tendril";
const AUDIENCE: &str = "tendril-app";

/// Claims of a session token, in the original's shape so a token stays recognisable across the port.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionClaims {
    pub sub: String,
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
}

/// Signs a session token for `username` with the install's `auth.hashSecret`.
///
/// The signing key is the *decoded* `hashSecret`, so the token is only valid while that secret is
/// unchanged: rotating the password secret invalidates every issued token, which is the behaviour to
/// want from a credential that cannot otherwise be revoked.
pub fn issue_session_token(auth: &AuthConfig, username: &str, now: i64) -> anyhow::Result<String> {
    let key = decode_hash_secret(&auth.hash_secret)
        .ok_or_else(|| anyhow::anyhow!("auth.hashSecret is not valid base64"))?;

    let claims = SessionClaims {
        sub: username.to_string(),
        iss: ISSUER.to_string(),
        aud: AUDIENCE.to_string(),
        iat: now,
        exp: now + SESSION_TOKEN_TTL_SECONDS,
    };

    Ok(jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(&key),
    )?)
}

/// Whether `token` is a session token this install issued and still honours.
///
/// Returns `false` — never an error — for every failure mode, including password auth not being
/// configured at all, so an install with no `auth` block accepts no session tokens whatsoever.
pub fn validate_session_token(auth: Option<&AuthConfig>, token: &str) -> bool {
    let Some(auth) = auth else {
        return false;
    };
    if !auth.is_active() {
        return false;
    }
    let Some(key) = decode_hash_secret(&auth.hash_secret) else {
        return false;
    };

    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[AUDIENCE]);
    validation.set_required_spec_claims(&["exp", "iss", "aud"]);

    jsonwebtoken::decode::<SessionClaims>(token, &DecodingKey::from_secret(&key), &validation)
        .is_ok()
}

fn decode_hash_secret(hash_secret: &str) -> Option<Vec<u8>> {
    let trimmed = hash_secret.trim();
    if trimmed.is_empty() {
        return None;
    }
    base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .ok()
        .filter(|bytes| !bytes.is_empty())
}

/// Length-checked, constant-time-ish byte comparison for secrets: it never returns early on the
/// first differing byte, so a caller cannot walk a secret out one byte at a time by timing.
///
/// Lengths are compared first and that comparison is not constant time — a secret's length is not
/// what protects it.
pub fn secrets_match(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Response {
    let mut authenticated = false;
    // Only parsed if the raw secret did not match, so the common case pays nothing for it.
    let mut bearer_token: Option<String> = None;

    if let Some(auth_val) = req.headers().get(axum::http::header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_val.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                if secrets_match(token, &state.secret) {
                    authenticated = true;
                } else {
                    bearer_token = Some(token.to_string());
                }
            }
        }
    }

    // For WebSocket /api/ws, also support ?token=<secret> query parameter
    if !authenticated && req.uri().path() == "/api/ws" {
        if let Some(query) = req.uri().query() {
            for param in query.split('&') {
                if let Some((k, v)) = param.split_once('=') {
                    if k == "token" && secrets_match(v, &state.secret) {
                        authenticated = true;
                        break;
                    }
                }
            }
        }
    }

    // A session token from `POST /api/auth/login` is accepted in the same header. Checked last: it
    // costs a signature verification, and no install that has not enabled password auth can get here.
    if !authenticated {
        if let Some(token) = bearer_token {
            let snapshot = state.settings_snapshot();
            authenticated = validate_session_token(snapshot.settings.auth.as_ref(), &token);
        }
    }

    if authenticated {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Unauthorized",
                "message": "Missing or invalid bearer token"
            })),
        )
            .into_response()
    }
}

/// Port of `ApiKeyAuthMiddleware`: when `api.apiKey` is configured, every `/api` request must carry a
/// matching `X-Api-Key`.
///
/// This runs outside [`auth_middleware`], so a configured key is required *in addition to* a valid
/// bearer credential rather than as an alternative to it — the direction that can only make an
/// install stricter. With no key configured the layer does nothing, which is what every existing
/// install gets.
pub async fn api_key_middleware(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Response {
    let Some(expected) = state.api_key() else {
        return next.run(req).await;
    };

    if !req.uri().path().starts_with("/api") {
        return next.run(req).await;
    }

    let presented = req
        .headers()
        .get("X-Api-Key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    if secrets_match(presented, &expected) {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or missing API key" })),
        )
            .into_response()
    }
}
