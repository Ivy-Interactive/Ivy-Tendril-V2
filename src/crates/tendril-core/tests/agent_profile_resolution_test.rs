//! Profile resolution: which profile name wins, and what model plus effort it turns into.

use std::collections::HashMap;
use tendril_core::agents::resolution::{normalize_agent_name, resolve_agent};
use tendril_core::config::TendrilSettings;

/// Mirrors the shape of the real `config.yaml`'s `codingAgents:` sequence.
const CONFIGURED_AGENTS: &str = r#"
codingAgents:
- name: claude
  arguments: ''
  environmentVariables: {}
  profiles:
  - name: deep
    model: opus
    effort: max
    arguments: ''
  - name: balanced
    model: sonnet
    effort: high
    arguments: ''
  - name: quick
    model: haiku
    effort: low
    arguments: ''
- name: codex
  profiles:
  - name: deep
    model: gpt-5.6-sol
    effort: high
  - name: balanced
    model: gpt-5.6-terra
    effort: medium
  - name: quick
    model: gpt-5.6-luna
    effort: low
- name: antigravity
  profiles:
  - name: deep
    model: gemini-3.7-flash
    effort: medium
  - name: balanced
    model: gemini-3.7-flash
    effort: medium
  - name: quick
    model: gemini-3.7-flash
    effort: medium
- name: copilot
  profiles:
  - name: deep
    effort: high
  - name: balanced
    effort: medium
  - name: quick
    effort: low
"#;

fn settings(yaml: &str) -> TendrilSettings {
    serde_yaml::from_str(yaml).expect("settings should parse")
}

fn resolve(
    settings: &TendrilSettings,
    agent: &str,
    promptware: &str,
    profile_override: Option<&str>,
) -> tendril_core::agents::resolution::AgentResolution {
    resolve_agent(
        settings,
        agent,
        promptware,
        profile_override,
        &HashMap::new(),
    )
}

#[test]
fn agent_name_normalization() {
    assert_eq!(normalize_agent_name("ClaudeCode"), "claude");
    assert_eq!(normalize_agent_name("CLAUDE"), "claude");
    assert_eq!(normalize_agent_name("Codex"), "codex");
    assert_eq!(normalize_agent_name(" gemini "), "gemini");
}

#[test]
fn configured_profiles_resolve_to_their_model_and_effort() {
    let s = settings(CONFIGURED_AGENTS);

    for (agent, tier, model, effort) in [
        ("claude", "deep", Some("opus"), Some("max")),
        ("claude", "balanced", Some("sonnet"), Some("high")),
        ("claude", "quick", Some("haiku"), Some("low")),
        ("codex", "deep", Some("gpt-5.6-sol"), Some("high")),
        ("codex", "balanced", Some("gpt-5.6-terra"), Some("medium")),
        ("codex", "quick", Some("gpt-5.6-luna"), Some("low")),
        (
            "antigravity",
            "deep",
            Some("gemini-3.7-flash"),
            Some("medium"),
        ),
        ("copilot", "deep", None, Some("high")),
        ("copilot", "quick", None, Some("low")),
    ] {
        let r = resolve(&s, agent, "ExecutePlan", Some(tier));
        assert_eq!(r.model.as_deref(), model, "{agent}/{tier} model");
        assert_eq!(r.effort.as_deref(), effort, "{agent}/{tier} effort");
        assert_eq!(r.profile.as_deref(), Some(tier), "{agent}/{tier} profile");
    }
}

#[test]
fn tier_defaults_apply_with_no_coding_agents_configured() {
    let s = TendrilSettings::default();
    assert!(s.coding_agents.is_empty());

    for (agent, tier, model, effort) in [
        ("claude", "deep", Some("opus"), Some("max")),
        ("claude", "balanced", Some("sonnet"), Some("high")),
        ("claude", "quick", Some("haiku"), Some("low")),
        ("codex", "deep", Some("gpt-5.6-sol"), Some("high")),
        ("opencode", "deep", None, Some("high")),
        ("copilot", "balanced", None, Some("medium")),
        (
            "antigravity",
            "quick",
            Some("gemini-3.7-flash"),
            Some("medium"),
        ),
        ("ivy", "deep", Some("claude-opus-5"), Some("max")),
        ("ivy", "quick", Some("gemini-3.7-flash"), Some("low")),
    ] {
        let r = resolve(&s, agent, "ExecutePlan", Some(tier));
        assert_eq!(r.model.as_deref(), model, "{agent}/{tier} model");
        assert_eq!(r.effort.as_deref(), effort, "{agent}/{tier} effort");
    }
}

#[test]
fn opencode_default_model_is_treated_as_unset() {
    // The built-in opencode tier model is literally "default", which means "leave it to the CLI".
    let s = TendrilSettings::default();
    let r = resolve(&s, "opencode", "ExecutePlan", Some("deep"));
    assert_eq!(r.model, None);
    assert_eq!(r.effort.as_deref(), Some("high"));
}

#[test]
fn gemini_gets_a_model_but_never_an_effort() {
    let s = TendrilSettings::default();
    for tier in ["deep", "balanced", "quick"] {
        let r = resolve(&s, "gemini", "ExecutePlan", Some(tier));
        assert_eq!(r.model.as_deref(), Some("gemini-3.7-flash"), "{tier} model");
        assert_eq!(r.effort, None, "{tier} must have no effort");
    }
}

