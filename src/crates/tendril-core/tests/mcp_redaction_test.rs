//! Secret handling in the MCP config tools, and the token authenticator.
//!
//! `TendrilSettings` carries a flattened `extra` map, so the config key set is open. These tests
//! cover all three guards: the allowlist that decides what is returned at all, key-name redaction,
//! and value-shape redaction.

mod common;

use common::HomeFixture;
use serde_json::{json, Value};
use tendril_core::mcp::auth::McpAuth;
use tendril_core::mcp::dispatch::{McpDispatcher, PUBLIC_CONFIG_KEYS};
use tendril_core::mcp::redact::{redact_value, REDACTED};

/// A fixture home with a `config.yaml` that plants secrets in every place one can land: a top-level
/// key that only exists in the flattened `extra` map, a project's free-text context, and a coding
/// agent's environment variables.
fn fixture_with_config(label: &str) -> HomeFixture {
    let fixture = HomeFixture::new(label);
    std::fs::write(
        fixture.path.join("config.yaml"),
        r#"codingAgent: claude
jobTimeout: 30
maxConcurrentJobs: 4
theme: default
mcpToken: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345
bearerSecret: 3f8a1c9d2e7b4a6f5c0d8e1b2a3f4c5d6e7a8b9c0d1e2f3a
keyBindings:
  save: ctrl+s
monkey: business
codingAgents:
- name: claude
  environmentVariables:
    ANTHROPIC_API_KEY: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA
    HTTP_PROXY: http://localhost:8080
projects:
- name: Demo
  color: Blue
  context: |
    Deploys with the token ghp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ set in CI.
  repos:
  - path: /tmp/demo
verifications:
- name: RustBuild
  prompt: Run cargo build
"#,
    )
    .expect("write config.yaml");
    fixture
}

fn dispatcher(fixture: &HomeFixture) -> McpDispatcher {
    McpDispatcher::with_plans_dir(&fixture.path, &fixture.plans_dir())
}

async fn call(fixture: &HomeFixture, tool: &str, args: Value) -> tendril_core::mcp::ToolOutcome {
    dispatcher(fixture)
        .call(tool, &args)
        .await
        .unwrap_or_else(|e| panic!("{} should dispatch: {:?}", tool, e))
}

#[tokio::test]
async fn get_config_rejects_non_allowlisted_key() {
    let fixture = fixture_with_config("mcp-config-allowlist");

    for key in ["mcpToken", "mcptoken", "bearerSecret", "codingAgents"] {
        let outcome = call(&fixture, "tendril_get_config", json!({ "key": key })).await;
        assert!(
            outcome.is_error,
            "{} is not public and must be refused, got: {}",
            key, outcome.text
        );
        assert!(
            outcome.text.contains("Unknown or non-public config key"),
            "{}: unexpected message {}",
            key,
            outcome.text
        );
    }

    // The whole-config read serves the allowlist and nothing else.
    let outcome = call(&fixture, "tendril_get_config", json!({})).await;
    assert!(!outcome.is_error, "unexpected error: {}", outcome.text);
    let returned = outcome.structured.expect("config is a structured payload");
    let returned = returned.as_object().expect("an object");
    for key in returned.keys() {
        assert!(
            PUBLIC_CONFIG_KEYS.contains(&key.as_str()),
            "{} is not on the allowlist but was returned",
            key
        );
    }
    assert!(
        !outcome.text.contains("ghp_"),
        "no token may reach the text block: {}",
        outcome.text
    );
    assert_eq!(returned["codingAgent"], "claude", "public keys still work");
}

#[tokio::test]
async fn redacts_by_key_name() {
    let value = json!({
        "token": "not-even-secret-shaped",
        "apiKey": "plain",
        "password": "hunter2",
        "aws_secret": "x",
        "key": "y",
        "private_key": "z",
        "monkey": "business",
        "keyBindings": { "save": "ctrl+s" },
        "planFolder": "/Users/someone/.tendril/Plans"
    });

    let redacted = redact_value(&value);

    for secret in [
        "token",
        "apiKey",
        "password",
        "aws_secret",
        "key",
        "private_key",
    ] {
        assert_eq!(
            redacted[secret], REDACTED,
            "{} should be redacted by key name",
            secret
        );
    }
    assert_eq!(redacted["monkey"], "business", "'monkey' is not a key name");
    assert_eq!(
        redacted["keyBindings"]["save"], "ctrl+s",
        "'keyBindings' is not a secret carrier"
    );
    assert_eq!(
        redacted["planFolder"], "/Users/someone/.tendril/Plans",
        "a path must survive: it is not an opaque blob"
    );
}

