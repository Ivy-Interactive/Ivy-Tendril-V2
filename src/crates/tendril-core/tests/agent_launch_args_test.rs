//! The exact argument vector each provider renders from one fully populated `AgentLaunchConfig`.
//!
//! Every one of these assertions fails if a provider silently drops a field of the launch config, so
//! this is the guard against the allowlists, denials, writable directories and MCP servers going
//! unrendered again.

use std::collections::HashMap;
use std::path::PathBuf;
use tendril_core::agents::{
    build_agent_spec, format_opencode_model, model_specs, pricing, AgentLaunchConfig,
    AgentProcessSpec, McpServerConfig, ANTIGRAVITY_TOOL_SCHEMA_GUARDRAILS,
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

/// The `tendril` MCP server from [`full_config`], as OpenCode declares one.
///
/// OpenCode takes no `--mcp-config` flag - `opencode run` has no such option, and passing one failed
/// the launch - so the server arrives in `OPENCODE_CONFIG_CONTENT` instead, in OpenCode's own shape:
/// key `mcp`, `"type": "local"`, and one argv array rather than a command plus separate args.
fn assert_opencode_mcp_env(spec: &AgentProcessSpec) {
    let raw = spec
        .environment
        .get("OPENCODE_CONFIG_CONTENT")
        .expect("an opencode spec with MCP servers should declare them in OPENCODE_CONFIG_CONTENT");
    let parsed: serde_json::Value =
        serde_json::from_str(raw).expect("OPENCODE_CONFIG_CONTENT should be a JSON document");
    assert_eq!(
        parsed,
        serde_json::json!({
            "mcp": {
                "tendril": {
                    "type": "local",
                    "command": ["tendril", "mcp"],
                    "enabled": true,
                }
            }
        })
    );
    assert!(
        !spec.args.iter().any(|a| a == "--mcp-config"),
        "opencode takes no --mcp-config flag"
    );
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
            "--flag",
        ])
    );
    assert_opencode_mcp_env(&spec);
}

