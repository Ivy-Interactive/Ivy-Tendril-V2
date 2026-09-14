//! Token authentication for the MCP server.
//!
//! Port of the legacy `McpAuthenticationService`. The expected token comes from
//! `TENDRIL_MCP_TOKEN`; when that variable is unset or blank, auth is **disabled** and every
//! request is allowed — the legacy default, and the only behaviour that keeps existing local
//! client configs working.
//!
//! Stdio carries no per-request credential, so the transport takes the presented token from the
//! process environment (`TENDRIL_MCP_CLIENT_TOKEN`, falling back to `TENDRIL_MCP_TOKEN`) once at
//! startup via [`McpAuth::validate_env`]. A client may additionally present a token per request in
//! `initialize` params under `_meta["io.tendril/token"]`, which is the hook a future Streamable
//! HTTP transport needs.

use sha2::{Digest, Sha256};

pub const TOKEN_ENV_VAR: &str = "TENDRIL_MCP_TOKEN";
pub const CLIENT_TOKEN_ENV_VAR: &str = "TENDRIL_MCP_CLIENT_TOKEN";

/// The `_meta` key a client uses to present a token alongside a request.
pub const TOKEN_META_KEY: &str = "io.tendril/token";

#[derive(Debug, Clone)]
pub struct McpAuth {
    /// SHA-256 of the expected token, hashed once at construction. `None` = auth disabled.
    expected: Option<[u8; 32]>,
}

impl McpAuth {
    /// Reads the expected token from the environment.
    pub fn from_env() -> Self {
        Self::from_token(std::env::var(TOKEN_ENV_VAR).ok().as_deref())
    }

    /// Builds an authenticator for an explicit expected token. Blank or absent = auth disabled.
    pub fn from_token(token: Option<&str>) -> Self {
        let expected = token.and_then(normalize_token).map(|t| sha256(&t));
        Self { expected }
    }

    pub fn is_enabled(&self) -> bool {
        self.expected.is_some()
    }

    /// Validates a presented token. Always true when auth is disabled; false when auth is enabled
    /// and no token (or a blank one) was presented.
    pub fn validate(&self, provided: Option<&str>) -> bool {
        let Some(expected) = self.expected.as_ref() else {
            return true;
        };
        let Some(provided) = provided.and_then(normalize_token) else {
            return false;
        };
        constant_time_eq(expected, &sha256(&provided))
    }

    /// Validates the token the environment presents, for transports (stdio) that carry no
    /// per-request credential. `Ok(())` when auth is disabled.
    pub fn validate_env(&self) -> std::result::Result<(), String> {
        if !self.is_enabled() {
            tracing::info!(
                "MCP authentication is disabled: {} is not set. Every request will be allowed.",
                TOKEN_ENV_VAR
            );
            return Ok(());
        }

        let presented = std::env::var(CLIENT_TOKEN_ENV_VAR)
            .ok()
            .or_else(|| std::env::var(TOKEN_ENV_VAR).ok());

        if self.validate(presented.as_deref()) {
            Ok(())
        } else {
            Err(format!(
                "MCP authentication failed: the token in {} does not match {}.",
                CLIENT_TOKEN_ENV_VAR, TOKEN_ENV_VAR
            ))
        }
    }
}

/// Trims surrounding whitespace and one layer of double quotes, for legacy parity with
/// `McpAuthenticationService`. Returns `None` for a blank token.
fn normalize_token(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn sha256(value: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hasher.finalize().into()
}

/// Fold-XOR compare over the two digests. Legacy compared base64 digests with `string.Equals`,
/// which short-circuits on the first differing byte; this does not.
fn constant_time_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}
