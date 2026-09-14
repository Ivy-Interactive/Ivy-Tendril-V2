//! Port of `VaultSecretSanitizerTests.cs`.
//!
//! The sanitizer is the vault's safety boundary: everything pushed to a shared repository goes through
//! it, so each case here encodes a redaction rule rather than an implementation detail. Nothing in this
//! file touches the filesystem or the network.

use std::collections::{BTreeMap, HashMap};
use tendril_core::models::ProjectMcpServerRef;
use tendril_core::vault::sanitizer::{
    normalize_env_var_name, sanitize_env_value, sanitize_environment, sanitize_environment_map,
    sanitize_mcp_server, sanitize_mcp_servers, sanitize_mcp_servers_value,
};

#[test]
fn sensitive_values_are_replaced_by_a_placeholder() {
    // The C# table, as-is.
    let cases = [
        ("API_KEY", "sk-1234567890abcdef1234567890", "${API_KEY}"),
        (
            "GITHUB_TOKEN",
            "ghp_1234567890abcdef1234567890abcdef1234",
            "${GITHUB_TOKEN}",
        ),
        (
            "ANTHROPIC_AUTH_TOKEN",
            "secret-token-val",
            "${ANTHROPIC_AUTH_TOKEN}",
        ),
        (
            "DATABASE_PASSWORD",
            "SuperSecretPassword123!",
            "${DATABASE_PASSWORD}",
        ),
    ];

    for (key, value, expected) in cases {
        assert_eq!(
            sanitize_env_value(key, value),
            expected,
            "{} should be redacted",
            key
        );
    }
}

#[test]
fn harmless_values_pass_through() {
    assert_eq!(
        sanitize_env_value("BASE_URL", "https://api.example.com"),
        "https://api.example.com"
    );
    assert_eq!(sanitize_env_value("PORT", "8080"), "8080");
}

#[test]
fn an_existing_placeholder_is_preserved_verbatim() {
    // Round-tripping matters: an imported project already carries `${...}` references, and rewriting
    // them to `${API_KEY}` would break a teammate's own variable name.
    assert_eq!(
        sanitize_env_value("API_KEY", "${CUSTOM_KEY}"),
        "${CUSTOM_KEY}"
    );
}

#[test]
fn a_blank_value_passes_through_untouched() {
    assert_eq!(sanitize_env_value("API_KEY", ""), "");
    assert_eq!(sanitize_env_value("API_KEY", "   "), "   ");
}

#[test]
fn a_secret_under_a_harmless_key_is_still_caught() {
    // The key name is only half the signal; the pattern catches a token stored under `NOTES`.
    assert_eq!(
        sanitize_env_value("NOTES", "ghp_1234567890abcdef1234567890abcdef1234"),
        "${NOTES}"
    );
}

#[test]
fn env_var_names_are_normalized() {
    assert_eq!(normalize_env_var_name("my-key.name"), "MY_KEY_NAME");
    assert_eq!(
        sanitize_env_value("my-key.name", "sk-1234567890abcdef1234567890"),
        "${MY_KEY_NAME}"
    );
}

#[test]
fn a_blank_key_is_not_treated_as_sensitive() {
    // `IsSensitiveKey("")` is false in the C#: an empty key contains no sensitive word, and a
    // harmless value under it must survive.
    assert_eq!(sanitize_env_value("", "8080"), "8080");
}

#[test]
fn sanitize_environment_covers_both_map_types() {
    let mut ordered = BTreeMap::new();
    ordered.insert(
        "API_KEY".to_string(),
        "sk-1234567890abcdef1234567890".to_string(),
    );
    ordered.insert("PORT".to_string(), "3000".to_string());
    let sanitized = sanitize_environment(&ordered);
    assert_eq!(sanitized["API_KEY"], "${API_KEY}");
    assert_eq!(sanitized["PORT"], "3000");

    let mut hashed = HashMap::new();
    hashed.insert("SECRET".to_string(), "hunter2".to_string());
    hashed.insert("PORT".to_string(), "3000".to_string());
    let sanitized = sanitize_environment_map(&hashed);
    assert_eq!(sanitized["SECRET"], "${SECRET}");
    assert_eq!(sanitized["PORT"], "3000");
}

fn playwright_server() -> ProjectMcpServerRef {
    let mut environment = HashMap::new();
    environment.insert(
        "API_KEY".to_string(),
        "sk-1234567890abcdef1234567890".to_string(),
    );
    environment.insert("PORT".to_string(), "3000".to_string());

    ProjectMcpServerRef {
        name: "playwright".to_string(),
        command: "npx".to_string(),
        arguments: vec![
            "-y".to_string(),
            "@modelcontextprotocol/server-playwright".to_string(),
            "--api-key".to_string(),
            "ghp_1234567890abcdef1234567890abcdef1234".to_string(),
        ],
        environment,
        disabled: false,
    }
}

#[test]
fn mcp_server_arguments_and_environment_are_sanitized() {
    let sanitized = sanitize_mcp_server(&playwright_server());

    assert_eq!(sanitized.name, "playwright");
    assert_eq!(sanitized.command, "npx");
    assert_eq!(
        sanitized.arguments,
        vec![
            "-y".to_string(),
            "@modelcontextprotocol/server-playwright".to_string(),
            "--api-key".to_string(),
            "${API_KEY}".to_string(),
        ]
    );
    assert_eq!(sanitized.environment["API_KEY"], "${API_KEY}");
    assert_eq!(sanitized.environment["PORT"], "3000");
}

#[test]
fn sanitize_mcp_servers_maps_every_server() {
    let servers = vec![
        playwright_server(),
        ProjectMcpServerRef {
            name: "docs".to_string(),
            command: "docs-server".to_string(),
            arguments: vec!["--port".to_string(), "8080".to_string()],
            environment: HashMap::new(),
            disabled: true,
        },
    ];

    let sanitized = sanitize_mcp_servers(&servers);
    assert_eq!(sanitized.len(), 2);
    assert_eq!(sanitized[0].environment["API_KEY"], "${API_KEY}");
    assert_eq!(sanitized[1].arguments, vec!["--port", "8080"]);
    assert!(sanitized[1].disabled, "disabled must survive sanitizing");
}

#[test]
fn the_json_twin_sanitizes_the_extra_passthrough() {
    // `mcpServers` can also arrive as an unmodelled `extra` key from the C# app; it must be sanitized
    // in that shape too, without the round trip losing the keys V2 does not model.
    let value = serde_json::json!([
        {
            "name": "playwright",
            "command": "npx",
            "arguments": ["--api-key", "ghp_1234567890abcdef1234567890abcdef1234"],
            "environment": { "API_KEY": "sk-1234567890abcdef1234567890", "PORT": "3000" },
            "transport": "stdio"
        }
    ]);

    let sanitized = sanitize_mcp_servers_value(&value);
    let server = &sanitized[0];

    assert_eq!(server["arguments"][1], "${API_KEY}");
    assert_eq!(server["environment"]["API_KEY"], "${API_KEY}");
    assert_eq!(server["environment"]["PORT"], "3000");
    assert_eq!(
        server["transport"], "stdio",
        "unmodelled keys must survive sanitizing"
    );
}
