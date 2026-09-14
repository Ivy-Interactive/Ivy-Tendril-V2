//! The exact argument vector each provider renders from one fully populated `AgentLaunchConfig`.
//!
//! Every one of these assertions fails if a provider silently drops a field of the launch config, so
//! this is the guard against the allowlists, denials, writable directories and MCP servers going
//! unrendered again.

use std::collections::HashMap;
use std::path::PathBuf;
use tendril_core::agents::{
    build_agent_spec, format_opencode_model, AgentLaunchConfig, AgentProcessSpec, McpServerConfig,
};

/// One launch config exercising every field a provider might render.
fn full_config() -> AgentLaunchConfig {
    AgentLaunchConfig {
        prompt: "Do the thing.".to_string(),
        working_directory: PathBuf::from("/tmp/tendril-work"),
        model: Some("opus".to_string()),
        effort: Some("max".to_string()),
        permission_mode: Some("FullAuto".to_string()),
        allowed_tools: vec![
            "Read".to_string(),
            "Write(/plans/00553/Artifacts/**)".to_string(),
        ],
        denied_tools: vec!["Bash(rm -rf *)".to_string()],
        writable_directories: vec!["/home/.tendril".to_string(), "/plans/00553".to_string()],
        environment_variables: HashMap::from([("TENDRIL_TEST".to_string(), "1".to_string())]),
        extra_arguments: vec!["--flag".to_string()],
        mcp_servers: vec![McpServerConfig {
            name: "tendril".to_string(),
            command: "tendril".to_string(),
            arguments: vec!["mcp".to_string()],
            environment: HashMap::new(),
        }],
        ..Default::default()
    }
}

/// The MCP config lands in a temp file whose name is random, so it is compared by extension. Returns
/// the args with the path replaced by a stable placeholder, and deletes the temp file.
fn args_with_mcp_placeholder(spec: &AgentProcessSpec) -> Vec<String> {
    let mut out = Vec::new();
    let mut expect_path = false;
    for arg in &spec.args {
        if expect_path {
            assert!(
                arg.ends_with(".json"),
                "--mcp-config should be followed by a json file, got {}",
                arg
            );
            out.push("<mcp.json>".to_string());
            expect_path = false;
            continue;
        }
        expect_path = arg == "--mcp-config";
        out.push(arg.clone());
    }
    for temp in &spec.temp_files {
        let _ = std::fs::remove_file(temp);
    }
    out
}

fn s(items: &[&str]) -> Vec<String> {
    items.iter().map(|i| i.to_string()).collect()
}

#[test]
fn claude_renders_tools_permissions_denials_and_added_dirs() {
    let spec = build_agent_spec("claude", &full_config());

    assert_eq!(spec.command, "claude");
    assert_eq!(
        args_with_mcp_placeholder(&spec),
        s(&[
            "--print",
            "--verbose",
            "--output-format",
            "stream-json",
            "--permission-mode",
            "dontAsk",
            "--tools",
            "Read,Write(/plans/00553/Artifacts/**)",
            "--settings",
            r#"{"permissions":{"allow":["Read","Write(/plans/00553/Artifacts/**)"],"deny":["Bash(rm -rf *)"]}}"#,
            "--add-dir",
            "/home/.tendril",
            "--add-dir",
            "/plans/00553",
            "--model",
            "opus",
            "--effort",
            "max",
            "--mcp-config",
            "<mcp.json>",
            "--mcp-server",
            "tendril",
            "--flag",
            "-",
        ])
    );
    assert_eq!(spec.environment.get("TENDRIL_TEST"), Some(&"1".to_string()));
}

/// A job with no denials must emit the `--settings` object it always did.
#[test]
fn claude_omits_the_deny_key_when_nothing_is_denied() {
    let config = AgentLaunchConfig {
        denied_tools: Vec::new(),
        ..full_config()
    };
    let spec = build_agent_spec("claude", &config);
    let settings = spec
        .args
        .iter()
        .position(|a| a == "--settings")
        .map(|i| spec.args[i + 1].clone())
        .expect("--settings should be emitted");

    assert_eq!(
        settings,
        r#"{"permissions":{"allow":["Read","Write(/plans/00553/Artifacts/**)"]}}"#
    );
    for temp in &spec.temp_files {
        let _ = std::fs::remove_file(temp);
    }
}

#[test]
fn codex_turns_write_rules_into_added_dirs_after_the_explicit_ones() {
    let spec = build_agent_spec("codex", &full_config());

    assert_eq!(spec.command, "codex");
    assert_eq!(
        args_with_mcp_placeholder(&spec),
        s(&[
            "exec",
            "--sandbox",
            "workspace-write",
            "-c",
            "sandbox_workspace_write.network_access=true",
            "--json",
            "--skip-git-repo-check",
            "--model",
            "opus",
            "-c",
            "model_reasoning_effort=\"xhigh\"",
            "--add-dir",
            "/home/.tendril",
            "--add-dir",
            "/plans/00553",
            // Extracted from `Write(/plans/00553/Artifacts/**)`, after the explicit entries.
            "--add-dir",
            "/plans/00553/Artifacts",
            "--mcp-config",
            "<mcp.json>",
            "--flag",
            "-",
        ])
    );
}

