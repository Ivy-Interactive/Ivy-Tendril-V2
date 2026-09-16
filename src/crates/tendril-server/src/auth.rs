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

/// The `auth` block of `config.yaml`, as `tendril hash-password` tells the user to write it:
///
/// ```yaml
/// auth:
///   username: alice        # optional
///   password: $argon2i$v=19$m=65536,t=3,p=1$...
///   hashSecret: <base64>
/// ```
///
/// Read from `TendrilSettings::auth`, the typed section this plan added — before it existed the block
/// was pulled out of the untyped `extra` flatten map instead.
#[derive(Debug, Clone)]
pub struct BasicAuthConfig {
    /// Checked case-insensitively when present, ignored when absent — matching the original.
    pub username: Option<String>,
    /// The PHC string, not a plaintext password.
    pub password_hash: String,
    /// The pepper, decoded. Not recoverable from `password_hash`.
    pub hash_secret: Vec<u8>,
}

impl BasicAuthConfig {
    /// Reads the block out of `TendrilSettings::auth`. Returns `None` — meaning "no password auth,
    /// behave exactly as before" — when the block is absent or incomplete; a half-written `auth`
    /// block must not be treated as a credential that can never match.
    pub fn from_settings(settings: &tendril_core::config::TendrilSettings) -> Option<Self> {
        Self::from_auth_config(settings.auth.as_ref()?)
    }

    /// The same read against an already-extracted [`AuthConfig`], so the login route and the
    /// middleware agree on what counts as a usable credential.
    pub fn from_auth_config(auth: &AuthConfig) -> Option<Self> {
        if !auth.is_active() {
            return None;
        }
        let hash_secret = base64::engine::general_purpose::STANDARD
            .decode(auth.hash_secret.trim())
            .ok()
            .filter(|bytes| !bytes.is_empty())?;

        Some(Self {
            username: auth
                .username
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            password_hash: auth.password.trim().to_string(),
            hash_secret,
        })
    }

    /// Whether `user`/`password` from an `Authorization: Basic` header satisfy this config.
    pub fn accepts(&self, user: &str, password: &str) -> bool {
        if let Some(expected) = &self.username {
            if !expected.eq_ignore_ascii_case(user) {
                return false;
            }
        }
        verify_password(&self.password_hash, &self.hash_secret, password)
    }
}

/// Verifies `password` against the Argon2 PHC string `phc`, with `secret` as the Argon2 secret input
/// (pepper). `tendril hash-password` is the command that writes such a string.
///
/// A thin wrapper over [`tendril_core::auth::password::verify_password_with_secret`], kept because
/// this is the byte-oriented spelling the middleware and the CLI's tests already use. There is
/// deliberately only one Argon2 implementation in the workspace: the algorithm, version, m/t/p and
/// salt all come out of the encoded string rather than from constants, so a hash written by the
/// original Tendril still validates, and any malformed input is a plain `false` rather than a panic
/// or an error message that would distinguish "no such user" from "bad hash on disk".
pub fn verify_password(phc: &str, secret: &[u8], password: &str) -> bool {
    tendril_core::auth::password::verify_password_with_secret(phc, password, secret)
}