/// The provider with no effort flag at all. Everything else on this page renders the level as its
/// own argument; Cursor has to fold it into the model, so the one field most likely to be silently
/// dropped is the one that does not appear in the argument list under its own name.
#[test]
fn cursor_folds_the_effort_into_the_model_id() {
    let spec = build_agent_spec("cursor", &full_config());

    assert!(
        spec.command.contains("cursor-agent"),
        "cursor should launch cursor-agent, got {}",
        spec.command
    );

    assert_eq!(
        spec.args,
        s(&[
            "--print",
            "--output-format",
            "stream-json",
            // Without `--trust`, a `--print` run stops to ask about the workspace and emits nothing.
            "--trust",
            "--force",
            // `opus` at `max`: the alias is not one of Cursor's families, so it carries no ladder
            // and stays bare rather than becoming a model id that does not exist.
            "--model",
            "opus",
            "--allowed-tools",
            "read_tool_call,edit_tool_call",
            "--exclude-tools",
            "shell_tool_call",
            "--add-dir",
            "/home/.tendril",
            "--add-dir",
            "/plans/00553",
            "--add-dir",
            "/plans/00553/Artifacts",
            "--flag",
        ])
    );

    // There is no `--effort` to find, on any model.
    assert!(!spec.args.iter().any(|a| a == "--effort"));

    // A real Cursor family does carry its ladder, and `max` is above plain Opus 5's top rung.
    let composed = |model: &str, effort: &str| {
        build_agent_spec(
            "cursor",
            &AgentLaunchConfig {
                model: Some(model.to_string()),
                effort: Some(effort.to_string()),
                ..full_config()
            },
        )
        .args
        .join(" ")
    };
    assert!(composed("claude-opus-5", "max").contains("--model claude-opus-5-high"));
    assert!(
        composed("claude-opus-5-thinking", "max").contains("--model claude-opus-5-thinking-max")
    );
    assert!(composed("gpt-5.6-terra", "low").contains("--model gpt-5.6-terra-low"));

    // The prompt goes down stdin, and the system prompt with it -- `--system-prompt` parses locally
    // and is then rejected by the server, so there is nothing to render it as.
    assert_eq!(spec.stdin_content.as_deref(), Some("Do the thing."));
    assert!(spec.redirect_stdin);

    // MCP is not rendered at all: Cursor reads servers only from `.cursor/mcp.json`, and writing
    // that would clobber the user's own file. A `--mcp-config` here would be a flag Cursor rejects.
    assert!(!spec.args.iter().any(|a| a == "--mcp-config"));
    assert!(spec.temp_files.is_empty());
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
fn antigravity_injects_tool_schema_guardrails_into_prompt_file() {
    let spec = build_agent_spec("antigravity", &full_config());

    let prompt_arg = spec.args.last().expect("prompt argument");
    let path = prompt_arg
        .strip_prefix('@')
        .expect("antigravity takes its prompt as @<file>");
    let content = std::fs::read_to_string(path).expect("prompt file must exist on disk");

    assert!(
        content.starts_with(ANTIGRAVITY_TOOL_SCHEMA_GUARDRAILS),
        "prompt file must lead with the tool schema guardrails, got: {}",
        content
    );
    assert!(
        content.contains("WaitMsBeforeAsync: 10000"),
        "must carry WaitMsBeforeAsync guidance"
    );
    assert!(
        content.contains("manage_task"),
        "must carry manage_task polling guidance"
    );
    assert!(
        content.contains("Do the thing."),
        "must still carry the caller's prompt"
    );

    for temp in &spec.temp_files {
        let _ = std::fs::remove_file(temp);
    }
}

/// Even when the caller pre-wrote its own prompt file (as `ChatExecutionManager` does for other
/// providers), antigravity must not trust it as-is: it writes a fresh temp file with the guardrails
/// prepended and points `--print` at that instead.
#[test]
fn antigravity_with_prompt_file_path_still_injects_guardrails() {
    let preexisting = std::env::temp_dir().join(format!(
        "tendril-test-preexisting-prompt-{}.md",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&preexisting, "Do the thing.").expect("write pre-existing prompt file");

    let config = AgentLaunchConfig {
        prompt_file_path: Some(preexisting.to_string_lossy().to_string()),
        ..full_config()
    };
    let spec = build_agent_spec("antigravity", &config);

    let prompt_arg = spec.args.last().expect("prompt argument");
    let path = prompt_arg
        .strip_prefix('@')
        .expect("antigravity takes its prompt as @<file>");
    assert_ne!(
        path,
        preexisting.to_string_lossy(),
        "antigravity must write a fresh temp file, not reuse the caller's prompt_file_path"
    );
    assert!(
        spec.temp_files.iter().any(|t| t.to_string_lossy() == path),
        "the fresh prompt file must be registered in temp_files for cleanup"
    );

    let content = std::fs::read_to_string(path).expect("prompt file must exist on disk");
    assert!(
        content.starts_with(ANTIGRAVITY_TOOL_SCHEMA_GUARDRAILS),
        "prompt file must lead with the tool schema guardrails, got: {}",
        content
    );

    for temp in &spec.temp_files {
        let _ = std::fs::remove_file(temp);
    }
    let _ = std::fs::remove_file(&preexisting);
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
            "--flag",
        ])
    );
    assert_opencode_mcp_env(&spec);
    assert_eq!(
        spec.environment.get("ANTHROPIC_BASE_URL"),
        Some(&"https://llmproxy.ivy.app".to_string())
    );
}