#[test]
fn gemini_ignores_a_configured_effort_too() {
    let s = settings(
        r#"
codingAgents:
- name: gemini
  profiles:
  - name: deep
    model: gemini-custom
    effort: high
"#,
    );
    let r = resolve(&s, "gemini", "ExecutePlan", Some("deep"));
    assert_eq!(r.model.as_deref(), Some("gemini-custom"));
    assert_eq!(r.effort, None);
}

#[test]
fn profile_name_precedence_is_last_writer_wins() {
    let s = settings(
        r#"
codingAgents:
- name: claude
  profiles:
  - name: deep
    model: opus
    effort: max
  - name: balanced
    model: sonnet
    effort: high
  - name: quick
    model: haiku
    effort: low
promptwares:
  _default:
    profile: quick
  ExecutePlan:
    profile: balanced
"#,
    );

    // `_default` alone, for a promptware with no entry of its own.
    let r = resolve(&s, "claude", "CreatePlan", None);
    assert_eq!(r.profile.as_deref(), Some("quick"));
    assert_eq!(r.model.as_deref(), Some("haiku"));

    // The promptware's own profile beats `_default`.
    let r = resolve(&s, "claude", "ExecutePlan", None);
    assert_eq!(r.profile.as_deref(), Some("balanced"));
    assert_eq!(r.model.as_deref(), Some("sonnet"));

    // An override (the plan's executionProfile, or --profile) beats both.
    let r = resolve(&s, "claude", "ExecutePlan", Some("deep"));
    assert_eq!(r.profile.as_deref(), Some("deep"));
    assert_eq!(r.model.as_deref(), Some("opus"));

    // An empty override is not an override.
    let r = resolve(&s, "claude", "ExecutePlan", Some(""));
    assert_eq!(r.profile.as_deref(), Some("balanced"));
}

#[test]
fn model_and_effort_of_default_fall_through_to_the_tier_default() {
    let s = settings(
        r#"
codingAgents:
- name: claude
  profiles:
  - name: deep
    model: default
    effort: DEFAULT
"#,
    );

    let r = resolve(&s, "claude", "ExecutePlan", Some("deep"));
    assert_eq!(r.model.as_deref(), Some("opus"));
    assert_eq!(r.effort.as_deref(), Some("max"));
    assert_eq!(r.profile.as_deref(), Some("deep"));
}

#[test]
fn unknown_profile_falls_back_balanced_then_default_then_first_with_a_model() {
    // balanced wins when present.
    let s = settings(
        r#"
codingAgents:
- name: claude
  profiles:
  - name: custom
    model: custom-model
  - name: balanced
    model: sonnet
    effort: high
  - name: default
    model: fallback-model
"#,
    );
    let r = resolve(&s, "claude", "ExecutePlan", Some("no-such-profile"));
    assert_eq!(r.model.as_deref(), Some("sonnet"));
    assert_eq!(r.profile.as_deref(), Some("balanced"));

    // Then `default`.
    let s = settings(
        r#"
codingAgents:
- name: claude
  profiles:
  - name: custom
    model: custom-model
  - name: default
    model: fallback-model
"#,
    );
    let r = resolve(&s, "claude", "ExecutePlan", Some("no-such-profile"));
    assert_eq!(r.model.as_deref(), Some("fallback-model"));
    assert_eq!(r.profile.as_deref(), Some("default"));

    // Then the first profile that sets a model at all.
    let s = settings(
        r#"
codingAgents:
- name: claude
  profiles:
  - name: nothing
    model: default
  - name: custom
    model: custom-model
"#,
    );
    let r = resolve(&s, "claude", "ExecutePlan", Some("no-such-profile"));
    assert_eq!(r.model.as_deref(), Some("custom-model"));
    assert_eq!(r.profile.as_deref(), Some("custom"));
}

#[test]
fn no_agent_config_and_no_profile_resolves_to_nothing() {
    let s = TendrilSettings::default();
    let r = resolve(&s, "claude", "ExecutePlan", None);
    assert_eq!(r.model, None);
    assert_eq!(r.effort, None);
    assert_eq!(r.profile, None);
}

#[test]
fn agent_arguments_come_before_profile_arguments() {
    let s = settings(
        r#"
codingAgents:
- name: claude
  arguments: --agent-one --agent-two
  environmentVariables:
    AGENT_ENV: enabled
  profiles:
  - name: deep
    model: opus
    arguments: --profile-one
"#,
    );

    let r = resolve(&s, "claude", "ExecutePlan", Some("deep"));
    assert_eq!(
        r.extra_arguments,
        vec![
            "--agent-one".to_string(),
            "--agent-two".to_string(),
            "--profile-one".to_string()
        ]
    );
    assert_eq!(
        r.environment_variables.get("AGENT_ENV"),
        Some(&"enabled".to_string())
    );
}

#[test]
fn claudecode_config_entry_matches_a_claude_launch() {
    let s = settings(
        r#"
codingAgents:
- name: claudecode
  profiles:
  - name: deep
    model: opus
    effort: max
"#,
    );
    let r = resolve(&s, "claude", "ExecutePlan", Some("deep"));
    assert_eq!(r.agent, "claude");
    assert_eq!(r.model.as_deref(), Some("opus"));
}
