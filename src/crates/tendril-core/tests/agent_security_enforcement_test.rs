//! `AgentSecurityConfig` only matters if the seven security keys actually change what an agent
//! process is launched with, so every case here goes through the real pipeline: a project's
//! security config, through `apply_security_settings`, through `build_agent_spec`, down to the
//! argument vector (or `--settings` JSON) a provider CLI receives.

use std::path::PathBuf;
use tendril_core::agents::{apply_security_settings, build_agent_spec, AgentLaunchConfig};
use tendril_core::models::{
    AgentSecurityConfig, FileAccessRuleConfig, NetworkAccessRuleConfig, OutsideFileAccessPolicy,
    SandboxMode, SecurityPreset, TerminalAutoExecution,
};

fn base_launch_config() -> AgentLaunchConfig {
    AgentLaunchConfig {
        prompt: "Fix the bug".to_string(),
        working_directory: PathBuf::from("/tmp/tendril-work"),
        allowed_tools: vec!["Read".to_string()],
        writable_directories: vec!["/tmp/tendril-work".to_string()],
        ..Default::default()
    }
}

fn launch_config_for(security: &AgentSecurityConfig) -> AgentLaunchConfig {
    let mut config = base_launch_config();
    apply_security_settings(&mut config, security);
    config
}

/// A project with no security configuration at all resolves `InheritGeneral` to fully permissive,
/// per the plan's answered `inherit-general-fallback` question — a batch agent with no security
/// block configured must not silently become sandboxed.
#[test]
fn absent_security_config_resolves_to_permissive_defaults() {
    let config = launch_config_for(&AgentSecurityConfig::default());

    assert_eq!(config.sandbox_mode, Some("Disabled".to_string()));
    assert_eq!(config.network_access, Some(true));
    assert_eq!(config.permission_mode, Some("FullAuto".to_string()));
    assert!(config.denied_tools.is_empty());
}

#[test]
fn codex_toggles_its_sandbox_flag_off_and_on_with_sandbox_mode() {
    let unsandboxed = build_agent_spec(
        "codex",
        &launch_config_for(&AgentSecurityConfig {
            sandbox_mode: SandboxMode::Disabled,
            ..Default::default()
        }),
    );
    assert!(
        unsandboxed.args.iter().any(|a| a == "danger-full-access"),
        "Disabled sandbox_mode should render --sandbox danger-full-access, got {:?}",
        unsandboxed.args
    );

    let sandboxed = build_agent_spec(
        "codex",
        &launch_config_for(&AgentSecurityConfig {
            sandbox_mode: SandboxMode::Enabled,
            security_preset: SecurityPreset::Custom,
            ..Default::default()
        }),
    );
    assert!(
        sandboxed.args.iter().any(|a| a == "workspace-write"),
        "Enabled sandbox_mode should render --sandbox workspace-write, got {:?}",
        sandboxed.args
    );
}

/// `securityPreset: Strict` forces sandboxing on and network access off regardless of the explicit
/// `sandboxMode`/`networkAccessRules` values, since a preset is meant to override the individual
/// controls rather than merely default them.
#[test]
fn strict_preset_forces_sandboxing_and_denies_network_even_if_sandbox_mode_says_otherwise() {
    let security = AgentSecurityConfig {
        security_preset: SecurityPreset::Strict,
        sandbox_mode: SandboxMode::Disabled,
        ..Default::default()
    };
    let config = launch_config_for(&security);
    assert_eq!(config.sandbox_mode, Some("Enabled".to_string()));
    assert_eq!(config.network_access, Some(false));

    let spec = build_agent_spec("codex", &config);
    assert!(spec
        .args
        .iter()
        .any(|a| a == "sandbox_workspace_write.network_access=false"
            || a.contains("network_access=false")));
}

/// `networkAccessRules` containing a `Deny` entry denies network access even under the otherwise
/// permissive `Custom` preset, and Claude's `--settings` reflects it by denying the two web tools.
#[test]
fn a_deny_network_rule_denies_network_and_claude_removes_web_tools() {
    let security = AgentSecurityConfig {
        network_access_rules: vec![NetworkAccessRuleConfig {
            url_pattern: "*".to_string(),
            mode: "Deny".to_string(),
        }],
        ..Default::default()
    };
    let config = launch_config_for(&security);
    assert_eq!(config.network_access, Some(false));

    let spec = build_agent_spec("claude", &config);
    let settings_json = spec
        .args
        .iter()
        .position(|a| a == "--settings")
        .map(|i| spec.args[i + 1].clone())
        .expect("--settings should always be emitted");
    assert!(
        settings_json.contains("WebFetch") && settings_json.contains("WebSearch"),
        "denied network access should deny WebFetch/WebSearch, got {settings_json}"
    );
}

