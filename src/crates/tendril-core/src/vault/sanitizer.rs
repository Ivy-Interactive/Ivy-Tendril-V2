//! Faithful port of `VaultSecretSanitizer.cs`.
//!
//! This is the safety boundary of the whole vault subsystem: a vault is usually a *shared* GitHub
//! repository, so anything that reaches it must have credentials stripped first. Every value that
//! looks like a secret is replaced with a `${ENV_VAR}` placeholder the importing teammate fills in
//! locally, and the substitution is deliberately one-way.
//!
//! Two rules, both inherited from the C# implementation:
//!
//! * An environment value is replaced *wholesale* when either its key names a credential
//!   (`token`, `apiKey`, `password`, ...) **or** the value matches the secret pattern. A short or
//!   unrecognised token under a credential-shaped key still goes.
//! * A command-line argument has no key to inspect, so it is redacted by pattern only, in place.

use crate::models::ProjectMcpServerRef;
use regex::Regex;
use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

/// Substrings that mark a key as naming a credential. Matched case-insensitively.
const SENSITIVE_KEY_WORDS: &[&str] = &[
    "key",
    "token",
    "secret",
    "password",
    "auth",
    "credential",
    "pat",
    "bearer",
    "apikey",
    "api_key",
];

/// GitHub PATs (classic and fine-grained), OpenAI-style keys and bearer headers.
///
/// `LazyLock` rather than `once_cell::Lazy`: `once_cell` is not a dependency of this crate, and
/// `LazyLock` has been stable since 1.80 (this workspace builds on 1.98).
static SECRET_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-\.]+)",
    )
    .expect("the secret pattern is a valid regex")
});

/// Replaces an environment value with a `${ENV_VAR}` placeholder when its key names a credential or
/// the value itself looks like one.
///
/// Blank values pass through (there is nothing to leak, and blanking them would lose the fact that
/// the key exists), and a value that is *already* a `${...}` reference is left alone so a round trip
/// through the vault is idempotent.
pub fn sanitize_env_value(key: &str, value: &str) -> String {
    if value.trim().is_empty() {
        return value.to_string();
    }

    if value.starts_with("${") && value.ends_with('}') {
        return value.to_string();
    }

    if is_sensitive_key(key) || SECRET_PATTERN.is_match(value) {
        return format!("${{{}}}", normalize_env_var_name(key));
    }

    value.to_string()
}

/// Applies [`sanitize_env_value`] to every entry of an environment map.
pub fn sanitize_environment(environment: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    environment
        .iter()
        .map(|(key, value)| (key.clone(), sanitize_env_value(key, value)))
        .collect()
}

/// The `HashMap` shape used by [`ProjectMcpServerRef::environment`].
pub fn sanitize_environment_map(environment: &HashMap<String, String>) -> HashMap<String, String> {
    environment
        .iter()
        .map(|(key, value)| (key.clone(), sanitize_env_value(key, value)))
        .collect()
}

/// Whether a key names a credential. Case-insensitive substring match, so `GITHUB_TOKEN`, `apiKey`
/// and `X-Auth-Header` all qualify. A blank key never does.
pub fn is_sensitive_key(key: &str) -> bool {
    if key.trim().is_empty() {
        return false;
    }
    let lowered = key.to_lowercase();
    SENSITIVE_KEY_WORDS.iter().any(|word| lowered.contains(word))
}

/// Turns a key into a shell-safe environment variable name: upper-cased, `-` and `.` folded to `_`,
/// everything outside `[A-Z0-9_]` dropped.
///
/// Private in the C# original; public here so the placeholder shape can be asserted directly.
pub fn normalize_env_var_name(key: &str) -> String {
    key.to_uppercase()
        .chars()
        .map(|c| if c == '-' || c == '.' { '_' } else { c })
        .filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == '_')
        .collect()
}

/// Replaces every recognisable secret *inside* a free-form string with the literal `${API_KEY}`.
///
/// This is what protects command-line arguments, where the credential is embedded in a larger string
/// (`--header=Bearer ghp_...`) and there is no key to inspect. `$${API_KEY}` in the replacement is
/// how Rust's `regex` escapes a literal `$`, matching .NET's treatment of an unknown `${name}` group.
pub fn redact_secrets(value: &str) -> String {
    SECRET_PATTERN.replace_all(value, "$${API_KEY}").to_string()
}

/// Sanitizes one MCP server: arguments by pattern, environment values by key *and* pattern.
///
/// `command` is left untouched — it is a path to an executable, not a credential.
pub fn sanitize_mcp_server(server: &ProjectMcpServerRef) -> ProjectMcpServerRef {
    ProjectMcpServerRef {
        name: server.name.clone(),
        command: server.command.clone(),
        arguments: server.arguments.iter().map(|a| redact_secrets(a)).collect(),
        environment: sanitize_environment_map(&server.environment),
        disabled: server.disabled,
    }
}

pub fn sanitize_mcp_servers(servers: &[ProjectMcpServerRef]) -> Vec<ProjectMcpServerRef> {
    servers.iter().map(sanitize_mcp_server).collect()
}

/// Sanitizes MCP servers carried through a manifest's untyped `extra` passthrough.
///
/// A teammate's `mcpServers` block may hold keys V2 does not model; those are preserved, but any
/// `arguments` entry and any `environment` value inside it is still scrubbed. Anything not shaped
/// like an MCP server list is returned unchanged.
pub fn sanitize_mcp_servers_value(servers: &serde_json::Value) -> serde_json::Value {
    match servers {
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(sanitize_mcp_server_value).collect())
        }
        other => other.clone(),
    }
}

fn sanitize_mcp_server_value(server: &serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(fields) = server else {
        return server.clone();
    };

    let mut fields = fields.clone();

    if let Some(serde_json::Value::Array(arguments)) = fields.get("arguments").cloned() {
        let arguments = arguments
            .iter()
            .map(|argument| match argument.as_str() {
                Some(text) => serde_json::Value::String(redact_secrets(text)),
                None => argument.clone(),
            })
            .collect();
        fields.insert("arguments".to_string(), serde_json::Value::Array(arguments));
    }

    if let Some(serde_json::Value::Object(environment)) = fields.get("environment").cloned() {
        let environment = environment
            .iter()
            .map(|(key, value)| {
                let sanitized = match value.as_str() {
                    Some(text) => serde_json::Value::String(sanitize_env_value(key, text)),
                    None => value.clone(),
                };
                (key.clone(), sanitized)
            })
            .collect();
        fields.insert(
            "environment".to_string(),
            serde_json::Value::Object(environment),
        );
    }

    serde_json::Value::Object(fields)
}
