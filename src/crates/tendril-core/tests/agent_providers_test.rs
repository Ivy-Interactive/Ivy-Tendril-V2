use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use tendril_core::agents::{
    agent_command, build_agent_spec, format_opencode_model, translate_claude_tool,
    translate_copilot_tool, translate_cursor_tool, write_mcp_config, AgentLaunchConfig,
    McpServerConfig,
};

/// Serialises every test here that depends on the process temp directory.
///
/// `std::env::temp_dir` is process-global, and `agent_command_leaves_no_temp_files_behind` below
/// has to repoint it to count what one call leaves behind. Without this lock a sibling writing a
/// temp file during that window either lands inside the probe's count or, once the probe removes
/// its scratch directory, fails to be written at all.
///
/// That second case is what turned CI red. The outcome depends on how libtest happens to interleave
/// the tests: with enough threads the siblings start before the probe deletes anything and the file
/// is written fine, but as parallelism drops they run after it, `temp_dir()` names a directory that
/// is gone, and the write fails. Measured on this binary before the fix, it failed 20/20 runs at one
/// and at two test threads and 0/20 at three or more — so it was invisible on a developer machine
/// and deterministic on the runner.
fn temp_dir_lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    // A sibling that panicked while holding this poisoned it, and the poison says nothing about
    // whether the temp directory is usable — take it anyway rather than cascading one failure into
    // every other test in the file.
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Restores a process-global environment variable to what it was, on drop and on panic.
struct EnvGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &std::path::Path) -> Self {
        let previous = std::env::var(key).ok();
        // SAFETY: the caller holds `temp_dir_lock`, and every test in this binary that reads the
        // environment takes that lock first, so no other thread is reading it concurrently.
        unsafe { std::env::set_var(key, value) };
        Self { key, previous }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        // SAFETY: as in `set` — the lock is still held for as long as this guard is alive.
        unsafe {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }
}

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

    // Cursor names every tool `<verb>_tool_call`, and `--allowed-tools` rejects anything else.
    assert_eq!(translate_cursor_tool("read"), "read_tool_call");
    assert_eq!(translate_cursor_tool("write"), "edit_tool_call");
    assert_eq!(translate_cursor_tool("edit"), "edit_tool_call");
    assert_eq!(translate_cursor_tool("bash"), "shell_tool_call");
    assert_eq!(translate_cursor_tool("grep"), "grep_tool_call");
    assert_eq!(translate_cursor_tool("glob"), "glob_tool_call");
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
    let _temp_dir = temp_dir_lock();

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

/// A path is only returned for a file that really is on disk.
///
/// Every caller pushes this straight onto `--mcp-config`, so a path to a file the write never
/// created launches the agent pointing at nothing: it comes up with no MCP servers, or rejects the
/// argument outright, and the only clue is the agent's own error. The write used to be
/// `let _ = fs::write(..)`, which discarded exactly the error that says so.
///
/// `TMPDIR` is the lever because `std::env::temp_dir` reads it and a caller does not control it — a
/// temp directory that is missing or unwritable is the real shape of this failure, and it is also
/// how the sibling probe above used to break this very test.
#[test]
fn write_mcp_config_reports_a_failed_write_rather_than_naming_a_missing_file() {
    let _temp_dir = temp_dir_lock();

    let absent = std::env::temp_dir().join(format!(
        "tendril-mcp-no-such-directory-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&absent);

    let _tmpdir = EnvGuard::set("TMPDIR", &absent);
    let _tmp = EnvGuard::set("TMP", &absent);

    let servers = vec![McpServerConfig {
        name: "docs".to_string(),
        command: "node".to_string(),
        arguments: vec![],
        environment: HashMap::new(),
    }];

    assert!(
        write_mcp_config(&servers).is_none(),
        "a write into a directory that does not exist must not yield a path"
    );
}

#[test]
fn test_all_agent_providers_spec_generation() {
    // Several of these builders write a prompt or MCP file into the process temp directory.
    let _temp_dir = temp_dir_lock();

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
        ("cursor", "cursor-agent", true),
        // The three proxy flavours are the bundled OpenCode with a different base URL, not a
        // separate `ivy-agent` binary - see `resolve_opencode_binary`.
        ("ivy", "opencode", true),
        ("openaiproxy", "opencode", true),
        ("proxy", "opencode", true),
        // Apple is the same bundled OpenCode, pointed at `fm serve`.
        ("apple", "opencode", true),
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

/// `agent_command` is a probe: `health.rs`'s `agent_model_checks` calls it once per configured agent
/// on every run, so it must leave nothing behind.
///
/// Antigravity is the case that matters. Every other builder writes a temp file only when the config
/// asks for one, and a default `AgentLaunchConfig` asks for nothing — but `build_antigravity_spec`
/// writes its prompt file unconditionally, to get the tool-schema guardrails in. Only the runner
/// cleans `temp_files` up, and a probe never runs one, so this had been leaking a file per call.
#[test]
fn agent_command_leaves_no_temp_files_behind() {
    // Scoped to this test's own directory rather than the process-wide one. `std::env::temp_dir`
    // is shared by every test binary in the workspace, and several of them build antigravity specs
    // without cleaning `temp_files` up, so counting files there measured the whole suite's
    // behaviour instead of this call's: the assertion flipped depending on which siblings happened
    // to be running, failing about half the time under the default test-threads. `TMPDIR` is what
    // `temp_dir` reads on unix, and `TMP` on windows, so pointing them at a fresh directory makes
    // the count observe only the calls below.
    //
    // The lock and the guards are what keep that redirection from leaking out of this test. The
    // redirection is process-wide, and the scratch directory is deleted at the end, so a sibling
    // running in the window saw `temp_dir()` name a directory that no longer existed and its
    // `fs::write` failed silently.
    let _temp_dir = temp_dir_lock();

    let scratch = std::env::temp_dir().join(format!(
        "tendril-agent-command-probe-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch).expect("the probe needs a scratch directory");

    let _tmpdir = EnvGuard::set("TMPDIR", &scratch);
    let _tmp = EnvGuard::set("TMP", &scratch);

    let count_prompts = || {
        std::fs::read_dir(&scratch)
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok())
                    .filter(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with("tendril-agy-prompt")
                    })
                    .count()
            })
            .unwrap_or(0)
    };

    let before = count_prompts();
    for provider in [
        "antigravity",
        "agy",
        "claude",
        "codex",
        "gemini",
        "opencode",
        "copilot",
        "cursor",
        // The same bundled OpenCode as the row above, but reached through its own spec builder, so
        // a temp file leaked there would be missed by every other id in this list.
        "apple",
    ] {
        assert!(
            !agent_command(provider).is_empty(),
            "{provider} resolved to an empty command"
        );
    }
    let after = count_prompts();

    let _ = std::fs::remove_dir_all(&scratch);

    assert_eq!(
        before,
        after,
        "agent_command left a temp prompt file in {}",
        scratch.display()
    );
}
