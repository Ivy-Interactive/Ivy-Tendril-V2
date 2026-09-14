use crate::state::AppState;
use argon2::{Algorithm, Argon2, Params, PasswordHash, PasswordVerifier, Version};
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use serde_json::json;
use std::sync::Arc;

/// The `auth` block of `config.yaml`, as `tendril hash-password` tells the user to write it:
///
/// ```yaml
/// auth:
///   username: alice        # optional
///   password: $argon2i$v=19$m=65536,t=3,p=1$...
///   hashSecret: <base64>
/// ```
///
/// `TendrilSettings` has no typed `auth` section, so this is read out of its `extra` flatten map.
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
    /// Reads the block out of `TendrilSettings::extra`. Returns `None` — meaning "no password auth,
    /// behave exactly as before" — when the block is absent or incomplete; a half-written `auth`
    /// block must not be treated as a credential that can never match.
    pub fn from_settings(settings: &tendril_core::config::TendrilSettings) -> Option<Self> {
        let auth = settings.extra.get("auth")?.as_object()?;
        let string = |key: &str| auth.get(key).and_then(|v| v.as_str()).map(str::trim);

        let password_hash = string("password").filter(|s| !s.is_empty())?;
        let hash_secret_b64 = string("hashSecret")
            .or_else(|| string("hash_secret"))
            .filter(|s| !s.is_empty())?;
        let hash_secret = base64::engine::general_purpose::STANDARD
            .decode(hash_secret_b64)
            .ok()?;

        Some(Self {
            username: string("username")
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            password_hash: password_hash.to_string(),
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
/// The algorithm, version, m/t/p and salt all come out of the encoded string rather than from the
/// arguments below, so a hash written with different parameters — including one written by the
/// original Tendril — still validates. Any malformed input is a plain `false`: this sits on the
/// request path, so it must not panic and must not hand a caller an error message that distinguishes
/// "no such user" from "bad hash on disk".
pub fn verify_password(phc: &str, secret: &[u8], password: &str) -> bool {
    let parsed = match PasswordHash::new(phc) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };
    // These three are placeholders: `verify_password` below reads the real ones off `parsed`.
    let argon2 = match Argon2::new_with_secret(
        secret,
        Algorithm::Argon2i,
        Version::V0x13,
        Params::default(),
    ) {
        Ok(argon2) => argon2,
        Err(_) => return false,
    };
    argon2.verify_password(password.as_bytes(), &parsed).is_ok()
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

    if let Some(auth_val) = req.headers().get(axum::http::header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_val.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                if token == state.secret {
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
                    if k == "token" && v == state.secret {
                        authenticated = true;
                        break;
                    }
                }
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
                "message": "Missing or invalid bearer token"
            })),
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