#[tokio::test]
async fn redacts_by_value_shape() {
    let value = json!({
        "note": "deploys with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
        "model": "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "slack": "xoxb-1234567890-abcdefghij",
        "aws": "AKIAIOSFODNN7EXAMPLE",
        "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        "pem": "-----BEGIN RSA PRIVATE KEY-----",
        "blob": "3f8a1c9d2e7b4a6f5c0d8e1b2a3f4c5d6e7a8b9c0d1e2f3a",
        "agent": "claude",
        "timeout": 30,
        "nested": [{ "environmentVariables": { "HTTP_PROXY": "http://localhost:8080" } }]
    });

    let redacted = redact_value(&value);

    for shaped in ["note", "model", "slack", "aws", "jwt", "pem", "blob"] {
        assert_eq!(
            redacted[shaped], REDACTED,
            "{} is secret-shaped and must be redacted whatever its key is called",
            shaped
        );
    }
    assert_eq!(
        redacted["agent"], "claude",
        "an ordinary value must survive"
    );
    assert_eq!(redacted["timeout"], 30, "a number must survive");
    assert_eq!(
        redacted["nested"][0]["environmentVariables"]["HTTP_PROXY"], "http://localhost:8080",
        "a non-secret environment variable must survive"
    );
}

#[tokio::test]
async fn config_tools_redact_what_they_return() {
    let fixture = fixture_with_config("mcp-config-redact");

    let outcome = call(&fixture, "tendril_list_projects", json!({})).await;
    assert!(!outcome.is_error, "unexpected error: {}", outcome.text);
    let projects = outcome.structured.expect("structured payload");
    assert_eq!(projects["projects"][0]["name"], "Demo");
    assert_eq!(
        projects["projects"][0]["context"], REDACTED,
        "a context carrying a token must be redacted whole"
    );
    assert!(
        !outcome.text.contains("ghp_"),
        "no token may reach the text block: {}",
        outcome.text
    );

    let outcome = call(&fixture, "tendril_list_verifications", json!({})).await;
    assert!(!outcome.is_error, "unexpected error: {}", outcome.text);
    assert_eq!(
        outcome.structured.expect("structured payload")["verifications"][0]["name"],
        "RustBuild"
    );

    let outcome = call(
        &fixture,
        "tendril_list_verifications",
        json!({ "name": "NoSuchVerification" }),
    )
    .await;
    assert!(outcome.is_error, "an unknown verification name is an error");
}

#[test]
fn constant_time_token_compare_accepts_and_rejects() {
    let auth = McpAuth::from_token(Some("s3cret-token"));
    assert!(auth.is_enabled());
    assert!(
        auth.validate(Some("s3cret-token")),
        "the exact token passes"
    );
    assert!(
        auth.validate(Some("  \"s3cret-token\"  ")),
        "surrounding whitespace and quotes are stripped, for legacy parity"
    );
    assert!(
        !auth.validate(Some("s3cret-toke")),
        "a near miss is rejected"
    );
    assert!(!auth.validate(Some("")), "a blank token is rejected");
    assert!(
        !auth.validate(None),
        "no token is rejected while auth is enabled"
    );

    for disabled in [None, Some(""), Some("   "), Some("\"\"")] {
        let auth = McpAuth::from_token(disabled);
        assert!(
            !auth.is_enabled(),
            "{:?} must leave auth disabled",
            disabled
        );
        assert!(
            auth.validate(None) && auth.validate(Some("anything")),
            "{:?}: auth off means every request is allowed",
            disabled
        );
        assert!(
            auth.validate_env().is_ok(),
            "{:?}: startup must pass",
            disabled
        );
    }
}