#[test]
fn apple_pins_the_only_model_fm_serve_offers_and_drops_effort() {
    let spec = build_agent_spec("apple", &full_config());

    // `full_config` asks for opus at max effort. Neither survives: `fm serve` serves exactly one
    // model and rejects any other id, and the on-device model has no reasoning-effort control, so
    // no `--variant` is rendered at all.
    assert_eq!(
        args_with_mcp_placeholder(&spec),
        s(&[
            "run",
            "--auto",
            "--format",
            "json",
            "--model",
            "apple/system",
            "--agent",
            "apple-fm",
            "--flag",
        ])
    );

    // OpenCode ships no Apple provider, so the launch carries one inline rather than writing a
    // config file the spec would have to clean up.
    let config = spec
        .environment
        .get("OPENCODE_CONFIG_CONTENT")
        .expect("apple must declare its provider inline");
    let parsed: serde_json::Value =
        serde_json::from_str(config).expect("the inline config must be valid JSON");
    assert_eq!(
        parsed["provider"]["apple"]["options"]["baseURL"],
        serde_json::json!("http://127.0.0.1:1976/v1"),
        "the provider must point at the local fm serve endpoint"
    );
    assert_eq!(
        parsed["provider"]["apple"]["models"]["system"]["limit"]["context"],
        serde_json::json!(8192)
    );
    // Every tool off, not a chosen few. Measured against a live `fm serve`: the six-tool list this
    // started as left 2,740 of the 8,192-token window spent describing tools before the question
    // was read, and turning the rest off brings that to 512. The model emits no tool calls at all,
    // so a tool left on buys nothing and costs the conversation its headroom.
    let tools = parsed["agent"]["apple-fm"]["tools"]
        .as_object()
        .expect("apple declares a tool surface");
    assert!(
        tools
            .values()
            .all(|enabled| enabled == &serde_json::json!(false)),
        "every tool must be off, found some enabled: {tools:?}"
    );
    for required in [
        // The catch-all, and the only entry that covers tools this code cannot name: OpenCode
        // registers one per discovered `SKILL.md` folder and one per tool an attached MCP server
        // advertises. Both leaked past a list of builtins (this repo's six skills cost 1,305 input
        // tokens against 507 in an empty directory; a one-tool probe server cost 47 more), and the
        // skills are what made the model announce a `tendrillable` call it never emitted.
        "*",
        // Kept named alongside the wildcard so a regression in the skill surface specifically
        // fails here, rather than silently restoring the loop.
        "skill",
        "webfetch",
        "task",
        "todowrite",
        "todoread",
        "patch",
        "multiedit",
        "bash",
        "edit",
        "write",
        "read",
        "grep",
        "glob",
        "list",
    ] {
        assert_eq!(
            tools.get(required),
            Some(&serde_json::json!(false)),
            "{required} must be named explicitly; OpenCode enables anything left unlisted"
        );
    }

    // The prompt is the half of this that tool flags cannot do. Under OpenCode's own prompt the
    // on-device model answered "are you alive?" with `[WebFetch] Retrieved from opencode.ai: ...`,
    // inventing a tool transcript for a tool that was already disabled and that the emitted JSON
    // shows was never called -- a small model given a prompt that is mostly tool-calling protocol
    // imitates the protocol. Replacing the prompt is what stops it.
    let prompt = parsed["agent"]["apple-fm"]["prompt"]
        .as_str()
        .expect("apple must override OpenCode's system prompt");
    assert!(
        prompt.contains("no tools"),
        "the prompt has to tell the model it has no tools: {prompt}"
    );
    assert!(
        prompt.contains("square brackets"),
        "the prompt has to name the shape it was hallucinating: {prompt}"
    );
    // The model cannot act, and the turn ends with its reply, so an announced intent is never
    // carried out -- that is what made a chat repeat "I will now find these issues" verbatim after
    // the user pointed out nothing had happened.
    assert!(
        prompt.contains("no later in which to act"),
        "the prompt has to rule out promising work it cannot do in a later turn: {prompt}"
    );
    // Removing the promise alone made it invent: the same question came back with three plausible
    // fabricated issues. It needs a truthful alternative to offer in place of the promise.
    assert!(
        prompt.contains("cannot access it"),
        "the prompt has to give it an honest refusal to use instead of inventing: {prompt}"
    );

    // The Apple stanza shares `OPENCODE_CONFIG_CONTENT` with the MCP servers, because `opencode
    // run` takes no `--mcp-config` flag and that variable is the only channel they have. Writing
    // the provider over the document instead of into it would silently drop every server and leave
    // the agent unable to call back into Tendril.
    assert_eq!(
        parsed["mcp"]["tendril"],
        serde_json::json!({
            "type": "local",
            "command": ["tendril", "mcp"],
            "enabled": true,
        }),
        "declaring the Apple provider must not drop the MCP servers sharing this variable"
    );

    // Declaring the agent does nothing on its own: OpenCode runs its default `build` agent unless
    // `--agent` names another one. Measured against `fm serve`, the difference is about 6.9k input
    // tokens versus about 4.5k for the same prompt, out of a window of 8k. Asserting the flag and
    // the stanza together is what keeps one from being changed without the other.
    let agent_flag = spec
        .args
        .iter()
        .position(|a| a == "--agent")
        .map(|i| spec.args[i + 1].as_str());
    assert_eq!(
        agent_flag,
        Some("apple-fm"),
        "the trimmed agent must be selected, not merely declared"
    );

    assert_eq!(
        spec.environment.get("OPENAI_BASE_URL"),
        Some(&"http://127.0.0.1:1976/v1".to_string())
    );
}

