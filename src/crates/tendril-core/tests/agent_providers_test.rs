use std::collections::HashMap;
use std::path::PathBuf;
use tendril_core::agents::{
    build_agent_spec, format_opencode_model, translate_claude_tool, translate_copilot_tool,
    write_mcp_config, AgentLaunchConfig, McpServerConfig,
};

#[test]
fn test_tool_translation() {
    assert_eq!(translate_claude_tool("read"), "Read");
    assert_eq!(translate_claude_tool("write"), "Write");
    assert_eq!(translate_claude_tool("edit"), "Edit");
    assert_eq!(translate_claude_tool("bash"), "Bash");
    assert_eq!(translate_claude_tool("grep"), "Grep");
    assert_eq!(translate_claude_tool("glob"), "Glob");
    assert_eq!(translate_claude_tool("webfetch"), "WebFetch");
    assert_eq!(translate_claude_tool("websearch"), "WebSearch");
    assert_eq!(translate_claude_tool("CustomTool"), "CustomTool");

    assert_eq!(translate_copilot_tool("read"), "view");
    assert_eq!(translate_copilot_tool("write"), "apply_patch");
    assert_eq!(translate_copilot_tool("edit"), "apply_patch");
    assert_eq!(translate_copilot_tool("grep"), "rg");
    assert_eq!(translate_copilot_tool("glob"), "glob");
    assert_eq!(translate_copilot_tool("websearch"), "web_fetch");
    assert_eq!(translate_copilot_tool("webfetch"), "web_fetch");
}

#[test]
fn test_opencode_model_formatting() {
    // Default model resolution by base_url
    assert_eq!(
        format_opencode_model(None, Some("https://llmproxy.ivy.app")),
        "anthropic/claude-opus-5"
    );
    assert_eq!(
        format_opencode_model(Some("default"), Some("https://api.anthropic.com")),
        "anthropic/claude-sonnet-5"
    );
    assert_eq!(
        format_opencode_model(Some(""), Some("https://generativelanguage.googleapis.com")),
        "openai/gemini-3.8-flash"
    );
    assert_eq!(
        format_opencode_model(None, Some("https://api.berget.ai/v1")),
        "moonshotai/Kimi-K3"
    );
    assert_eq!(format_opencode_model(None, None), "openai/gpt-5.6-terra");

    // Existing prefix preserved
    assert_eq!(
        format_opencode_model(Some("custom-provider/custom-model"), None),
        "custom-provider/custom-model"
    );

    // Automatic vendor prefixing
    assert_eq!(
        format_opencode_model(Some("claude-3-7-sonnet-latest"), None),
        "anthropic/claude-3-7-sonnet-latest"
    );
    assert_eq!(format_opencode_model(Some("gpt-4o"), None), "openai/gpt-4o");
    assert_eq!(
        format_opencode_model(Some("o3-mini"), None),
        "openai/o3-mini"
    );
    assert_eq!(
        format_opencode_model(Some("gemini-2.5-pro"), None),
        "openai/gemini-2.5-pro"
    );
}

#[test]
fn test_mcp_config_generation() {
    assert!(write_mcp_config(&[]).is_none());

    let mut env = HashMap::new();
    env.insert("FOO".to_string(), "BAR".to_string());

    let servers = vec![McpServerConfig {
        name: "test-server".to_string(),
        command: "node".to_string(),
        arguments: vec!["server.js".to_string()],
        environment: env,
    }];

    let mcp_path = write_mcp_config(&servers);
    assert!(mcp_path.is_some());
    let path = mcp_path.unwrap();
    assert!(path.exists());

    let content = std::fs::read_to_string(&path).expect("Failed to read MCP config");
    let parsed: serde_json::Value = serde_json::from_str(&content).expect("Invalid JSON");
    assert!(parsed.get("mcpServers").is_some());
    assert!(parsed["mcpServers"].get("test-server").is_some());
    assert_eq!(parsed["mcpServers"]["test-server"]["command"], "node");
    assert_eq!(parsed["mcpServers"]["test-server"]["args"][0], "server.js");
    assert_eq!(parsed["mcpServers"]["test-server"]["env"]["FOO"], "BAR");

    let _ = std::fs::remove_file(path);
}

#[test]
fn test_all_agent_providers_spec_generation() {
    let base_config = AgentLaunchConfig {
        prompt: "Fix the bug in the parser".to_string(),
        working_directory: PathBuf::from("D:/test-workspace"),
        model: Some("claude-sonnet-4".to_string()),
        effort: Some("high".to_string()),
        permission_mode: Some("FullAuto".to_string()),
        allowed_tools: vec!["read".to_string(), "edit".to_string(), "bash".to_string()],
        denied_tools: vec![],
        writable_directories: vec!["D:/test-workspace".to_string()],
        session_id: Some("session-12345".to_string()),
        environment_variables: {
            let mut m = HashMap::new();
            m.insert("MY_VAR".to_string(), "123".to_string());
            m
        },
        extra_arguments: vec!["--custom-flag".to_string()],
        system_prompt: Some("You are a senior engineer".to_string()),
        max_turns: Some(10),
        prompt_file_path: None,
        mcp_servers: vec![],
        timeout_seconds: Some(60),
        sandbox_mode: None,
        network_access: None,
    };

    let providers = [
        ("antigravity", "agy", false),
        ("agy", "agy", false),
        ("claude", "claude", true),
        ("codex", "codex", true),
        ("gemini", "gemini", true),
        ("opencode", "opencode", true),
        ("copilot", "copilot", true),
        // The three proxy flavours are the bundled OpenCode with a different base URL, not a
        // separate `ivy-agent` binary - see `resolve_opencode_binary`.
        ("ivy", "opencode", true),
        ("openaiproxy", "opencode", true),
        ("proxy", "opencode", true),
    ];

    for (provider_name, expected_cmd_prefix, expect_stdin) in providers {
        let spec = build_agent_spec(provider_name, &base_config);

        assert!(
            spec.command.to_lowercase().contains(expected_cmd_prefix) || spec.command == "gh",
            "Provider {} generated unexpected command: {}",
            provider_name,
            spec.command
        );

        assert_eq!(spec.working_directory, PathBuf::from("D:/test-workspace"));
        assert_eq!(spec.environment.get("MY_VAR"), Some(&"123".to_string()));

        if expect_stdin {
            assert!(
                spec.redirect_stdin,
                "Provider {} should redirect stdin",
                provider_name
            );
            assert!(
                spec.stdin_content.is_some(),
                "Provider {} should have stdin content",
                provider_name
            );
        }

        // Clean up any generated temp files
        for temp_file in spec.temp_files {
            if temp_file.exists() {
                let _ = std::fs::remove_file(temp_file);
            }
        }
    }
}
