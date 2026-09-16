//! The Settings screen's write path, end to end: the payload the Coding Agent pane sends is merged
//! into a real `config.yaml`, loaded, and handed to `resolve_agent`.
//!
//! `fixtures/settings-ui-payload.json` is the shared half of the contract. The webview test
//! `apps/tendril-app/tests/settings-coding-agent.test.tsx` asserts that the pane produces exactly this
//! body; this file asserts that the body reaches the launch. Neither side can drift without a failure:
//! a renamed key, a `default` written as the literal string, or a profile written under the wrong name
//! all show up here as a resolution that no longer carries the model, effort, arguments or environment
//! the operator set.

use std::collections::HashMap;
use std::path::PathBuf;
use tendril_core::agents::resolution::resolve_agent;
use tendril_core::config::{load_config, update_config_raw, TendrilSettings};

fn temp_config_path(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tendril-settings-ui-{}-{}",
        tag,
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("config.yaml")
}

fn ui_payload() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("settings-ui-payload.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {}", path.display(), e));
    serde_json::from_str(&raw).expect("fixture is valid JSON")
}

/// Writes the fixture through the same merge `PUT /api/config` performs, then reads it back.
fn settings_after_ui_save() -> (TendrilSettings, PathBuf) {
    let config_path = temp_config_path("resolution");
    std::fs::write(&config_path, "codingAgent: claude\n").unwrap();

    update_config_raw(&config_path, &ui_payload()).expect("the payload must be a valid config");

    let settings = load_config(&config_path).expect("the merged config must load");
    (settings, config_path)
}

#[test]
fn the_agent_the_pane_selected_is_the_one_that_is_launched() {
    let (settings, _path) = settings_after_ui_save();
    assert_eq!(settings.coding_agent, "openaiproxy");
}

#[test]
fn the_model_and_effort_the_pane_wrote_are_what_resolve_agent_returns() {
    let (settings, _path) = settings_after_ui_save();

    let resolution = resolve_agent(
        &settings,
        &settings.coding_agent,
        "ExecutePlan",
        Some("deep"),
        &HashMap::new(),
    );

    assert_eq!(resolution.agent, "openaiproxy");
    assert_eq!(resolution.model.as_deref(), Some("claude-opus-5"));
    assert_eq!(resolution.effort.as_deref(), Some("max"));
    assert_eq!(resolution.profile.as_deref(), Some("deep"));
}

#[test]
fn the_credentials_the_pane_wrote_reach_the_launch_environment() {
    let (settings, _path) = settings_after_ui_save();

    let resolution = resolve_agent(
        &settings,
        &settings.coding_agent,
        "ExecutePlan",
        Some("deep"),
        &HashMap::new(),
    );

    // The API key field writes both spellings, because the proxy is reached through either SDK.
    assert_eq!(
        resolution.environment_variables.get("ANTHROPIC_API_KEY"),
        Some(&"sk-fixture".to_string())
    );
    assert_eq!(
        resolution.environment_variables.get("OPENAI_API_KEY"),
        Some(&"sk-fixture".to_string())
    );
    // One base-URL field, two variables: the bare host for Anthropic, `/v1` for OpenAI.
    assert_eq!(
        resolution.environment_variables.get("ANTHROPIC_BASE_URL"),
        Some(&"https://api.anthropic.com".to_string())
    );
    assert_eq!(
        resolution.environment_variables.get("OPENAI_BASE_URL"),
        Some(&"https://api.anthropic.com/v1".to_string())
    );
    // A variable typed into the environment editor survives alongside the credential fields.
    assert_eq!(
        resolution.environment_variables.get("TENDRIL_TEST"),
        Some(&"1".to_string())
    );
}

#[test]
fn the_extra_arguments_the_pane_wrote_are_split_the_way_the_launch_splits_them() {
    let (settings, _path) = settings_after_ui_save();

    let resolution = resolve_agent(
        &settings,
        &settings.coding_agent,
        "ExecutePlan",
        Some("deep"),
        &HashMap::new(),
    );

    assert_eq!(resolution.extra_arguments, vec!["--verbose", "--no-color"]);
}

/// A tier the pane left as "Default" is written as the empty string, which `is_set` reads as unset —
/// so the built-in tier default applies rather than a literal `default` reaching the CLI.
#[test]
fn a_tier_left_as_default_falls_through_to_the_built_in_default() {
    let (settings, _path) = settings_after_ui_save();

    let resolution = resolve_agent(
        &settings,
        &settings.coding_agent,
        "ExecutePlan",
        Some("quick"),
        &HashMap::new(),
    );

    assert_ne!(resolution.model.as_deref(), Some("default"));
    assert_ne!(resolution.model.as_deref(), Some(""));
    assert_eq!(resolution.profile.as_deref(), Some("quick"));
}

/// The Appearance pane's three keys, written by the same `PUT /api/config`. They are modeled fields,
/// so a value that is not a string or a bool is refused rather than silently kept.
#[test]
fn the_appearance_keys_round_trip_through_the_config_merge() {
    let config_path = temp_config_path("appearance");
    std::fs::write(&config_path, "codingAgent: claude\n").unwrap();

    update_config_raw(
        &config_path,
        &serde_json::json!({ "theme": "dracula", "themeMode": "dark", "sidebarOpen": false }),
    )
    .expect("appearance keys must be a valid config");

    let settings = load_config(&config_path).expect("the merged config must load");
    assert_eq!(settings.theme, "dracula");
    assert_eq!(settings.theme_mode, "dark");
    assert!(!settings.sidebar_open);

    // Absent keys read as V1's defaults, so a config written before these existed behaves the same.
    let defaults_path = temp_config_path("appearance-defaults");
    std::fs::write(&defaults_path, "codingAgent: claude\n").unwrap();
    let defaults = load_config(&defaults_path).expect("a config without them must still load");
    assert_eq!(defaults.theme, "default");
    assert_eq!(defaults.theme_mode, "system");
    assert!(defaults.sidebar_open);
}