/// The id a run is billed under is the one the launch puts on the wire, not the one the catalog
/// happens to display. Those were two different strings once: the launch sent `apple/system` while
/// the price row was named `apple-foundation-system`, so `find` missed and `get_model_price` fell
/// back to its hardcoded 3.00/15.00 — a free on-device run recorded at Sonnet rates. Asserting the
/// launched id against the price list, rather than either one against a literal, is what keeps a
/// rename of one from silently un-pricing the other.
#[test]
fn the_apple_model_the_launch_sends_is_the_one_the_price_list_knows() {
    let spec = build_agent_spec("apple", &full_config());

    let model_index = spec
        .args
        .iter()
        .position(|a| a == "--model")
        .expect("apple must pin a model");
    let launched = &spec.args[model_index + 1];

    let priced = model_specs::find(launched)
        .unwrap_or_else(|| panic!("the launched model '{}' is not in the price list", launched));
    assert_eq!(priced.model_id.as_ref(), launched);

    let price = pricing::get_model_price(launched);
    assert_eq!(
        (price.input_per_million, price.output_per_million),
        (0.0, 0.0),
        "the on-device model runs locally and bills nothing"
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
            "--flag",
        ])
    );
    assert_opencode_mcp_env(&spec);
}

/// The interactive command line, which is not the one-shot one: an agent that draws its own terminal
/// takes different flags, and V1 keeps a separate `IAgentPty.BuildPtySpec` per provider for exactly
/// that reason.
#[test]
fn test_interactive_pty_specs_match_v1() {
    use tendril_core::agents::providers::{build_agent_pty_spec, AgentPtyConfig};

    let with_prompt = |agent: &str| {
        build_agent_pty_spec(
            agent,
            &AgentPtyConfig {
                model: Some("default".to_string()),
                initial_prompt: Some("fix the queue".to_string()),
                ..Default::default()
            },
        )
        .argv
    };

    // `ClaudePty`: full bypass, because `--permission-mode dontAsk` still stops to ask before running
    // a command, and the initial task is the trailing positional argument Claude auto-submits.
    assert_eq!(
        with_prompt("claude"),
        vec!["claude", "--dangerously-skip-permissions", "fix the queue"]
    );
    // `default` is not a model, so it is not passed as one.
    assert!(!with_prompt("claude").contains(&"--model".to_string()));
    // An unknown agent is Claude, the default provider.
    assert_eq!(with_prompt("nonesuch")[0], "claude");

    // `AntigravityPty`: `-i` runs the prompt and stays interactive.
    assert_eq!(
        with_prompt("antigravity"),
        vec![
            "agy",
            "--dangerously-skip-permissions",
            "-i",
            "fix the queue"
        ]
    );

    // `CodexPty`: sandboxed with approvals off, prompt trailing.
    let codex = with_prompt("codex");
    assert_eq!(codex[0], "codex");
    assert!(codex
        .windows(2)
        .any(|w| w == ["--ask-for-approval", "never"]));
    assert_eq!(codex.last().map(String::as_str), Some("fix the queue"));

    // `GeminiPty`: `--yolo --skip-trust`, prompt behind `-i`.
    let gemini = with_prompt("gemini");
    assert!(gemini.contains(&"--yolo".to_string()));
    assert!(gemini.contains(&"--skip-trust".to_string()));
    assert!(gemini.windows(2).any(|w| w == ["-i", "fix the queue"]));

    // `CursorPty`: `--trust` is as necessary interactively as it is in `--print`, but `--force` is
    // not -- an interactive user is there to approve. And no `--print`/`--output-format`, which
    // would turn the pane into a log.
    let cursor = with_prompt("cursor");
    // The binary resolves to an absolute path when one is installed, the same way OpenCode's does.
    assert!(cursor[0].ends_with("cursor-agent"), "got {}", cursor[0]);
    assert_eq!(cursor[1], "--trust");
    assert!(!cursor.contains(&"--print".to_string()));
    assert!(!cursor.contains(&"--force".to_string()));
    assert_eq!(cursor.last().map(String::as_str), Some("fix the queue"));
    // `default` is not a model here either.
    assert!(!cursor.contains(&"--model".to_string()));

    // A real model is composed the same way the one-shot path composes it, minus an effort the
    // interactive config has no field for.
    let cursor_model = build_agent_pty_spec(
        "cursor",
        &AgentPtyConfig {
            model: Some("claude-opus-5".to_string()),
            ..Default::default()
        },
    )
    .argv;
    assert!(cursor_model
        .windows(2)
        .any(|w| w == ["--model", "claude-opus-5"]));

    // A real model reaches the command line, normalised the way the one-shot path normalises it.
    let claude_opus = build_agent_pty_spec(
        "claude",
        &AgentPtyConfig {
            model: Some("claude-opus-5".to_string()),
            ..Default::default()
        },
    )
    .argv;
    assert!(claude_opus.windows(2).any(|w| w == ["--model", "opus"]));

    // No prompt means no trailing argument and no flag left dangling.
    let bare = build_agent_pty_spec("antigravity", &AgentPtyConfig::default()).argv;
    assert_eq!(bare, vec!["agy", "--dangerously-skip-permissions"]);

    // `TERM=dumb` / `CI=true` are what tell a CLI it is being scraped; an interactive session must
    // not carry them, or the agent stops drawing the interface the pane exists to show.
    let env = build_agent_pty_spec("claude", &AgentPtyConfig::default()).environment;
    assert!(!env.contains_key("TERM"));
    assert!(!env.contains_key("CI"));
    assert_eq!(
        env.get("BASH_DEFAULT_TIMEOUT_MS").map(String::as_str),
        Some("300000")
    );

    // A caller's variables win, and reach the agent.
    let env = build_agent_pty_spec(
        "claude",
        &AgentPtyConfig {
            environment_variables: std::collections::HashMap::from([(
                "TENDRIL_CHAT_SESSION_ID".to_string(),
                "sess-1".to_string(),
            )]),
            ..Default::default()
        },
    )
    .environment;
    assert_eq!(
        env.get("TENDRIL_CHAT_SESSION_ID").map(String::as_str),
        Some("sess-1")
    );
}