#[test]
fn gemini_renders_included_directories_and_no_effort() {
    let spec = build_agent_spec("gemini", &full_config());

    assert_eq!(spec.command, "gemini");
    assert_eq!(
        args_with_mcp_placeholder(&spec),
        s(&[
            "--output-format",
            "stream-json",
            "--skip-trust",
            "--approval-mode",
            "yolo",
            "--prompt",
            " ",
            "--model",
            "opus",
            "--include-directories",
            "/home/.tendril",
            "--include-directories",
            "/plans/00553",
            "--mcp-config",
            "<mcp.json>",
            "--flag",
        ])
    );
}

#[test]
fn gemini_reads_dir_prefixed_allowlist_entries() {
    let config = AgentLaunchConfig {
        allowed_tools: vec![
            "Read".to_string(),
            "dir:/plans/00553/Artifacts/**".to_string(),
        ],
        writable_directories: Vec::new(),
        ..full_config()
    };
    let spec = build_agent_spec("gemini", &config);

    let dirs: Vec<&String> = spec
        .args
        .iter()
        .zip(spec.args.iter().skip(1))
        .filter(|(flag, _)| *flag == "--include-directories")
        .map(|(_, dir)| dir)
        .collect();
    assert_eq!(dirs, vec!["/plans/00553/Artifacts"]);
    for temp in &spec.temp_files {
        let _ = std::fs::remove_file(temp);
    }
}

#[test]
fn opencode_renders_neither_tools_nor_directories() {
    let spec = build_agent_spec("opencode", &full_config());

    assert_eq!(
        args_with_mcp_placeholder(&spec),
        s(&[
            "run",
            "--auto",
            "--format",
            "json",
            "--model",
            "anthropic/opus",
            "--variant",
            "max",
            "--mcp-config",
            "<mcp.json>",
            "--flag",
        ])
    );
}

#[test]
fn copilot_merges_explicit_and_extracted_directories() {
    let spec = build_agent_spec("copilot", &full_config());

    // Copilot is invoked either as `copilot` or as `gh copilot` depending on what is on PATH, so the
    // subcommand prefix is dropped before comparing.
    let args: Vec<String> = args_with_mcp_placeholder(&spec)
        .into_iter()
        .skip_while(|a| !a.starts_with("--"))
        .collect();

    assert_eq!(
        args,
        s(&[
            "--allow-all-paths",
            "--allow-all-urls",
            "--output-format",
            "json",
            "-s",
            "--available-tools",
            "view,Write(/plans/00553/Artifacts/**)",
            "--allow-all-tools",
            "--model",
            "opus",
            "--effort",
            "xhigh",
            "--add-dir",
            "/home/.tendril",
            "--add-dir",
            "/plans/00553",
            "--add-dir",
            "/plans/00553/Artifacts",
            "--mcp-config",
            "<mcp.json>",
            "--flag",
        ])
    );
}

#[test]
fn antigravity_renders_added_dirs_and_a_prompt_file() {
    let spec = build_agent_spec("antigravity", &full_config());

    let mut args = args_with_mcp_placeholder(&spec);
    let prompt_arg = args.pop().expect("prompt argument");
    assert!(
        prompt_arg.starts_with('@'),
        "antigravity takes its prompt as @<file>, got {}",
        prompt_arg
    );

    assert_eq!(
        args,
        s(&[
            "--dangerously-skip-permissions",
            "--output-format",
            "stream-json",
            "--model",
            "opus",
            "--effort",
            "high",
            "--add-dir",
            "/home/.tendril",
            "--add-dir",
            "/plans/00553",
            "--mcp-config",
            "<mcp.json>",
            "--flag",
            "--print",
        ])
    );
}

#[test]
fn ivy_delegates_to_opencode_with_the_proxy_model() {
    let spec = build_agent_spec("ivy", &full_config());

    assert_eq!(
        args_with_mcp_placeholder(&spec),
        s(&[
            "run",
            "--auto",
            "--format",
            "json",
            "--model",
            "anthropic/opus",
            "--variant",
            "max",
            "--mcp-config",
            "<mcp.json>",
            "--flag",
        ])
    );
    assert_eq!(
        spec.environment.get("ANTHROPIC_BASE_URL"),
        Some(&"https://llmproxy.ivy.app".to_string())
    );
}

#[test]
fn openai_proxy_delegates_to_opencode() {
    let spec = build_agent_spec("openaiproxy", &full_config());

    // The proxy's model depends on the base URL in the ambient environment, which is exactly what
    // `format_opencode_model` resolves, so the expectation is computed the same way.
    let base_url = std::env::var("OPENAI_BASE_URL")
        .or_else(|_| std::env::var("ANTHROPIC_BASE_URL"))
        .ok();
    let expected_model = format_opencode_model(Some("opus"), base_url.as_deref());

    assert_eq!(
        args_with_mcp_placeholder(&spec),
        s(&[
            "run",
            "--auto",
            "--format",
            "json",
            "--model",
            &expected_model,
            "--variant",
            "max",
            "--mcp-config",
            "<mcp.json>",
            "--flag",
        ])
    );
}