/// `terminalAutoExecution` maps onto Claude's `--permission-mode`: `AlwaysAsk` must actually ask,
/// while `AlwaysProceed`/`InheritGeneral` both run unattended (a batch agent has no user to ask).
#[test]
fn terminal_auto_execution_maps_to_claude_permission_mode() {
    let always_ask = launch_config_for(&AgentSecurityConfig {
        terminal_auto_execution: TerminalAutoExecution::AlwaysAsk,
        ..Default::default()
    });
    assert_eq!(always_ask.permission_mode, Some("default".to_string()));

    let always_proceed = launch_config_for(&AgentSecurityConfig {
        terminal_auto_execution: TerminalAutoExecution::AlwaysProceed,
        ..Default::default()
    });
    assert_eq!(always_proceed.permission_mode, Some("FullAuto".to_string()));

    let inherited = launch_config_for(&AgentSecurityConfig {
        terminal_auto_execution: TerminalAutoExecution::InheritGeneral,
        ..Default::default()
    });
    assert_eq!(inherited.permission_mode, Some("FullAuto".to_string()));
}

/// `outsideFileAccessPolicy: Deny` strips every writable directory a `filePermissions` rule would
/// otherwise have added, since the project's own worktree access is exactly what "outside file
/// access" gates.
#[test]
fn outside_file_access_deny_drops_configured_writable_directories() {
    let security = AgentSecurityConfig {
        outside_file_access_policy: OutsideFileAccessPolicy::Deny,
        file_permissions: vec![FileAccessRuleConfig {
            path: "/repos/other-project".to_string(),
            mode: "Allow".to_string(),
        }],
        ..Default::default()
    };
    let config = launch_config_for(&security);
    assert!(
        !config
            .writable_directories
            .iter()
            .any(|d| d == "/repos/other-project"),
        "Deny policy should not add the configured writable directory, got {:?}",
        config.writable_directories
    );

    let allowed = launch_config_for(&AgentSecurityConfig {
        outside_file_access_policy: OutsideFileAccessPolicy::Allow,
        file_permissions: vec![FileAccessRuleConfig {
            path: "/repos/other-project".to_string(),
            mode: "Allow".to_string(),
        }],
        ..Default::default()
    });
    assert!(allowed
        .writable_directories
        .iter()
        .any(|d| d == "/repos/other-project"));
}

/// A `Deny`-mode `filePermissions` rule becomes an explicit Claude tool denial rather than a
/// writable directory, so the agent cannot write or edit that path even though it can still read it.
#[test]
fn deny_mode_file_permission_becomes_a_claude_tool_denial() {
    let security = AgentSecurityConfig {
        file_permissions: vec![FileAccessRuleConfig {
            path: "/repos/secrets".to_string(),
            mode: "Deny".to_string(),
        }],
        ..Default::default()
    };
    let config = launch_config_for(&security);
    assert!(config
        .denied_tools
        .contains(&"Write(/repos/secrets)".to_string()));
    assert!(config
        .denied_tools
        .contains(&"Edit(/repos/secrets)".to_string()));
    assert!(!config
        .writable_directories
        .iter()
        .any(|d| d == "/repos/secrets"));

    let spec = build_agent_spec("claude", &config);
    let settings_json = spec
        .args
        .iter()
        .position(|a| a == "--settings")
        .map(|i| spec.args[i + 1].clone())
        .expect("--settings should always be emitted");
    assert!(settings_json.contains("Write(/repos/secrets)"));
    assert!(settings_json.contains("Edit(/repos/secrets)"));
}

/// `allowedTerminalCommands` populates the tool allowlist with a `Bash(<cmd> *)` entry per command,
/// which is what lets an agent actually run that command without a broad `Bash` grant.
#[test]
fn allowed_terminal_commands_populate_the_bash_allowlist() {
    let security = AgentSecurityConfig {
        allowed_terminal_commands: vec!["npm".to_string(), "cargo".to_string()],
        ..Default::default()
    };
    let config = launch_config_for(&security);
    assert!(config.allowed_tools.contains(&"Bash(npm *)".to_string()));
    assert!(config.allowed_tools.contains(&"Bash(cargo *)".to_string()));

    let spec = build_agent_spec("claude", &config);
    assert!(spec.args.iter().any(|a| a.contains("Bash(npm *)")));
    assert!(spec.args.iter().any(|a| a.contains("Bash(cargo *)")));
}

/// Gemini's bare `--sandbox` flag is likewise driven by the resolved sandbox mode, not just Codex's.
#[test]
fn gemini_only_renders_sandbox_flag_when_enabled() {
    let disabled = build_agent_spec(
        "gemini",
        &launch_config_for(&AgentSecurityConfig {
            sandbox_mode: SandboxMode::Disabled,
            ..Default::default()
        }),
    );
    assert!(!disabled.args.iter().any(|a| a == "--sandbox"));

    let enabled = build_agent_spec(
        "gemini",
        &launch_config_for(&AgentSecurityConfig {
            sandbox_mode: SandboxMode::Enabled,
            ..Default::default()
        }),
    );
    assert!(enabled.args.iter().any(|a| a == "--sandbox"));
}