/// Decodes an `Authorization: Basic <base64(user:password)>` header value.
fn parse_basic(header: &str) -> Option<(String, String)> {
    let encoded = header.strip_prefix("Basic ")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    // Only the first colon separates; a password may contain colons.
    let (user, password) = decoded.split_once(':')?;
    Some((user.to_string(), password.to_string()))
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

    // The original Tendril authenticates with X-Api-Key; accept it as an alias for
    // Authorization: Bearer so existing scripted callers don't all get a 401.
    if !authenticated {
        if let Some(api_key_val) = req.headers().get("x-api-key") {
            if let Ok(api_key_str) = api_key_val.to_str() {
                if api_key_str == state.secret {
                    authenticated = true;
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

    // A session token from `POST /api/auth/login` is accepted in the same header. Checked after the
    // raw secret: it costs a signature verification, and no install that has not enabled password
    // auth can get past it.
    if !authenticated {
        if let Some(token) = bearer_token {
            let snapshot = state.settings_snapshot();
            authenticated = validate_session_token(snapshot.settings.auth.as_ref(), &token);
        }
    }

    // A share visitor has no bearer secret and no session token — they have the capability token that
    // came with their link. Three bindings make it narrow enough to hand to the internet:
    //
    // 1. It only works while a share is *recorded*, so stopping the share is the revocation.
    // 2. It only works for a request addressed to the tunnel's own host, so a leaked link cannot be
    //    replayed against loopback or the LAN.
    // 3. It only authorises `share::policy::share_token_allows` — deny-by-default, reads on one plan's
    //    surfaces plus comments and annotations, and no PUT/PATCH/DELETE at all.
    //
    // That third binding is the whole design. V1 fenced a share by filtering the sidebar
    // (`ShareAllowedAppIds`), which is sufficient *there* because V1 renders the UI on the server: an
    // app the shell will not route to is an app whose `Build()` never runs. V2 ships a bundle the
    // visitor controls, so hiding a nav row hides nothing — `fetch('/api/jobs')` from the console is
    // the same request either way. The fence has to be here, on the route.
    if !authenticated {
        let presented = req
            .headers()
            .get("x-tendril-share-token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .or_else(|| {
                req.uri().query().and_then(|q| {
                    q.split('&').find_map(|pair| {
                        pair.split_once('=')
                            .filter(|(k, _)| *k == "shareToken")
                            .map(|(_, v)| v.to_string())
                    })
                })
            })
            .unwrap_or_default();

        if !presented.is_empty() {
            let host = tendril_core::security::host_policy::strip_port(
                req.headers()
                    .get(axum::http::header::HOST)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or_default(),
            )
            .to_string();
            if let Some(session) = tendril_core::tunnel::share_state::read(&state.tendril_home) {
                authenticated = session.host.eq_ignore_ascii_case(&host)
                    && tendril_core::tunnel::share_state::tokens_match(&session.token, &presented)
                    && tendril_core::share::policy::share_token_allows(
                        req.method().as_str(),
                        req.uri().path(),
                    );
            }
        }
    }

    // Basic credentials are an *additional* accepted credential, checked last: with no `auth` block
    // in config.yaml `state.basic_auth` is `None` and nothing above or below this point changes.
    if !authenticated {
        if let Some(config) = &state.basic_auth {
            if let Some((user, password)) = req
                .headers()
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(parse_basic)
            {
                authenticated = config.accepts(&user, &password);
            }
        }
    }

    if authenticated {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Unauthorized",
                "message": "Missing or invalid credentials. Send Authorization: Bearer <secret> or X-Api-Key: <secret>"
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The same triple pinned in `tendril-cli`'s `hash_password` tests, produced by the original's
    /// Isopoh-based implementation.
    const V1_PHC: &str = "$argon2i$v=19$m=65536,t=3,p=1$K9UDN6FZZNVlZrOuQHgOuQ$UL4PysO6B9l6SbeMAugIU5ghXmutXzsXp/PZzXsBgFQ";
    const V1_SECRET_B64: &str = "R29sZGVuVmVjdG9yU2VjcmV0S2V5Rm9yVGVuZHJpbDEyMw==";
    const V1_PASSWORD: &str = "v1-golden-vector-password";

    fn v1_secret() -> Vec<u8> {
        base64::engine::general_purpose::STANDARD
            .decode(V1_SECRET_B64)
            .unwrap()
    }

    #[test]
    fn verifies_a_hash_written_by_the_original() {
        assert!(verify_password(V1_PHC, &v1_secret(), V1_PASSWORD));
    }

    #[test]
    fn rejects_a_malformed_phc_string_without_panicking() {
        for bad in [
            "",
            "not-a-hash",
            "$argon2i$",
            "$argon2i$v=19$m=65536,t=3,p=1$",
            "$argon2i$v=19$m=65536,t=3,p=1$notbase64!!$alsonotbase64!!",
            "$scrypt$ln=16,r=8,p=1$aM15713r3Xsvxbi31lqr1Q$nFNh2CVHVjNldFVKDHDlm4CmdRSCdEBsjjJxD+iCs5E",
        ] {
            assert!(
                !verify_password(bad, &v1_secret(), V1_PASSWORD),
                "{bad:?} must be rejected, not accepted"
            );
        }
    }

    #[test]
    fn rejects_an_argon2id_hash_it_has_no_matching_secret_for() {
        // A well-formed `$argon2id$` string from a different deployment: the algorithm parses, so
        // this exercises the verify path rather than the parse path.
        let other = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$FQz5MjQ2r5Yp3v1s0k7bXcYy8oJ0mPqRsTuVwXyZ0aA";
        assert!(!verify_password(other, &v1_secret(), V1_PASSWORD));
        assert!(!verify_password(other, &[], V1_PASSWORD));
    }

    #[test]
    fn rejects_an_empty_password_and_an_empty_secret() {
        assert!(!verify_password(V1_PHC, &v1_secret(), ""));
        assert!(!verify_password(V1_PHC, &[], V1_PASSWORD));
        assert!(!verify_password("", &[], ""));
    }

    #[test]
    fn basic_auth_config_needs_both_a_hash_and_a_secret() {
        let with = |yaml: &str| {
            let settings: tendril_core::config::TendrilSettings =
                serde_yaml::from_str(yaml).unwrap();
            BasicAuthConfig::from_settings(&settings)
        };

        assert!(with("codingAgent: claude").is_none(), "no auth block");
        assert!(
            with(&format!("auth:\n  password: '{}'\n", V1_PHC)).is_none(),
            "a hash with no pepper is incomplete"
        );
        assert!(
            with(&format!("auth:\n  hashSecret: '{}'\n", V1_SECRET_B64)).is_none(),
            "a pepper with no hash is incomplete"
        );
        assert!(
            with(&format!(
                "auth:\n  password: '{}'\n  hashSecret: 'not base64 !!'\n",
                V1_PHC
            ))
            .is_none(),
            "an undecodable pepper is not a usable credential"
        );

        let complete = with(&format!(
            "auth:\n  password: '{}'\n  hashSecret: '{}'\n",
            V1_PHC, V1_SECRET_B64
        ))
        .expect("a complete block is read");
        assert_eq!(complete.hash_secret, v1_secret());
        assert!(complete.username.is_none());
    }

    #[test]
    fn basic_auth_accepts_the_right_password_and_username() {
        let settings: tendril_core::config::TendrilSettings = serde_yaml::from_str(&format!(
            "auth:\n  username: Alice\n  password: '{}'\n  hashSecret: '{}'\n",
            V1_PHC, V1_SECRET_B64
        ))
        .unwrap();
        let config = BasicAuthConfig::from_settings(&settings).unwrap();

        assert!(
            config.accepts("alice", V1_PASSWORD),
            "username is case-insensitive"
        );
        assert!(config.accepts("ALICE", V1_PASSWORD));
        assert!(
            !config.accepts("bob", V1_PASSWORD),
            "a wrong username is rejected"
        );
        assert!(
            !config.accepts("alice", "wrong"),
            "a wrong password is rejected"
        );
    }

    #[test]
    fn basic_auth_ignores_the_username_when_config_names_none() {
        let settings: tendril_core::config::TendrilSettings = serde_yaml::from_str(&format!(
            "auth:\n  password: '{}'\n  hashSecret: '{}'\n",
            V1_PHC, V1_SECRET_B64
        ))
        .unwrap();
        let config = BasicAuthConfig::from_settings(&settings).unwrap();

        assert!(config.accepts("anyone", V1_PASSWORD));
        assert!(!config.accepts("anyone", "wrong"));
    }

    #[test]
    fn parses_a_basic_header_and_keeps_colons_in_the_password() {
        let encoded = base64::engine::general_purpose::STANDARD.encode("alice:pa:ss:word");
        assert_eq!(
            parse_basic(&format!("Basic {}", encoded)),
            Some(("alice".to_string(), "pa:ss:word".to_string()))
        );
        assert_eq!(parse_basic("Bearer abc"), None);
        assert_eq!(parse_basic("Basic !!!not-base64"), None);
        assert_eq!(
            parse_basic(&format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode("no-colon")
            )),
            None
        );
    }
}
