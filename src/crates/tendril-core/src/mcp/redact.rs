//! Secret redaction for MCP config tools.
//!
//! `TendrilSettings` carries a flattened `extra` map, so the config key set is open and a denylist
//! alone cannot be sound. Three layers guard what a config tool returns:
//!
//! 1. an allowlist of the keys `tendril_get_config` serves at all (see
//!    [`crate::mcp::dispatch`]),
//! 2. key-name redaction on everything that is returned ([`is_secret_key`]),
//! 3. value-shape redaction regardless of key name ([`is_secret_shaped`]), which is what catches
//!    an operator's `codingAgents[].environmentVariables` entry.

use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

pub const REDACTED: &str = "<redacted>";

/// Case-insensitive substrings that mark a key as secret-carrying.
const SECRET_KEY_SUBSTRINGS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "credential",
    "apikey",
    "api_key",
    "bearer",
    "cookie",
    "privatekey",
    "private_key",
    "signature",
    "salt",
];

static SECRET_KEY_WORD: LazyLock<Regex> = LazyLock::new(|| {
    // `key` on its own, or as a `_key` / `Key` suffix — so `monkey` and `keyBindings` survive.
    Regex::new(r"(?x)
        ^key$
      | (^|[^A-Za-z])key([^A-Za-z]|$)
      | _key$
      | [a-z0-9]Key$
    ")
    .expect("secret key-word regex")
});

static SECRET_VALUE_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"gh[pousr]_[A-Za-z0-9]{20,}",
        r"github_pat_[A-Za-z0-9_]{20,}",
        r"sk-(ant-)?[A-Za-z0-9_-]{20,}",
        r"xox[baprs]-[A-Za-z0-9-]{10,}",
        r"AKIA[0-9A-Z]{16}",
        r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*",
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("secret value regex"))
    .collect()
});

static OPAQUE_BLOB: LazyLock<Regex> = LazyLock::new(|| {
    // A whole value that is nothing but >=32 base64/hex characters. `/` is deliberately excluded so
    // filesystem paths (planFolder, planTemplate) are not mistaken for a blob.
    Regex::new(r"^[A-Za-z0-9+_=-]{32,}$").expect("opaque blob regex")
});

/// True when the key name alone marks the value as a secret.
pub fn is_secret_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    if SECRET_KEY_SUBSTRINGS.iter().any(|s| lower.contains(s)) {
        return true;
    }
    SECRET_KEY_WORD.is_match(&lower) || SECRET_KEY_WORD.is_match(key)
}

/// True when the value looks like a credential whatever its key is called.
pub fn is_secret_shaped(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    if SECRET_VALUE_PATTERNS.iter().any(|re| re.is_match(trimmed)) {
        return true;
    }
    OPAQUE_BLOB.is_match(trimmed)
}

/// Recursively redacts secret-named keys and secret-shaped values in a JSON tree.
pub fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, val) in map {
                if is_secret_key(key) {
                    out.insert(key.clone(), Value::String(REDACTED.to_string()));
                } else {
                    out.insert(key.clone(), redact_value(val));
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        Value::String(s) if is_secret_shaped(s) => Value::String(REDACTED.to_string()),
        other => other.clone(),
    }
}

/// Redacts a value that is being returned under a known key, applying the key-name layer to the
/// value itself as well as to anything nested inside it.
pub fn redact_named(key: &str, value: &Value) -> Value {
    if is_secret_key(key) {
        return Value::String(REDACTED.to_string());
    }
    redact_value(value)
}
