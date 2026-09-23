use crate::models::{
    AgentSecurityConfig, OutsideFileAccessPolicy, SandboxMode, TerminalAutoExecution,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub environment: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentLaunchConfig {
    pub prompt: String,
    pub working_directory: PathBuf,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: Option<String>,
    pub allowed_tools: Vec<String>,
    pub denied_tools: Vec<String>,
    pub writable_directories: Vec<String>,
    pub session_id: Option<String>,
    pub environment_variables: HashMap<String, String>,
    pub extra_arguments: Vec<String>,
    pub system_prompt: Option<String>,
    pub max_turns: Option<i32>,
    pub prompt_file_path: Option<String>,
    pub mcp_servers: Vec<McpServerConfig>,
    pub timeout_seconds: Option<u64>,
    /// `Some("Enabled")` or `Some("Disabled")`, i.e. an [`AgentSecurityConfig::effective_sandbox_mode`]
    /// already resolved out of `InheritGeneral`. `None` preserves each provider's original hardcoded
    /// behavior, so a caller that never sets this field (every existing test and call site) renders
    /// byte-identical process specs to before this field existed.
    ///
    /// [`AgentSecurityConfig::effective_sandbox_mode`]: crate::models::project::AgentSecurityConfig::effective_sandbox_mode
    pub sandbox_mode: Option<String>,
    /// `Some(false)` denies outbound network access from the sandboxed agent process. `None` preserves
    /// each provider's original hardcoded behavior (network allowed), for the same reason as
    /// `sandbox_mode`.
    pub network_access: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AgentProcessSpec {
    pub command: String,
    pub args: Vec<String>,
    pub environment: HashMap<String, String>,
    pub working_directory: PathBuf,
    pub stdin_content: Option<String>,
    pub redirect_stdin: bool,
    pub temp_files: Vec<PathBuf>,
}

pub fn build_agent_spec(provider: &str, config: &AgentLaunchConfig) -> AgentProcessSpec {
    match provider.to_ascii_lowercase().as_str() {
        "antigravity" | "agy" => build_antigravity_spec(config),
        "codex" => build_codex_spec(config),
        "gemini" => build_gemini_spec(config),
        "opencode" => build_opencode_spec(config),
        "copilot" => build_copilot_spec(config),
        "cursor" => build_cursor_spec(config),
        "ivy" => build_ivy_spec(config),
        "openaiproxy" | "proxy" => build_openai_proxy_spec(config),
        "apple" => build_apple_spec(config),
        _ => build_claude_spec(config),
    }
}

/// The binary `provider` is launched as, derived from the same builders that launch it so the two
/// can never drift.
///
/// Side-effect free, which the builders themselves are not. Most write a temp file only when the
/// config asks for one — a default [`AgentLaunchConfig`] has no system prompt and no MCP servers —
/// but `build_antigravity_spec` writes its prompt file unconditionally, because the tool-schema
/// guardrails have to reach the agent even when the caller supplied a prompt file of its own. Only
/// the runner cleans `temp_files` up, so a spec built for its command and dropped leaks one every
/// call. `health.rs`'s `agent_model_checks` calls this once per configured agent on every probe,
/// which had been quietly filling the temp directory.
///
/// Discarding the spec rather than not building it keeps the no-drift property: the command still
/// comes from the same builder that launches the process.
pub fn agent_command(provider: &str) -> String {
    let spec = build_agent_spec(provider, &AgentLaunchConfig::default());
    for path in &spec.temp_files {
        let _ = std::fs::remove_file(path);
    }
    spec.command
}

/// What an agent is launched with for an **interactive** session under a pseudo-terminal, as opposed
/// to the one-shot `--print` run [`build_agent_spec`] builds.
#[derive(Debug, Clone, Default)]
pub struct AgentPtyConfig {
    pub model: Option<String>,
    /// A task typed for the agent on launch. Passed as an argument rather than written into the pty,
    /// so it cannot be mangled by a shell or raced by the agent's own startup — V1 says the same in
    /// `AgentApp.GetCommandLine`.
    pub initial_prompt: Option<String>,
    pub environment_variables: HashMap<String, String>,
    pub extra_arguments: Vec<String>,
}

/// The argv of an interactive agent session, and the environment it runs in.
#[derive(Debug, Clone)]
pub struct AgentPtySpec {
    /// `argv[0]` is the binary; there is no shell in the way, so nothing here needs quoting.
    pub argv: Vec<String>,
    pub environment: HashMap<String, String>,
}

/// Builds the interactive command line for `provider`. Port of V1's per-provider `IAgentPty`
/// `BuildPtySpec`, whose flags differ from the one-shot ones in ways that matter:
///
/// - Claude needs `--dangerously-skip-permissions`, not `--permission-mode dontAsk`: `dontAsk` still
///   prompts before running a command, and an interactive session that stops to ask is one the agent
///   never gets past (`ClaudePty.BuildPtySpec`'s comment says exactly this).
/// - Antigravity, Gemini, Copilot and OpenCode take an initial task as a flag (`-i` / `--prompt`);
///   Claude and Codex take it as the final positional argument and auto-submit it.
///
/// No `--output-format`: an interactive agent draws its own terminal UI, and the whole point of this
/// path is to show that UI rather than parse it.
pub fn build_agent_pty_spec(provider: &str, config: &AgentPtyConfig) -> AgentPtySpec {
    let model = config
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty() && !m.eq_ignore_ascii_case("default"));
    let normalized = crate::agents::resolution::normalize_agent_name(provider);
    let mut argv: Vec<String> = Vec::new();
    // A prompt passed as a flag, rather than as the trailing positional argument.
    let mut prompt_flag: Option<&str> = None;

    match normalized.as_str() {
        "antigravity" | "agy" => {
            argv.push("agy".to_string());
            argv.push("--dangerously-skip-permissions".to_string());
            prompt_flag = Some("-i");
        }
        "codex" => {
            argv.push("codex".to_string());
            argv.extend(
                [
                    "--sandbox",
                    "workspace-write",
                    "-c",
                    "sandbox_workspace_write.network_access=true",
                    "--ask-for-approval",
                    "never",
                ]
                .map(str::to_string),
            );
            if let Some(model) = model {
                argv.push("--model".to_string());
                argv.push(model.to_string());
            }
        }
        "gemini" => {
            argv.push("gemini".to_string());
            argv.push("--yolo".to_string());
            argv.push("--skip-trust".to_string());
            if let Some(model) = model {
                argv.push("--model".to_string());
                argv.push(model.to_string());
            }
            prompt_flag = Some("-i");
        }
        "copilot" => {
            let (binary, prefix) = resolve_copilot_binary();
            argv.push(binary);
            argv.extend(prefix);
            argv.extend(
                ["--allow-all-paths", "--allow-all-urls", "--allow-all-tools"].map(str::to_string),
            );
            if let Some(model) = model {
                argv.push("--model".to_string());
                argv.push(model.to_string());
            }
            prompt_flag = Some("-i");
        }
        // Cursor takes its reasoning level inside the model id rather than as a flag, so the pty
        // path composes the same way the one-shot one does — see `format_cursor_model`. `--trust`
        // is still required (an untrusted workspace prompts before the TUI is usable), but
        // `--print` / `--output-format` are not: this session is the interface, not a stream to
        // parse. `--force` is left off too, because an interactive user is there to approve.
        "cursor" => {
            argv.push(resolve_cursor_binary());
            argv.push("--trust".to_string());
            if let Some(model) = model {
                let composed = format_cursor_model(Some(model), None);
                if !composed.is_empty() {
                    argv.push("--model".to_string());
                    argv.push(composed);
                }
            }
        }
        // All four are OpenCode: `ivy` and the proxies are the same CLI pointed at a different
        // base URL, which is why they always shared `build_opencode_spec`. They used to resolve a
        // separately-shipped `ivy-agent` rebuild of it; Tendril bundles OpenCode itself now, so
        // there is one binary to find and one to ship.
        "opencode" | "ivy" | "openaiproxy" | "proxy" => {
            argv.push(resolve_opencode_binary());
            if let Some(model) = model {
                argv.push("--model".to_string());
                argv.push(format_opencode_model(Some(model), None));
            }
            prompt_flag = Some("--prompt");
        }
        // claude, and any id we do not know: Claude is the default provider.
        _ => {
            argv.push("claude".to_string());
            if let Some(model) = model {
                argv.push("--model".to_string());
                argv.push(normalize_claude_model(model));
            }
            argv.push("--dangerously-skip-permissions".to_string());
        }
    }

    argv.extend(config.extra_arguments.clone());

    if let Some(prompt) = config
        .initial_prompt
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        if let Some(flag) = prompt_flag {
            argv.push(flag.to_string());
        }
        argv.push(prompt.to_string());
    }

    // Not `default_environment`: `TERM=dumb` and `CI=true` are what tell a CLI it is being scraped,
    // and they stop it drawing the interface this session exists to show. The pty supplies its own
    // `TERM`.
    let mut environment = HashMap::new();
    environment.insert("BASH_DEFAULT_TIMEOUT_MS".to_string(), "300000".to_string());
    environment.insert("BASH_MAX_TIMEOUT_MS".to_string(), "600000".to_string());
    // The one thing this path *does* share with `default_environment`: an interactive agent shells
    // out to `tendril` exactly like a one-shot one, so it must resolve the same CLI. See
    // [`agent_path`].
    if let Some(path) = agent_path() {
        environment.insert("PATH".to_string(), path);
    }
    for (key, value) in &config.environment_variables {
        environment.insert(key.clone(), value.clone());
    }

    AgentPtySpec { argv, environment }
}

/// Enforces a project's [`AgentSecurityConfig`] onto a launch config before it reaches
/// [`build_agent_spec`]: the single place where the seven security keys turn into the
/// provider-agnostic fields (`sandbox_mode`, `network_access`, `permission_mode`, tool
/// allow/deny lists, writable directories) that each provider builder already knows how to
/// render. Called from the job launcher for every job, so a project with no security
/// configuration gets `AgentSecurityConfig::default()`'s permissive behavior rather than being
/// skipped.
pub fn apply_security_settings(config: &mut AgentLaunchConfig, security: &AgentSecurityConfig) {
    if security.effective_outside_file_access() != OutsideFileAccessPolicy::Deny {
        for rule in &security.file_permissions {
            if rule.mode_is_deny() {
                config.denied_tools.push(format!("Write({})", rule.path));
                config.denied_tools.push(format!("Edit({})", rule.path));
            } else {
                config.writable_directories.push(rule.path.clone());
            }
        }
    }

    for cmd in &security.allowed_terminal_commands {
        config.allowed_tools.push(format!("Bash({} *)", cmd));
    }

    config.permission_mode = Some(
        match security.effective_terminal_auto_execution() {
            TerminalAutoExecution::AlwaysAsk => "default",
            TerminalAutoExecution::AlwaysProceed | TerminalAutoExecution::InheritGeneral => {
                "FullAuto"
            }
        }
        .to_string(),
    );

    config.sandbox_mode = Some(
        match security.effective_sandbox_mode() {
            SandboxMode::Enabled => "Enabled",
            SandboxMode::Disabled | SandboxMode::InheritGeneral => "Disabled",
        }
        .to_string(),
    );

    config.network_access = Some(security.is_network_allowed());
}

// ---------------------------------------------------------------------------
// Antigravity (agy)
// ---------------------------------------------------------------------------

/// Antigravity's built-in tools enforce a stricter JSON schema and execution semantics than the
/// model expects:
/// - `find_by_name` treats `Pattern` as required even when searching by `Extensions`.
/// - `grep_search`'s `Includes` must be a JSON array rather than a comma-separated string.
/// - `run_command` defaults to moving commands into the background after a couple seconds unless
///   `WaitMsBeforeAsync: 10000` is passed.
/// - In non-interactive batch mode (`--print`), ending the turn while background tasks are active
///   causes `agy` to terminate them after 5 seconds and exit early. The model must be instructed
///   to pass `WaitMsBeforeAsync: 10000` and poll `manage_task` until completion instead of waiting passively.
///
/// Prepended to every prompt in [`build_antigravity_spec`] so the guidance survives regardless of
/// caller-supplied prompt files.
pub const ANTIGRAVITY_TOOL_SCHEMA_GUARDRAILS: &str = "Tool usage notes:\n\
- `find_by_name` requires a `Pattern` argument; always pass one (e.g. \"*.cs\").\n\
- `grep_search`'s `Includes` argument must be a JSON array of strings (e.g. [\"*.cs\"]), never a comma-separated string.\n\
- `run_command`: You MUST ALWAYS set `WaitMsBeforeAsync: 10000` on EVERY `run_command` invocation so commands run synchronously.\n\
- Non-interactive batch execution: You are running non-interactively via `--print` in a single continuous turn. There are NO subsequent turns and NO reactive wake-ups. If a command runs as a background task (or returns a task ID), or if you see a message asking you to wait and end your turn: NEVER end your turn or output text saying you are waiting! Doing so terminates the CLI and kills your tasks immediately. Instead, you MUST actively poll `manage_task` with `Action: \"status\"` and `TaskId` repeatedly until its `Status` is `DONE` (or `ERROR`) before taking any other action or concluding. Complete all implementation, tests, and verifications before ending.";

fn build_antigravity_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    let mut args = Vec::new();
    // `sandbox_mode: Some("Enabled")` is the only value that turns sandboxing on; `None` (no caller
    // opinion) and `Some("Disabled")` both keep today's unsandboxed default.
    if config.sandbox_mode.as_deref() != Some("Enabled") {
        args.push("--dangerously-skip-permissions".to_string());
    }
    args.push("--output-format".to_string());
    args.push("stream-json".to_string());

    if let Some(timeout) = config.timeout_seconds {
        if timeout > 0 {
            args.push("--print-timeout".to_string());
            args.push(format!("{}s", timeout));
        }
    }

    if let Some(m) = &config.model {
        if !m.is_empty() {
            args.push("--model".to_string());
            args.push(m.clone());

            let eff = match config
                .effort
                .as_deref()
                .unwrap_or("medium")
                .to_ascii_lowercase()
                .as_str()
            {
                "low" => "low",
                "high" | "xhigh" | "max" => "high",
                _ => "medium",
            };
            args.push("--effort".to_string());
            args.push(eff.to_string());
        }
    }

    for dir in &config.writable_directories {
        args.push("--add-dir".to_string());
        args.push(dir.clone());
    }

    let mut temp_files = Vec::new();

    if let Some(mcp_file) = write_mcp_config(&config.mcp_servers) {
        args.push("--mcp-config".to_string());
        args.push(mcp_file.to_string_lossy().to_string());
        temp_files.push(mcp_file);
    }

    args.extend(config.extra_arguments.clone());

    let base_prompt = if let Some(sys) = &config.system_prompt {
        if !sys.is_empty() {
            format!("{}\n\n---\n\n{}", sys, config.prompt)
        } else {
            config.prompt.clone()
        }
    } else {
        config.prompt.clone()
    };
    let final_prompt = format!(
        "{}\n\n{}\n\n---\n\n{}",
        ANTIGRAVITY_TOOL_SCHEMA_GUARDRAILS, base_prompt, ANTIGRAVITY_TOOL_SCHEMA_GUARDRAILS
    );

    // Always write to a fresh temp file rather than trusting `config.prompt_file_path` as-is, so
    // the guardrails above are present even when the caller already supplied its own prompt file.
    args.push("--print".to_string());
    match write_temp_prompt(&final_prompt, "tendril-agy-prompt") {
        Some(temp_path) => {
            let normalized = temp_path.to_string_lossy().replace('\\', "/");
            args.push(format!("@{}", normalized));
            temp_files.push(temp_path);
        }
        // An `@<file>` that was never written is the one argument `--print` must not be handed: agy
        // does not fail on the missing path, it takes the whole `@/tmp/...md` as the literal prompt,
        // so the run opens by asking the model about a file name and the job's actual instructions
        // are gone. `--print` accepts the prompt inline too — `probe.rs`'s `antigravity_model`
        // launches that way — so the text goes on the command line instead, guardrails and all. The
        // file is preferred only because a long prompt strains argv, which makes this the fallback
        // rather than the default.
        None => args.push(final_prompt),
    }

    let mut env = default_environment();
    for (k, v) in &config.environment_variables {
        env.insert(k.clone(), v.clone());
    }

    AgentProcessSpec {
        command: "agy".to_string(),
        args,
        environment: env,
        working_directory: config.working_directory.clone(),
        stdin_content: None,
        redirect_stdin: false,
        temp_files,
    }
}

// ---------------------------------------------------------------------------
// Claude Code (claude)
// ---------------------------------------------------------------------------
fn build_claude_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    // A caller that supplies no allowlist (the chat app) wants an unrestricted trusted session, the
    // same thing the interactive agent gets. `dontAsk` plus a prefix allow list denies anything the
    // list does not name — including every compound `cd x && y` the agent naturally reaches for, and
    // every Bash command reaching outside the working directory — and `--print` has no prompt surface
    // to ask through, so the run dies rather than pausing. Ported from V1's `ClaudeCli`.
    let unrestricted = config.permission_mode.as_deref().unwrap_or("FullAuto") == "FullAuto"
        && config.allowed_tools.is_empty();

    let perm_mode = if unrestricted {
        "bypassPermissions"
    } else {
        match config.permission_mode.as_deref().unwrap_or("FullAuto") {
            "FullAuto" => "dontAsk",
            "AcceptEdits" => "acceptEdits",
            "Plan" => "plan",
            _ => "default",
        }
    };

    let mut args = vec![
        "--print".to_string(),
        "--verbose".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--permission-mode".to_string(),
        perm_mode.to_string(),
    ];

    let mut allowed_rules = Vec::new();

    if !config.allowed_tools.is_empty() {
        let mut active_tools = Vec::new();
        for tool in &config.allowed_tools {
            if tool.to_ascii_lowercase().starts_with("bash(") && tool.ends_with(')') {
                allowed_rules.push(tool.clone());
                if !active_tools.contains(&"Bash".to_string()) {
                    active_tools.push("Bash".to_string());
                }
            } else {
                let native = translate_claude_tool(tool);
                if native.eq_ignore_ascii_case("bash") {
                    allowed_rules.push("Bash(*)".to_string());
                } else {
                    allowed_rules.push(native.clone());
                }
                if !active_tools.contains(&native) {
                    active_tools.push(native);
                }
            }
        }

        if !active_tools.is_empty() {
            args.push("--tools".to_string());
            args.push(active_tools.join(","));
        }
    } else if perm_mode == "dontAsk" {
        // Tailor default safe/essential permissions needed to work with Tendril
        let default_rules = [
            "Read",
            "Write",
            "Edit",
            "Glob",
            "Grep",
            "WebFetch",
            "WebSearch",
            "Bash(tendril *)",
            "Bash(git *)",
            "Bash(gh *)",
            "Bash(dotnet *)",
            "Bash(pnpm *)",
            "Bash(npm *)",
            "Bash(yarn *)",
            "Bash(bun *)",
            "Bash(node *)",
            "Bash(ls *)",
            "Bash(find *)",
            "Bash(cat *)",
            "Bash(head *)",
            "Bash(tail *)",
            "Bash(grep *)",
            "Bash(mkdir *)",
            "Bash(rmdir *)",
            "Bash(rm *)",
            "Bash(cp *)",
            "Bash(mv *)",
            "Bash(touch *)",
            "Bash(chmod *)",
            "Bash(pwd)",
            "Bash(echo *)",
            "Bash(which *)",
            "Bash(npx *)",
            "Bash(vite *)",
            "Bash(tsc *)",
            "Bash(eslint *)",
            "Bash(prettier *)",
            "Bash(python *)",
            "Bash(python3 *)",
            "Bash(pip *)",
            "Bash(pip3 *)",
            "Bash(uv *)",
            "Bash(refitter *)",
            "Bash(svcutil *)",
            "Bash(ivy-inspector-*)",
            "Bash(dotnet-*)",
            "Bash(strawberryshake *)",
        ];
        for r in default_rules {
            allowed_rules.push(r.to_string());
        }
    }

    let mut denied_rules = translate_claude_rules(&config.denied_tools);
    // Claude has no dedicated network flag, so a denial is rendered as the closest equivalent tool
    // denial: no outbound fetch/search tools.
    if config.network_access == Some(false) {
        for rule in ["WebFetch", "WebSearch"] {
            if !denied_rules.iter().any(|r| r == rule) {
                denied_rules.push(rule.to_string());
            }
        }
    }

    let mut settings = serde_json::Map::new();
    if !allowed_rules.is_empty() || !denied_rules.is_empty() {
        let mut permissions = serde_json::Map::new();
        if !allowed_rules.is_empty() {
            permissions.insert("allow".to_string(), serde_json::json!(allowed_rules));
        }
        // Omitted entirely when empty, so a job with no denials emits the JSON it always did.
        if !denied_rules.is_empty() {
            permissions.insert("deny".to_string(), serde_json::json!(denied_rules));
        }
        settings.insert("permissions".to_string(), serde_json::json!(permissions));
    }
    if config.sandbox_mode.as_deref() == Some("Enabled") {
        settings.insert("sandbox".to_string(), serde_json::json!(true));
    }
    if !settings.is_empty() {
        args.push("--settings".to_string());
        args.push(serde_json::Value::Object(settings).to_string());
    }

    for dir in &config.writable_directories {
        args.push("--add-dir".to_string());
        args.push(dir.clone());
    }

    if let Some(m) = &config.model {
        if !m.is_empty() {
            args.push("--model".to_string());
            args.push(normalize_claude_model(m));
        }
    }

    if let Some(eff) = &config.effort {
        let eff_str = match eff.to_ascii_lowercase().as_str() {
            "low" => "low",
            "medium" => "medium",
            "high" => "high",
            "xhigh" => "xhigh",
            "max" => "max",
            _ => "medium",
        };
        args.push("--effort".to_string());
        args.push(eff_str.to_string());
    }

    if let Some(sid) = &config.session_id {
        if !sid.is_empty() {
            args.push("--session-id".to_string());
            args.push(sid.clone());
        }
    }

    if let Some(max_turns) = config.max_turns {
        args.push("--max-turns".to_string());
        args.push(max_turns.to_string());
    }

    let mut temp_files = Vec::new();

    // The prompt already goes down stdin, so a system prompt that could not be written to disk is
    // prepended to it rather than dropped — the same degradation `build_cursor_spec` and
    // `build_opencode_spec` make for CLIs that have no system-prompt flag to render at all. What
    // must not survive the failed write is `--system-prompt-file` itself: claude exits on a path it
    // cannot read instead of starting without the instructions, which turns a lost system prompt
    // into a lost job.
    let mut stdin_content = config.prompt.clone();

    if let Some(sys) = &config.system_prompt {
        if !sys.is_empty() {
            match write_temp_prompt(sys, "tendril-sysprompt") {
                Some(temp_sys) => {
                    args.push("--system-prompt-file".to_string());
                    args.push(temp_sys.to_string_lossy().to_string());
                    temp_files.push(temp_sys);
                }
                None => stdin_content = format!("{}\n\n---\n\n{}", sys, config.prompt),
            }
        }
    }

    if let Some(mcp_file) = write_mcp_config(&config.mcp_servers) {
        args.push("--mcp-config".to_string());
        args.push(mcp_file.to_string_lossy().to_string());
        temp_files.push(mcp_file);
    }

    for mcp in &config.mcp_servers {
        args.push("--mcp-server".to_string());
        args.push(mcp.name.clone());
    }

    args.extend(config.extra_arguments.clone());
    args.push("-".to_string());

    let mut env = default_environment();
    for (k, v) in &config.environment_variables {
        env.insert(k.clone(), v.clone());
    }

    AgentProcessSpec {
        command: "claude".to_string(),
        args,
        environment: env,
        working_directory: config.working_directory.clone(),
        stdin_content: Some(stdin_content),
        redirect_stdin: true,
        temp_files,
    }
}

// ---------------------------------------------------------------------------
// Codex (codex)
// ---------------------------------------------------------------------------
fn build_codex_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    // `Some("Disabled")` is the only value that turns sandboxing off; `None` (no caller opinion) and
    // `Some("Enabled")` both keep today's `workspace-write` default.
    let sandboxed = config.sandbox_mode.as_deref() != Some("Disabled");

    let mut args = vec!["exec".to_string(), "--sandbox".to_string()];
    if sandboxed {
        args.push("workspace-write".to_string());
        args.push("-c".to_string());
        args.push(format!(
            "sandbox_workspace_write.network_access={}",
            config.network_access.unwrap_or(true)
        ));
    } else {
        args.push("danger-full-access".to_string());
    }
    args.push("--json".to_string());
    args.push("--skip-git-repo-check".to_string());

    if let Some(m) = &config.model {
        if !m.is_empty() {
            args.push("--model".to_string());
            args.push(m.clone());
        }
    }

    if let Some(eff) = &config.effort {
        let eff_str = match eff.to_ascii_lowercase().as_str() {
            "low" => "low",
            "medium" => "medium",
            "high" => "high",
            "xhigh" | "max" => "xhigh",
            _ => "medium",
        };
        args.push("-c".to_string());
        args.push(format!("model_reasoning_effort=\"{}\"", eff_str));
    }

    // Codex has no tool allowlist, so a `Write(<dir>/**)` rule can only be honoured as a writable
    // directory. Explicit directories come first, then the extracted ones in allowlist order.
    for dir in merge_dirs(
        &config.writable_directories,
        &extract_write_edit_dirs(&config.allowed_tools),
    ) {
        args.push("--add-dir".to_string());
        args.push(dir);
    }

    let mut temp_files = Vec::new();
    if let Some(mcp_file) = write_mcp_config(&config.mcp_servers) {
        args.push("--mcp-config".to_string());
        args.push(mcp_file.to_string_lossy().to_string());
        temp_files.push(mcp_file);
    }

    args.extend(config.extra_arguments.clone());
    args.push("-".to_string());

    let mut env = default_environment();
    for (k, v) in &config.environment_variables {
        env.insert(k.clone(), v.clone());
    }

    AgentProcessSpec {
        command: "codex".to_string(),
        args,
        environment: env,
        working_directory: config.working_directory.clone(),
        stdin_content: Some(config.prompt.clone()),
        redirect_stdin: true,
        temp_files,
    }
}

// ---------------------------------------------------------------------------
// Gemini (gemini)
// ---------------------------------------------------------------------------
fn build_gemini_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    let perm_mode = match config.permission_mode.as_deref().unwrap_or("FullAuto") {
        "FullAuto" => "yolo",
        "AcceptEdits" => "auto_edit",
        "Plan" => "plan",
        _ => "default",
    };

    let mut args = vec![
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--skip-trust".to_string(),
        "--approval-mode".to_string(),
        perm_mode.to_string(),
    ];

    if config.sandbox_mode.as_deref() == Some("Enabled") {
        args.push("--sandbox".to_string());
    }

    args.push("--prompt".to_string());
    args.push(" ".to_string());

    if let Some(m) = &config.model {
        if !m.is_empty() && !m.eq_ignore_ascii_case("default") {
            args.push("--model".to_string());
            args.push(m.clone());
        }
    }

    // Gemini spells a directory rule `dir:<path>` in its allowlist; it has no tool flag to render one
    // into, so the only way to honour it is as an included directory.
    for dir in merge_dirs(
        &config.writable_directories,
        &extract_dir_prefixed(&config.allowed_tools),
    ) {
        args.push("--include-directories".to_string());
        args.push(dir);
    }

    let mut temp_files = Vec::new();
    if let Some(mcp_file) = write_mcp_config(&config.mcp_servers) {
        args.push("--mcp-config".to_string());
        args.push(mcp_file.to_string_lossy().to_string());
        temp_files.push(mcp_file);
    }

    args.extend(config.extra_arguments.clone());

    let mut env = default_environment();
    env.insert("GEMINI_CLI_TRUST_WORKSPACE".to_string(), "true".to_string());
    for (k, v) in &config.environment_variables {
        env.insert(k.clone(), v.clone());
    }

    AgentProcessSpec {
        command: "gemini".to_string(),
        args,
        environment: env,
        working_directory: config.working_directory.clone(),
        stdin_content: Some(config.prompt.clone()),
        redirect_stdin: true,
        temp_files,
    }
}

// ---------------------------------------------------------------------------
// OpenCode (opencode)
// ---------------------------------------------------------------------------
fn build_opencode_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    // `allowed_tools`, `denied_tools` and `writable_directories` are deliberately not rendered: the
    // OpenCode CLI (and the ivy / openaiproxy wrappers around it) has no tool-allowlist or
    // directory flag to render them into. The resolver still strips denied rules from the allowlist,
    // so a denial is not simply ignored here.
    let mut args = vec![
        "run".to_string(),
        "--auto".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ];

    if let Some(m) = &config.model {
        if !m.is_empty() {
            args.push("--model".to_string());
            args.push(format_opencode_model(Some(m), None));
        }
    }

    if let Some(eff) = &config.effort {
        let eff_str = match eff.to_ascii_lowercase().as_str() {
            "low" => "low",
            "medium" => "medium",
            "high" => "high",
            "xhigh" | "max" => "max",
            _ => "medium",
        };
        args.push("--variant".to_string());
        args.push(eff_str.to_string());
    }

    args.extend(config.extra_arguments.clone());

    let stdin_content = if let Some(sys) = &config.system_prompt {
        if !sys.is_empty() {
            format!("{}\n\n---\n\n{}", sys, config.prompt)
        } else {
            config.prompt.clone()
        }
    } else {
        config.prompt.clone()
    };

    let mut env = default_environment();
    // OpenCode has no `--mcp-config` flag - `opencode run --help` takes none, and passing one made
    // every launch with an MCP server fail on an unknown argument. Servers are declared in its
    // config, and `OPENCODE_CONFIG_CONTENT` is the way to supply one without writing to the user's
    // `opencode.json`.
    if let Some(content) = opencode_mcp_config_content(&config.mcp_servers) {
        env.insert("OPENCODE_CONFIG_CONTENT".to_string(), content);
    }
    for (k, v) in &config.environment_variables {
        env.insert(k.clone(), v.clone());
    }

    AgentProcessSpec {
        command: resolve_opencode_binary(),
        args,
        environment: env,
        working_directory: config.working_directory.clone(),
        stdin_content: Some(stdin_content),
        redirect_stdin: true,
        temp_files: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Copilot (copilot)
// ---------------------------------------------------------------------------
fn build_copilot_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    let (binary, prefix_args) = resolve_copilot_binary();

    let mut args = prefix_args;
    args.extend(vec![
        "--allow-all-paths".to_string(),
        "--allow-all-urls".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "-s".to_string(),
    ]);

    if !config.allowed_tools.is_empty() {
        let mut translated = Vec::new();
        for t in &config.allowed_tools {
            let nat = translate_copilot_tool(t);
            if !translated.contains(&nat) {
                translated.push(nat);
            }
        }
        args.push("--available-tools".to_string());
        args.push(translated.join(","));
        args.push("--allow-all-tools".to_string());
    }

    if let Some(m) = &config.model {
        if !m.is_empty() {
            args.push("--model".to_string());
            args.push(m.clone());
        }
    }

    if let Some(eff) = &config.effort {
        let eff_str = match eff.to_ascii_lowercase().as_str() {
            "low" => "low",
            "medium" => "medium",
            "high" => "high",
            "xhigh" | "max" => "xhigh",
            _ => "medium",
        };
        args.push("--effort".to_string());
        args.push(eff_str.to_string());
    }

    if let Some(sid) = &config.session_id {
        if !sid.is_empty() {
            args.push("--name".to_string());
            args.push(sid.clone());
        }
    }

    // Copilot's tool names are already translated above, so an `apply_patch` rule can carry a
    // directory the same way Codex's `Write`/`Edit` rules do.
    for dir in merge_dirs(
        &config.writable_directories,
        &extract_copilot_dirs(&config.allowed_tools),
    ) {
        args.push("--add-dir".to_string());
        args.push(dir);
    }

    let mut temp_files = Vec::new();
    if let Some(mcp_file) = write_mcp_config(&config.mcp_servers) {
        args.push("--mcp-config".to_string());
        args.push(mcp_file.to_string_lossy().to_string());
        temp_files.push(mcp_file);
    }

    args.extend(config.extra_arguments.clone());

    let mut env = default_environment();
    for (k, v) in &config.environment_variables {
        env.insert(k.clone(), v.clone());
    }

    AgentProcessSpec {
        command: binary,
        args,
        environment: env,
        working_directory: config.working_directory.clone(),
        stdin_content: Some(config.prompt.clone()),
        redirect_stdin: true,
        temp_files,
    }
}

// ---------------------------------------------------------------------------
// Cursor CLI (cursor-agent)
// ---------------------------------------------------------------------------

/// The effort rungs `cursor-agent` accepts for each base model, in the order its own `--list-models`
/// declares them. Empirically read off the CLI (`cursor-agent --model <bogus>` prints the whole
/// accepted list), not guessed: the ladder is a property of the *family*, and composing a rung a
/// family does not have is rejected outright — `claude-opus-5-max` and `gemini-3.8-flash-xhigh` are
/// both "Cannot use this model", while `claude-opus-5-high` and `gpt-5.5-extra-high` are fine.
///
/// A family listed here with rungs also accepts its **bare** id, which the server resolves to that
/// family's own default rung (`gpt-5.6-terra` launches as "GPT-5.6 Terra 272K Medium"). That is why
/// [`format_cursor_model`] can pass the bare id through for an unset effort rather than having to
/// pick a rung on the CLI's behalf.
///
/// The `-fast` variants of most of these ids exist too, and are deliberately not offered: `-fast` is
/// a separately-billed priority tier, and Tendril has no rate card for it.
const CURSOR_EFFORT_LADDERS: &[(&str, &[&str])] = &[
    // Anthropic — the two five-rung families and the three-rung Opus 5 / Opus 5.5.
    ("claude-opus-5-5", &["low", "medium", "high"]),
    (
        "claude-opus-5-5-thinking",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    ("claude-opus-5", &["low", "medium", "high"]),
    (
        "claude-opus-5-thinking",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    (
        "claude-opus-4-8",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    (
        "claude-opus-4-8-thinking",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    (
        "claude-opus-4-7",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    (
        "claude-opus-4-7-thinking",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    (
        "claude-sonnet-5",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    // Sonnet 5 Thinking is the one Anthropic row with a gap in the middle of its ladder: the CLI
    // lists `-thinking-low`, `-medium`, `-high`, `-xhigh` and `-max`, so it is declared whole.
    (
        "claude-sonnet-5-thinking",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    (
        "claude-fable-5-1",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    (
        "claude-fable-5-1-thinking",
        &["low", "medium", "high", "xhigh", "max"],
    ),
    // OpenAI — the Sol/Terra/Luna trio share one six-rung ladder that starts at `none`.
    (
        "gpt-5.6-sol",
        &["none", "low", "medium", "high", "xhigh", "max"],
    ),
    (
        "gpt-5.6-terra",
        &["none", "low", "medium", "high", "xhigh", "max"],
    ),
    (
        "gpt-5.6-luna",
        &["none", "low", "medium", "high", "xhigh", "max"],
    ),
    // 5.5 spells its top rung `extra-high` rather than `xhigh`; see `cursor_effort_rung`.
    ("gpt-5.5", &["none", "low", "medium", "high", "extra-high"]),
    ("gpt-5.4", &["low", "medium", "high", "xhigh"]),
    ("gpt-5.4-mini", &["none", "low", "medium", "high", "xhigh"]),
    ("gpt-5.3-codex", &["low", "high", "xhigh"]),
    ("gpt-5.2", &["low", "high", "xhigh"]),
    // Google.
    ("gemini-3.8-flash", &["low", "medium", "high"]),
    ("gemini-3.7-flash", &["low", "medium", "high"]),
    ("gemini-3.6-flash", &["minimal", "low", "medium", "high"]),
    // Moonshot.
    ("kimi-k3", &["low", "high", "max"]),
];

/// The rungs `cursor-agent` accepts for `base`, or `None` when the family takes no effort at all
/// (`gemini-3.1-pro` and `gpt-5-mini` are listed by the CLI as bare ids only).
fn cursor_efforts_for(base: &str) -> Option<&'static [&'static str]> {
    let wanted = base.trim().to_ascii_lowercase();
    let dashed = wanted.replace('.', "-");
    CURSOR_EFFORT_LADDERS
        .iter()
        .find(|(id, _)| *id == wanted || *id == dashed)
        .map(|(_, efforts)| *efforts)
}

/// Tendril's effort level rendered as the rung `base` actually spells, or `None` when that family
/// has no rung for it.
///
/// Two adjustments, both forced by the CLI rather than chosen:
/// - `gpt-5.5` spells its top rung `extra-high`, so Tendril's `xhigh` maps onto that.
/// - A family whose ladder stops short of the requested level gets the highest rung it *does* have,
///   the same lossy-downward mapping `build_copilot_spec` applies when it folds `max` onto `xhigh`.
///   Refusing instead would mean a picker offering `max` for a Claude model and a launch that dies.
fn cursor_effort_rung(base: &str, effort: &str) -> Option<&'static str> {
    let ladder = cursor_efforts_for(base)?;
    let wanted = effort.trim().to_ascii_lowercase();

    // `xhigh` and `extra-high` are the same rung under two spellings, so a request for either
    // matches whichever one this family declares.
    let aliases: &[&str] = match wanted.as_str() {
        "xhigh" | "extra-high" => &["xhigh", "extra-high"],
        _ => &[],
    };
    if let Some(found) = ladder
        .iter()
        .find(|rung| **rung == wanted || aliases.contains(rung))
    {
        return Some(found);
    }

    // Not offered by this family: fall to the nearest rung below, by the ladder's own order. The
    // levels are declared weakest-first, so the last rung is the strongest this family has.
    const ORDER: &[&str] = &[
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "extra-high",
        "max",
    ];
    let wanted_rank = ORDER.iter().position(|level| *level == wanted)?;
    ladder
        .iter()
        .rfind(|rung| {
            ORDER
                .iter()
                .position(|level| level == *rung)
                .is_some_and(|rank| rank <= wanted_rank)
        })
        .copied()
        // Every rung this family has is stronger than what was asked for — take its weakest.
        .or_else(|| ladder.first().copied())
}

/// The single id `cursor-agent --model` takes, composed from Tendril's separate (model, effort)
/// pair.
///
/// Cursor is the one provider with no `--effort` flag: the reasoning level is *baked into the model
/// id*, so `claude-opus-5` at high effort is the id `claude-opus-5-high`. The bracket override the
/// `--help` text advertises (`'claude-opus-4-8[context=1m,effort=high]'`) is not accepted by the
/// server, so composition is the only way to send an effort at all.
///
/// The rules, in order:
/// - No model, or `default`: the empty string, and the caller sends no `--model` — Cursor then picks
///   the account's own default, exactly as leaving the flag off does for every other provider.
/// - An id already carrying a rung (`gpt-5.2-high`), or one of the `-fast` priority ids, is passed
///   through untouched: the caller composed it themselves.
/// - Effort unset or `default`: the **bare** base id. Verified to launch for every family declared
///   in [`CURSOR_EFFORT_LADDERS`], including the ones whose `--list-models` output shows only
///   composed ids — `kimi-k3` resolves to "Kimi K3 Low" and `gpt-5.6-terra` to "Terra 272K Medium".
///   The server picks the family's own default rung, which is a better default than one Tendril
///   invents.
/// - Otherwise `<base>-<rung>`, where the rung is what that family spells this level (see
///   [`cursor_effort_rung`]), and a family with no ladder at all keeps its bare id.
pub fn format_cursor_model(model: Option<&str>, effort: Option<&str>) -> String {
    let base = model.unwrap_or("").trim();
    if base.is_empty() || base.eq_ignore_ascii_case("default") {
        return String::new();
    }

    let lower = base.to_ascii_lowercase();
    // An id the caller already composed. `-thinking` is part of a family name rather than a rung, so
    // it is not treated as one.
    let composed = lower.ends_with("-fast")
        || CURSOR_EFFORT_LADDERS.iter().any(|(family, rungs)| {
            rungs
                .iter()
                .any(|rung| lower == format!("{}-{}", family, rung))
        });
    if composed {
        return base.to_string();
    }

    let Some(effort) = effort
        .map(str::trim)
        .filter(|e| !e.is_empty() && !e.eq_ignore_ascii_case("default"))
    else {
        return base.to_string();
    };

    match cursor_effort_rung(&lower, effort) {
        Some(rung) => format!("{}-{}", base, rung),
        // A family with no effort ladder — the flag would be rejected, so the bare id stands.
        None => base.to_string(),
    }
}

/// Cursor's own tool names, which `--allowed-tools` and `--exclude-tools` validate strictly against
/// (an unknown name is a hard error listing all sixty-nine of them). Mirrors
/// [`translate_copilot_tool`]: a canonical Tendril tool maps onto Cursor's spelling, and anything
/// already spelled Cursor's way (`*_tool_call`) passes through.
pub fn translate_cursor_tool(canonical: &str) -> String {
    let lower = canonical.to_ascii_lowercase();
    // Already one of Cursor's own names.
    if lower.ends_with("_tool_call") {
        return lower;
    }
    // A rule carrying a directory (`Write(/plans/**)`) names the tool before the parenthesis.
    let bare = lower.split('(').next().unwrap_or(&lower).trim().to_string();
    match bare.as_str() {
        "read" => "read_tool_call".to_string(),
        "write" | "edit" => "edit_tool_call".to_string(),
        "bash" => "shell_tool_call".to_string(),
        "glob" => "glob_tool_call".to_string(),
        "grep" => "grep_tool_call".to_string(),
        "ls" | "list" => "ls_tool_call".to_string(),
        "webfetch" => "web_fetch_tool_call".to_string(),
        "websearch" => "web_search_tool_call".to_string(),
        "task" => "task_tool_call".to_string(),
        "todowrite" | "todoread" => "update_todos_tool_call".to_string(),
        other => format!("{}_tool_call", other.replace(['-', ' '], "_")),
    }
}

fn build_cursor_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    // `--trust` is not optional: without it the CLI stops to ask whether the workspace is trusted,
    // and a `--print` run that stops to ask never produces a line. `--force` is Cursor's spelling of
    // "run the tools you were given" — `--yolo` is documented as its alias.
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--trust".to_string(),
        "--force".to_string(),
    ];

    // Cursor has no `--effort` flag: the level is part of the model id. See `format_cursor_model`.
    let composed = format_cursor_model(config.model.as_deref(), config.effort.as_deref());
    if !composed.is_empty() {
        args.push("--model".to_string());
        args.push(composed);
    }

    if !config.allowed_tools.is_empty() {
        let mut translated: Vec<String> = Vec::new();
        for tool in &config.allowed_tools {
            let native = translate_cursor_tool(tool);
            if !translated.contains(&native) {
                translated.push(native);
            }
        }
        args.push("--allowed-tools".to_string());
        args.push(translated.join(","));
    }

    if !config.denied_tools.is_empty() {
        let mut translated: Vec<String> = Vec::new();
        for tool in &config.denied_tools {
            let native = translate_cursor_tool(tool);
            if !translated.contains(&native) {
                translated.push(native);
            }
        }
        args.push("--exclude-tools".to_string());
        args.push(translated.join(","));
    }

    // Cursor's `--add-dir` is Copilot's: a directory the agent may touch outside the workspace. So
    // a `Write(/plans/00553/Artifacts/**)` rule has to widen it here too, or the allowlist grants a
    // path the sandbox then refuses -- `extract_copilot_dirs` is the same extraction, not a
    // Copilot-specific one.
    for dir in merge_dirs(
        &config.writable_directories,
        &extract_copilot_dirs(&config.allowed_tools),
    ) {
        args.push("--add-dir".to_string());
        args.push(dir);
    }

    if let Some(sid) = &config.session_id {
        if !sid.is_empty() {
            args.push("--resume".to_string());
            args.push(sid.clone());
        }
    }

    // MCP servers are deliberately not rendered. Cursor loads them from a config *file* at a fixed
    // location and nowhere else: `~/.cursor/mcp.json` or `<workspace>/.cursor/mcp.json`. There is no
    // `--mcp-config` flag, `CURSOR_CONFIG_DIR` is not consulted for it (`cursor-agent mcp list` under
    // one still prints "expected in .cursor/mcp.json or ~/.cursor/mcp.json"), and `--plugin-dir`
    // carries plugins rather than servers. Writing the only file it *does* read means writing into
    // the user's own repository and clobbering whatever MCP configuration they already keep there,
    // which is a worse failure than not attaching a server. `build_opencode_spec` documents the same
    // kind of gap for tool allow-lists. `--approve-mcps` is likewise omitted: with no servers
    // attached it would only pre-approve whatever the user's own `.cursor/mcp.json` declares.

    args.extend(config.extra_arguments.clone());

    // No `--system-prompt`: the flag exists in the CLI's argument parser but the server rejects it
    // ("unknown option '--system-prompt'"), so the instructions are prepended to the prompt instead —
    // the same thing `build_opencode_spec` does for a CLI with no system-prompt argument.
    let stdin_content = match config.system_prompt.as_deref().filter(|s| !s.is_empty()) {
        Some(sys) => format!("{}\n\n---\n\n{}", sys, config.prompt),
        None => config.prompt.clone(),
    };

    let mut env = default_environment();
    for (k, v) in &config.environment_variables {
        env.insert(k.clone(), v.clone());
    }

    AgentProcessSpec {
        command: resolve_cursor_binary(),
        args,
        environment: env,
        working_directory: config.working_directory.clone(),
        stdin_content: Some(stdin_content),
        redirect_stdin: true,
        temp_files: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Ivy Agent (ivy)
// ---------------------------------------------------------------------------
fn build_ivy_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    let mut modified = config.clone();
    modified.model = Some(format_opencode_model(
        config.model.as_deref(),
        Some("https://llmproxy.ivy.app"),
    ));

    let mut spec = build_opencode_spec(&modified);
    spec.command = resolve_opencode_binary();

    spec.environment.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        "https://llmproxy.ivy.app".to_string(),
    );
    spec.environment.insert(
        "OPENAI_BASE_URL".to_string(),
        "https://llmproxy.ivy.app/v1".to_string(),
    );
    spec.environment.insert(
        "IVY_BASE_URL".to_string(),
        "https://llmproxy.ivy.app".to_string(),
    );

    if let Ok(key) = std::env::var("IVY_API_KEY")
        .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
        .or_else(|_| std::env::var("OPENAI_API_KEY"))
    {
        if !key.is_empty() {
            spec.environment
                .insert("IVY_API_KEY".to_string(), key.clone());
            spec.environment
                .insert("ANTHROPIC_API_KEY".to_string(), key.clone());
            spec.environment.insert("OPENAI_API_KEY".to_string(), key);
        }
    }

    spec
}

// ---------------------------------------------------------------------------
// OpenAI Proxy (openaiproxy)
// ---------------------------------------------------------------------------
fn build_openai_proxy_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    let base_url = std::env::var("OPENAI_BASE_URL")
        .or_else(|_| std::env::var("ANTHROPIC_BASE_URL"))
        .ok();

    let mut modified = config.clone();
    modified.model = Some(format_opencode_model(
        config.model.as_deref(),
        base_url.as_deref(),
    ));

    let mut spec = build_opencode_spec(&modified);
    spec.command = resolve_opencode_binary();

    if let Some(base) = &base_url {
        let trimmed = base.trim().trim_end_matches('/');
        let anthropic_base = if trimmed.to_ascii_lowercase().ends_with("/v1") {
            &trimmed[..trimmed.len() - 3]
        } else {
            trimmed
        };
        let openai_base = if trimmed.to_ascii_lowercase().ends_with("/v1") {
            trimmed.to_string()
        } else {
            format!("{}/v1", trimmed)
        };
        spec.environment
            .insert("ANTHROPIC_BASE_URL".to_string(), anthropic_base.to_string());
        spec.environment
            .insert("OPENAI_BASE_URL".to_string(), openai_base);
    }

    if let Ok(key) = std::env::var("OPENAI_API_KEY").or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
    {
        if !key.is_empty() {
            spec.environment
                .insert("OPENAI_API_KEY".to_string(), key.clone());
            spec.environment
                .insert("ANTHROPIC_API_KEY".to_string(), key);
        }
    }

    spec
}

// ---------------------------------------------------------------------------
// Apple Foundation Models (apple)
// ---------------------------------------------------------------------------

/// The OpenCode provider key the `fm serve` stanza is registered under.
const APPLE_PROVIDER_KEY: &str = "apple";

/// The OpenCode agent the trimmed tool surface is declared on, and the value passed to `--agent`.
/// Declaring it is not enough: without the flag OpenCode runs its default `build` agent and the
/// trimming never applies.
const APPLE_AGENT_NAME: &str = "apple-fm";

/// The only model `fm serve` serves. It answers `GET /v1/models` with the single id `system` and
/// rejects every other id with HTTP 400, so each model the catalog offers for this agent resolves
/// here rather than being passed through.
pub const APPLE_MODEL_ID: &str = "apple/system";

/// The same model as [`APPLE_MODEL_ID`], spelled the way `fm serve` itself spells it.
///
/// Two ids for one model, because two different things are addressing it. OpenCode names a model
/// `provider/model` and resolves the `apple/` half against the provider stanza below, so everything
/// that talks to OpenCode -- the catalog, the launch, the price row -- says `apple/system`. The
/// server behind it has no notion of providers and serves the bare id: `GET /v1/models` returns
/// `system`, and a request for `apple/system` comes back `HTTP 400 Unknown model 'apple/system'`.
/// Anything speaking to `fm serve` directly rather than through OpenCode -- the model probe in
/// [`crate::agents::probe`] -- has to use this one.
pub const APPLE_WIRE_MODEL_ID: &str = "system";

/// The system prompt the on-device agent runs under, replacing OpenCode's own.
///
/// Two separate measurements against a live `fm serve` motivate this, both taken with the prompt
/// "are you alive?".
///
/// The first is correctness. With OpenCode's default prompt the model answered
/// `[WebFetch] Retrieved from opencode.ai: I am a CLI tool for software engineering tasks.` -- a
/// tool transcript it invented. `webfetch` was already disabled and the emitted JSON contains no
/// tool part at all, so nothing was called: a 3B on-device model given a prompt that is mostly
/// tool-calling protocol imitates the protocol instead of answering. Turning more tools off does
/// not help, because the instructions are what it is copying. Replacing the prompt does: the same
/// question then answers "I am a foundation model running on-device, not alive."
///
/// The second is headroom. The default prompt costs 4,532 input tokens of an 8,192-token window
/// before the user's question is read. This prompt with the tool surface below costs ~310 in an
/// empty directory -- a fraction of that -- which is the difference between a window that fits a
/// conversation and one that does not.
///
/// The last two sentences answer a third measurement, of a chat that repeated itself. Asked to
/// "go through issues in ivy-tendril-v2", the model replied "I will now find these issues" and
/// stopped; told "I dont see any tool calls happen", it replied with the same sentence again. It
/// was not ignoring the history -- `build_chat_agent_prompt` replays it, and the replay was
/// verified in the failing turn -- it was answering honestly. It announces an intent it can never
/// carry out, because it emits no tool calls and the turn ends with its reply. So the prompt has
/// to rule out the announcement itself: there is no later turn in which the work happens. With
/// `skill` disabled but this text absent the model stopped looping and began inventing instead,
/// answering the same question with three plausible fabricated issues. Both sentences are needed:
/// one to stop it promising, one to give it something truthful to say in place of the promise.
const APPLE_SYSTEM_PROMPT: &str = "You are a helpful assistant running on-device via Apple \
Foundation Models. Answer the user directly and concisely in plain prose. You have no tools \
available: you cannot read files, run commands, search the repository, or browse the web. Never \
write a tool name, never write text in square brackets, and never describe an action you did not \
take. Never say you will do something and never ask the user for permission to proceed -- your \
reply is your entire turn, so there is no later in which to act. When a request needs information \
you were not given, say plainly in one sentence that you cannot access it and state what you \
would need pasted in.";

/// Where `fm serve` listens when started with no arguments.
const APPLE_DEFAULT_BASE_URL: &str = "http://127.0.0.1:1976/v1";

/// The on-device model's transcript ceiling. Measured against `fm serve` by bisection: 7.3k tokens
/// of input is accepted and roughly 8.5k is refused with "the session's transcript exceeded the
/// model's context size", so the declared window is the power of two just under the real limit.
const APPLE_CONTEXT_WINDOW: u64 = 8192;

/// The on-device model's output ceiling, declared conservatively against the same context budget.
const APPLE_MAX_OUTPUT_TOKENS: u64 = 1024;

/// `fm serve`'s OpenAI-compatible endpoint, with the `/v1` suffix normalized on.
///
/// `APPLE_FM_BASE_URL` overrides the default for an `fm serve --port` on another port, or one
/// reached over a tunnel.
pub(crate) fn apple_base_url() -> String {
    let raw = std::env::var("APPLE_FM_BASE_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| APPLE_DEFAULT_BASE_URL.to_string());

    let trimmed = raw.trim_end_matches('/');
    if trimmed.to_ascii_lowercase().ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{}/v1", trimmed)
    }
}

/// The OpenCode configuration registering `fm serve` as an OpenAI-compatible provider.
///
/// OpenCode has no built-in Apple provider, so one is declared inline rather than written to the
/// operator's `opencode.json`: `OPENCODE_CONFIG_CONTENT` is read as a whole config document, which
/// keeps this provider self-contained and leaves no temp file behind. That matters because
/// [`agent_command`] builds a throwaway spec purely to read the binary name, so spec building for a
/// default config must stay free of side effects.
///
/// The `apple-fm` agent trims the tool surface OpenCode would otherwise describe in its system
/// prompt. Measured against `fm serve`, the untrimmed prompt costs about 7k tokens of an 8k window,
/// leaving almost nothing for the task; dropping these six tools brings it to about 4.5k.
fn apple_opencode_config(base_url: &str) -> serde_json::Value {
    serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            APPLE_PROVIDER_KEY: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Apple Foundation Models",
                "options": { "baseURL": base_url, "apiKey": "local" },
                "models": {
                    APPLE_WIRE_MODEL_ID: {
                        "name": "Apple On-Device",
                        "limit": {
                            "context": APPLE_CONTEXT_WINDOW,
                            "output": APPLE_MAX_OUTPUT_TOKENS,
                        },
                    }
                },
            }
        },
        "agent": {
            APPLE_AGENT_NAME: {
                "description": "Apple Foundation Models on-device, with a trimmed tool surface",
                "mode": "primary",
                "model": APPLE_MODEL_ID,
                "prompt": APPLE_SYSTEM_PROMPT,
                // Every tool, off. The narrower six-tool list this started as left 2,740 input
                // tokens of the 8,192-token window spent on tool descriptions; with all of them off
                // it is ~310. The model cannot use them in any case -- it emits no tool calls -- so
                // every byte describing one is a byte the conversation does not get.
                //
                // `"*"` is what makes the list exhaustive, and the entries after it are regression
                // pins rather than the mechanism. Naming every builtin is not enough, because not
                // every tool is a builtin: OpenCode registers a tool per `SKILL.md` folder it
                // discovers under the working directory, and one per tool an attached MCP server
                // advertises, and neither set is known here. Both leaked past the explicit list.
                // Measured with the same prompt: this repo's six skills cost 1,305 input tokens in
                // the repo root against 507 in an empty directory, and asked to name its skills the
                // model listed all six -- which is what produced the chat loop the system prompt
                // above describes, since it saw a `tendrillable` tool, said it would use it, and
                // emitted no call. A probe MCP server advertising one tool cost another 47 on top.
                // `"*": false` covers all three kinds at once and holds as skills and servers are
                // added; `skill` and the builtins stay named so a regression in either is a test
                // failure here rather than a silent return of the loop.
                "tools": {
                    "*": false,
                    "skill": false,
                    "webfetch": false,
                    "task": false,
                    "todowrite": false,
                    "todoread": false,
                    "patch": false,
                    "multiedit": false,
                    "bash": false,
                    "edit": false,
                    "write": false,
                    "read": false,
                    "grep": false,
                    "glob": false,
                    "list": false,
                },
            }
        },
    })
}

/// Apple's on-device Foundation Models, reached through the bundled OpenCode CLI.
///
/// `fm serve` speaks OpenAI Chat Completions, so this is the same wrapper shape as
/// [`build_ivy_spec`] and [`build_openai_proxy_spec`]: pre-resolve the model, delegate to
/// [`build_opencode_spec`], then override the parts that are Apple-specific. It differs from those
/// two in three ways, each forced by what `fm serve` actually accepts:
///
/// - The model is pinned rather than mapped. `fm serve` serves exactly one id and rejects the rest
///   with HTTP 400, so honouring a caller's model would produce a request the server refuses.
/// - Effort is dropped. The on-device model has no reasoning-effort control, so a `--variant` would
///   advertise a knob that does not exist. The catalog lists no efforts for this agent to match.
/// - The provider is declared inline through `OPENCODE_CONFIG_CONTENT`, because OpenCode ships no
///   Apple provider to point a base URL at.
///
/// The server itself is not started here, for the same reason no other provider starts one: spec
/// building is synchronous, runs on paths that only want the binary name, and must not have side
/// effects. `fm serve` is an ambient prerequisite, reported by the `Apple` health check.
fn build_apple_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    let base_url = apple_base_url();

    let mut modified = config.clone();
    modified.model = Some(APPLE_MODEL_ID.to_string());
    modified.effort = None;

    let mut spec = build_opencode_spec(&modified);

    // Selects the trimmed agent declared in the config above. Measured against `fm serve`, the
    // default `build` agent spends about 6.9k of the 8k window describing its tools before the task
    // is even read; `apple-fm` brings that to about 4.5k. Appended rather than inserted so it lands
    // after `--model`, ahead of `extra_arguments`, where a caller could still override it.
    let model_end = spec
        .args
        .iter()
        .position(|a| a == "--model")
        .map(|i| i + 2)
        .unwrap_or(spec.args.len());
    spec.args.splice(
        model_end..model_end,
        ["--agent".to_string(), APPLE_AGENT_NAME.to_string()],
    );

    // Merged into the delegate's document rather than written over it. `build_opencode_spec` puts
    // the configured MCP servers in this same variable -- `opencode run` has no `--mcp-config`
    // flag, so that is the only channel they have -- and a blanket insert here would silently drop
    // every one of them, leaving the agent unable to call back into Tendril.
    let mut document = match spec.environment.get("OPENCODE_CONFIG_CONTENT") {
        Some(existing) => serde_json::from_str(existing).unwrap_or_else(|_| serde_json::json!({})),
        None => serde_json::json!({}),
    };
    if let (Some(target), Some(apple)) = (
        document.as_object_mut(),
        apple_opencode_config(&base_url).as_object(),
    ) {
        for (key, value) in apple {
            target.insert(key.clone(), value.clone());
        }
    }
    spec.environment
        .insert("OPENCODE_CONFIG_CONTENT".to_string(), document.to_string());
    spec.environment
        .insert("OPENAI_BASE_URL".to_string(), base_url);
    spec.environment
        .insert("OPENAI_API_KEY".to_string(), "local".to_string());

    spec
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
fn default_environment() -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert("CI".to_string(), "true".to_string());
    env.insert("TERM".to_string(), "dumb".to_string());
    if let Some(path) = agent_path() {
        env.insert("PATH".to_string(), path);
    }
    env
}

/// The `tendril` executable's file name on this platform.
const TENDRIL_CLI_BINARY: &str = if cfg!(windows) {
    "tendril.exe"
} else {
    "tendril"
};

/// The `PATH` an agent this daemon launches must run with: this build's own directory first, then
/// whatever the daemon inherited.
///
/// Agents drive Tendril by shelling out to `tendril` — the promptware↔CLI contract is hundreds of
/// invocations by bare name — so "which `tendril`" is decided by `PATH`, and inheriting the
/// developer's `PATH` means inheriting whatever they happen to have installed. A developer with the
/// V1 .NET CLI on `PATH` had every agent talk to *that*, and V1's discovery deletes a `.master` whose
/// heartbeat it cannot read: one agent command took the running dev daemon off the air for every
/// later CLI call and for the extension. The CLI that belongs to the running daemon is the only
/// correct answer, and `current_exe` is how the daemon knows where it is.
///
/// `None` leaves `PATH` inherited untouched, which is the honest outcome when there is no `tendril`
/// beside this executable to point at.
fn agent_path() -> Option<String> {
    agent_path_for(
        &std::env::current_exe().ok()?,
        std::env::var("PATH").ok().as_deref(),
    )
}

/// [`agent_path`] over its two inputs, so the resolution is testable without a process whose
/// `current_exe` happens to sit next to a `tendril`.
fn agent_path_for(exe: &Path, inherited: Option<&str>) -> Option<String> {
    let dir = own_cli_dir(exe)?;
    Some(path_with_dir_first(&dir, inherited))
}

/// The directory holding the `tendril` CLI that belongs to the build `exe` is part of.
///
/// Every layout Tendril ships keeps the two side by side, so no debug-only branch is needed:
/// a dev tree's `target/debug` holds `tendril`, `tendril-server` and `tendril-app`; an installed CLI
/// *is* the daemon, so its own directory holds it by definition; and Tauri copies the
/// `binaries/tendril` sidecar next to `tendril-app` in the packaged bundle's `Contents/MacOS`. `bin/`
/// is checked too, mirroring [`resolve_opencode_binary`].
///
/// `None` when no `tendril` is there — a `cargo run -p tendril-server` in a tree where the CLI was
/// never built, say. Prepending that directory would shadow nothing and hide the real state from
/// `tendril doctor`, so the caller leaves `PATH` alone instead.
fn own_cli_dir(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    if dir.join(TENDRIL_CLI_BINARY).is_file() {
        return Some(dir.to_path_buf());
    }
    let bin = dir.join("bin");
    if bin.join(TENDRIL_CLI_BINARY).is_file() {
        return Some(bin);
    }
    None
}

/// `inherited` with `dir` moved to the front, keeping the rest in order and dropping any later
/// duplicate of `dir` (an agent that re-exports `PATH` would otherwise accumulate copies).
fn path_with_dir_first(dir: &Path, inherited: Option<&str>) -> String {
    let dir_str = dir.to_string_lossy().to_string();
    let separator = if cfg!(windows) { ";" } else { ":" };

    let rest: Vec<String> = inherited
        .map(|path| {
            std::env::split_paths(path)
                .filter(|entry| entry != dir && !entry.as_os_str().is_empty())
                .map(|entry| entry.to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();

    if rest.is_empty() {
        return dir_str;
    }
    format!("{}{}{}", dir_str, separator, rest.join(separator))
}

fn normalize_claude_model(model: &str) -> String {
    let lower = model.to_ascii_lowercase();
    if lower == "default" {
        "claude-opus-5-5".to_string()
    } else {
        model.to_string()
    }
}

pub fn format_opencode_model(model: Option<&str>, base_url: Option<&str>) -> String {
    let m = model.unwrap_or("").trim();
    if m.is_empty() || m.eq_ignore_ascii_case("default") {
        if let Some(b) = base_url {
            if b.contains("llmproxy.ivy.app") {
                return "anthropic/claude-opus-5-5".to_string();
            }
            if b.contains("api.anthropic.com") {
                return "anthropic/claude-sonnet-5".to_string();
            }
            if b.contains("generativelanguage.googleapis.com")
                || b.contains("gemini")
                || b.contains("google")
            {
                return "openai/gemini-3.8-flash".to_string();
            }
            if b.contains("api.berget.ai") {
                return "moonshotai/Kimi-K3".to_string();
            }
        }
        return "openai/gpt-5.6-terra".to_string();
    }

    if m.contains('/') {
        return m.to_string();
    }

    let lower = m.to_ascii_lowercase();
    if lower.starts_with("claude-")
        || lower.starts_with("anthropic.")
        || lower == "haiku"
        || lower == "sonnet"
        || lower == "opus"
    {
        return format!("anthropic/{}", m);
    }

    if lower.starts_with("gpt-")
        || lower.starts_with("o1-")
        || lower.starts_with("o3-")
        || lower.starts_with("o4-")
        || lower.starts_with("codex")
        || lower.starts_with("chatgpt")
    {
        return format!("openai/{}", m);
    }

    if lower.starts_with("gemini-") || lower.starts_with("google.") {
        if let Some(b) = base_url {
            if b.contains("api.anthropic.com") {
                return format!("anthropic/{}", m);
            }
        }
        return format!("openai/{}", m);
    }

    if let Some(b) = base_url {
        if b.contains("api.anthropic.com") {
            return format!("anthropic/{}", m);
        }
    }

    format!("openai/{}", m)
}

/// Renders tool rules the way Claude's `--settings` permissions want them: a `Bash(...)` rule passes
/// through verbatim, a bare tool name is translated, and a bare `Bash` becomes `Bash(*)`.
pub fn translate_claude_rules(tools: &[String]) -> Vec<String> {
    let mut rules = Vec::new();
    for tool in tools {
        let rule = if tool.to_ascii_lowercase().starts_with("bash(") && tool.ends_with(')') {
            tool.clone()
        } else {
            let native = translate_claude_tool(tool);
            if native.eq_ignore_ascii_case("bash") {
                "Bash(*)".to_string()
            } else {
                native
            }
        };
        if !rules.contains(&rule) {
            rules.push(rule);
        }
    }
    rules
}

/// The directory in a `Write(<dir>)` or `Edit(<dir>)` rule, with any trailing `/*` or `/**` removed.
pub fn extract_write_edit_dirs(allowed_tools: &[String]) -> Vec<String> {
    allowed_tools
        .iter()
        .filter_map(|tool| {
            let (head, rest) = tool.split_once('(')?;
            if !head.eq_ignore_ascii_case("write") && !head.eq_ignore_ascii_case("edit") {
                return None;
            }
            let inner = rest.strip_suffix(')')?;
            trim_glob_suffix(inner)
        })
        .collect()
}

/// Gemini's `dir:<path>` allowlist entries.
pub fn extract_dir_prefixed(allowed_tools: &[String]) -> Vec<String> {
    allowed_tools
        .iter()
        .filter_map(|tool| {
            let prefix = tool.get(..4)?;
            if !prefix.eq_ignore_ascii_case("dir:") {
                return None;
            }
            trim_glob_suffix(&tool[4..])
        })
        .collect()
}

/// The same `Write(<dir>)` / `Edit(<dir>)` rules Codex reads, plus Copilot's own `apply_patch(<dir>)`
/// spelling — a rule may already have been written in translated form.
pub fn extract_copilot_dirs(allowed_tools: &[String]) -> Vec<String> {
    allowed_tools
        .iter()
        .filter_map(|tool| {
            let (head, rest) = tool.split_once('(')?;
            if !head.eq_ignore_ascii_case("write")
                && !head.eq_ignore_ascii_case("edit")
                && !head.eq_ignore_ascii_case("apply_patch")
            {
                return None;
            }
            trim_glob_suffix(rest.strip_suffix(')')?)
        })
        .collect()
}

fn trim_glob_suffix(path: &str) -> Option<String> {
    let trimmed = path
        .trim_end_matches("/**")
        .trim_end_matches("\\**")
        .trim_end_matches("/*")
        .trim_end_matches("\\*");
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Explicit writable directories first, then directories extracted from the allowlist in allowlist
/// order, de-duplicated case-insensitively. The order is fixed so the emitted argument vector is
/// deterministic and can be asserted on.
pub fn merge_dirs(explicit: &[String], extracted: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for dir in explicit.iter().chain(extracted.iter()) {
        if dir.is_empty() {
            continue;
        }
        if out.iter().any(|d| d.eq_ignore_ascii_case(dir)) {
            continue;
        }
        out.push(dir.clone());
    }
    out
}

pub fn translate_claude_tool(canonical: &str) -> String {
    match canonical.to_ascii_lowercase().as_str() {
        "read" => "Read".to_string(),
        "write" => "Write".to_string(),
        "edit" => "Edit".to_string(),
        "bash" => "Bash".to_string(),
        "glob" => "Glob".to_string(),
        "grep" => "Grep".to_string(),
        "webfetch" => "WebFetch".to_string(),
        "websearch" => "WebSearch".to_string(),
        _ => canonical.to_string(),
    }
}

pub fn translate_copilot_tool(canonical: &str) -> String {
    match canonical.to_ascii_lowercase().as_str() {
        "read" => "view".to_string(),
        "write" | "edit" => "apply_patch".to_string(),
        "bash" => {
            #[cfg(windows)]
            {
                "powershell".to_string()
            }
            #[cfg(not(windows))]
            {
                "bash".to_string()
            }
        }
        "glob" => "glob".to_string(),
        "grep" => "rg".to_string(),
        "webfetch" | "websearch" => "web_fetch".to_string(),
        _ => canonical.to_string(),
    }
}

/// The MCP servers as an OpenCode config document, for `OPENCODE_CONFIG_CONTENT`.
///
/// Not the `mcpServers` map [`write_mcp_config`] writes: OpenCode's key is `mcp`, each server is
/// tagged `"type": "local"`, and its `command` is one argv array rather than a command plus a
/// separate `args`. `environment`, not `env`. An entry is `"enabled": true` explicitly, because a
/// server Tendril was asked to attach should not depend on OpenCode's default.
///
/// `None` when there is nothing to declare, so the variable is left unset rather than set to an
/// empty document - OpenCode treats the variable's presence as "this is your config".
fn opencode_mcp_config_content(servers: &[McpServerConfig]) -> Option<String> {
    if servers.is_empty() {
        return None;
    }

    let mut map = serde_json::Map::new();
    for s in servers {
        if s.command.trim().is_empty() {
            continue;
        }
        let mut command = vec![serde_json::Value::String(s.command.clone())];
        command.extend(
            s.arguments
                .iter()
                .map(|a| serde_json::Value::String(a.clone())),
        );

        let mut entry = serde_json::Map::new();
        entry.insert(
            "type".to_string(),
            serde_json::Value::String("local".into()),
        );
        entry.insert("command".to_string(), serde_json::Value::Array(command));
        entry.insert("enabled".to_string(), serde_json::Value::Bool(true));
        if !s.environment.is_empty() {
            entry.insert("environment".to_string(), serde_json::json!(s.environment));
        }
        map.insert(s.name.clone(), serde_json::Value::Object(entry));
    }

    if map.is_empty() {
        return None;
    }

    serde_json::to_string(&serde_json::json!({ "mcp": map })).ok()
}

pub fn write_mcp_config(servers: &[McpServerConfig]) -> Option<PathBuf> {
    if servers.is_empty() {
        return None;
    }

    let mut map = serde_json::Map::new();
    for s in servers {
        if s.command.trim().is_empty() {
            continue;
        }
        let mut s_obj = serde_json::Map::new();
        s_obj.insert(
            "command".to_string(),
            serde_json::Value::String(s.command.clone()),
        );
        if !s.arguments.is_empty() {
            s_obj.insert("args".to_string(), serde_json::json!(s.arguments));
        }
        if !s.environment.is_empty() {
            s_obj.insert("env".to_string(), serde_json::json!(s.environment));
        }
        map.insert(s.name.clone(), serde_json::Value::Object(s_obj));
    }

    if map.is_empty() {
        return None;
    }

    let root = serde_json::json!({
        "mcpServers": map
    });

    let temp_dir = std::env::temp_dir();
    let filename = format!("tendril-mcp-{}.json", uuid::Uuid::new_v4().simple());
    let path = temp_dir.join(filename);
    // `None` rather than a path to a file that is not there. Every caller pushes the return value
    // straight onto `--mcp-config`, so swallowing the error handed the agent a flag pointing at
    // nothing — the agent then starts with no MCP servers, or refuses the argument outright, and
    // the only clue is the agent's own error. A temp dir that is missing or unwritable is the real
    // case: `std::env::temp_dir` reads `TMPDIR`, which the caller does not control.
    if let Err(e) = std::fs::write(
        &path,
        serde_json::to_string_pretty(&root).unwrap_or_default(),
    ) {
        tracing::warn!(
            "Could not write the MCP config to '{}': {e}. The agent will launch without its MCP \
             servers.",
            path.display()
        );
        return None;
    }
    Some(path)
}

/// `content` in a fresh temp file, or `None` when the write did not happen.
///
/// `Option` rather than `io::Result` for the same reason as [`write_mcp_config`]: the error is
/// worth reporting but not worth returning. Neither caller can act on the difference between one
/// `io::ErrorKind` and another — each already has a degradation that puts the text on the command
/// line or down stdin instead — and [`build_agent_spec`] returns a spec, not a result, so an
/// `io::Error` propagated out of here would only be unwrapped or discarded a frame later. Logging
/// at the point that still has the path and the errno is strictly more informative than that.
///
/// The write used to be `let _ = fs::write(..)`, which handed the caller a path to a file that was
/// never created. A missing or unwritable temp directory is the real shape of the failure:
/// `std::env::temp_dir` reads `TMPDIR`, which the caller does not control.
fn write_temp_prompt(content: &str, prefix: &str) -> Option<PathBuf> {
    let temp_dir = std::env::temp_dir();
    let filename = format!("{}-{}.md", prefix, uuid::Uuid::new_v4().simple());
    let path = temp_dir.join(filename);
    if let Err(e) = std::fs::write(&path, content) {
        tracing::warn!(
            "Could not write the prompt file '{}': {e}. The caller will pass the text inline \
             instead.",
            path.display()
        );
        return None;
    }
    Some(path)
}

fn find_on_path(binary: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for p in std::env::split_paths(&path_var) {
        let direct = p.join(binary);
        if direct.is_file() {
            return Some(direct);
        }

        #[cfg(windows)]
        {
            for ext in &[".exe", ".cmd", ".bat"] {
                let with_ext = p.join(format!("{}{}", binary, ext));
                if with_ext.is_file() {
                    return Some(with_ext);
                }
            }
        }
    }
    None
}

pub fn resolve_copilot_binary() -> (String, Vec<String>) {
    if find_on_path("copilot").is_some() {
        return ("copilot".to_string(), vec![]);
    }
    if find_on_path("gh").is_some() {
        return ("gh".to_string(), vec!["copilot".to_string()]);
    }
    ("copilot".to_string(), vec![])
}

/// The `opencode` executable's file name on this platform.
const OPENCODE_BINARY: &str = if cfg!(windows) {
    "opencode.exe"
} else {
    "opencode"
};

/// The OpenCode CLI to launch, preferring the one Tendril ships over anything on the developer's
/// `PATH`.
///
/// The bundled copy comes first for the same reason [`own_cli_dir`] exists: Tauri drops the
/// `binaries/opencode` sidecar next to `tendril-app` in the packaged bundle, so a user who installed
/// Tendril has a working agent without installing anything, and one who also has their own
/// `opencode` does not get a version skew between what Tendril tested against and what they happen
/// to have. `$HOME/.tendril/bin` is the path [`PlatformServiceConfig`] installs to, then `PATH`,
/// then OpenCode's own installer directory.
///
/// Falls back to the bare name so the failure is OpenCode's own "not found" rather than a path that
/// does not exist.
pub fn resolve_opencode_binary() -> String {
    if let Ok(curr_exe) = std::env::current_exe() {
        if let Some(parent) = curr_exe.parent() {
            let direct = parent.join(OPENCODE_BINARY);
            if direct.is_file() {
                return direct.to_string_lossy().to_string();
            }
            let bin = parent.join("bin").join(OPENCODE_BINARY);
            if bin.is_file() {
                return bin.to_string_lossy().to_string();
            }
        }
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let tendril_managed = Path::new(&home)
            .join(".tendril")
            .join("bin")
            .join(OPENCODE_BINARY);
        if tendril_managed.is_file() {
            return tendril_managed.to_string_lossy().to_string();
        }
    }

    if let Some(p) = find_on_path("opencode") {
        return p.to_string_lossy().to_string();
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let fallback = Path::new(&home).join(".opencode").join("bin");
        #[cfg(windows)]
        {
            for ext in &[".cmd", ".exe", ".bat"] {
                let candidate = fallback.join(format!("opencode{}", ext));
                if candidate.is_file() {
                    return candidate.to_string_lossy().to_string();
                }
            }
        }
        #[cfg(not(windows))]
        {
            let candidate = fallback.join(OPENCODE_BINARY);
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    "opencode".to_string()
}

/// The `cursor-agent` executable's file name on this platform.
const CURSOR_BINARY: &str = if cfg!(windows) {
    "cursor-agent.exe"
} else {
    "cursor-agent"
};

/// The Cursor CLI to launch. Same order as [`resolve_opencode_binary`] — a copy shipped beside the
/// app, then `$HOME/.tendril/bin`, then `PATH` — with Cursor's own installer directory
/// (`~/.local/bin`, where `install.cursor.com` puts the launcher) as the last place to look.
///
/// Falls back to the bare name so a missing install fails as `cursor-agent`'s own "not found" rather
/// than as a path that does not exist.
pub fn resolve_cursor_binary() -> String {
    if let Ok(curr_exe) = std::env::current_exe() {
        if let Some(parent) = curr_exe.parent() {
            let direct = parent.join(CURSOR_BINARY);
            if direct.is_file() {
                return direct.to_string_lossy().to_string();
            }
            let bin = parent.join("bin").join(CURSOR_BINARY);
            if bin.is_file() {
                return bin.to_string_lossy().to_string();
            }
        }
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let tendril_managed = Path::new(&home)
            .join(".tendril")
            .join("bin")
            .join(CURSOR_BINARY);
        if tendril_managed.is_file() {
            return tendril_managed.to_string_lossy().to_string();
        }
    }

    if let Some(p) = find_on_path("cursor-agent") {
        return p.to_string_lossy().to_string();
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let fallback = Path::new(&home).join(".local").join("bin");
        #[cfg(windows)]
        {
            for ext in &[".cmd", ".exe", ".bat"] {
                let candidate = fallback.join(format!("cursor-agent{}", ext));
                if candidate.is_file() {
                    return candidate.to_string_lossy().to_string();
                }
            }
        }
        #[cfg(not(windows))]
        {
            let candidate = fallback.join(CURSOR_BINARY);
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    "cursor-agent".to_string()
}

/// Tests for the `PATH` an agent is launched with. Inline rather than in `tests/` because the
/// resolution seam is deliberately private: nothing outside this module should be picking its own
/// `tendril`.
#[cfg(test)]
mod agent_path_tests {
    use super::{
        agent_path, agent_path_for, build_agent_pty_spec, AgentPtyConfig, TENDRIL_CLI_BINARY,
    };
    use std::path::{Path, PathBuf};

    /// A directory containing executable stubs with the given names.
    fn dir_with(prefix: &str, binaries: &[&str]) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("{}-{}", prefix, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in binaries {
            let path = dir.join(name);
            std::fs::write(&path, b"#!/bin/sh\nexit 0\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        dir
    }

    /// What a `PATH` lookup of `tendril` would find, i.e. what the agent's shell will run.
    fn resolve_on(path: &str, binary: &str) -> Option<PathBuf> {
        std::env::split_paths(path)
            .map(|entry| entry.join(binary))
            .find(|candidate| candidate.is_file())
    }

    #[test]
    fn the_daemons_own_directory_comes_before_the_inherited_path() {
        let dev = dir_with("tendril-path-dev", &[TENDRIL_CLI_BINARY, "tendril-server"]);
        let inherited = format!(
            "{}{}{}",
            Path::new("/usr/local/bin").display(),
            if cfg!(windows) { ";" } else { ":" },
            Path::new("/usr/bin").display()
        );

        let path = agent_path_for(&dev.join("tendril-server"), Some(&inherited))
            .expect("a tendril beside the daemon must produce a PATH");

        let first = std::env::split_paths(&path).next().unwrap();
        assert_eq!(first, dev, "the daemon's own directory must come first");
        assert!(
            path.ends_with(&inherited),
            "the inherited PATH must be kept, in order: {path}"
        );

        let _ = std::fs::remove_dir_all(&dev);
    }

    /// The incident this exists to prevent: a developer with the V1 CLI installed ahead of everything
    /// else on `PATH` had every agent resolve `tendril` to *that*, and V1's discovery deletes a
    /// `.master` whose heartbeat it cannot parse.
    #[test]
    fn an_agent_from_a_dev_build_resolves_tendril_to_the_workspace_binary() {
        let dev = dir_with(
            "tendril-path-workspace",
            &[TENDRIL_CLI_BINARY, "tendril-server"],
        );
        let installed = dir_with("tendril-path-installed", &[TENDRIL_CLI_BINARY]);
        let inherited = installed.to_string_lossy().to_string();

        // Without the fix, this is what the agent would have run.
        assert_eq!(
            resolve_on(&inherited, TENDRIL_CLI_BINARY).unwrap(),
            installed.join(TENDRIL_CLI_BINARY)
        );

        let path = agent_path_for(&dev.join("tendril-server"), Some(&inherited)).unwrap();
        assert_eq!(
            resolve_on(&path, TENDRIL_CLI_BINARY).unwrap(),
            dev.join(TENDRIL_CLI_BINARY),
            "the agent must resolve the CLI of the daemon that launched it"
        );

        let _ = std::fs::remove_dir_all(&dev);
        let _ = std::fs::remove_dir_all(&installed);
    }

    /// A packaged app puts the sidecar next to `tendril-app`; an installed CLI is itself the daemon.
    /// Both are the same co-location, and neither needs a debug-only branch.
    #[test]
    fn a_sidecar_and_an_installed_cli_both_resolve_beside_themselves() {
        let bundle = dir_with("tendril-path-bundle", &[TENDRIL_CLI_BINARY, "tendril-app"]);
        let sidecar_path = agent_path_for(&bundle.join("tendril-app"), Some("/usr/bin")).unwrap();
        assert_eq!(std::env::split_paths(&sidecar_path).next().unwrap(), bundle);

        let installed_path = agent_path_for(&bundle.join(TENDRIL_CLI_BINARY), None).unwrap();
        assert_eq!(
            std::env::split_paths(&installed_path).next().unwrap(),
            bundle
        );

        let _ = std::fs::remove_dir_all(&bundle);
    }

    /// A `bin/` subdirectory is the other layout an installer produces.
    #[test]
    fn a_cli_under_bin_is_found_too() {
        let root = dir_with("tendril-path-root", &["tendril-server"]);
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(TENDRIL_CLI_BINARY), b"#!/bin/sh\nexit 0\n").unwrap();

        let path = agent_path_for(&root.join("tendril-server"), None).unwrap();
        assert_eq!(std::env::split_paths(&path).next().unwrap(), bin);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// No `tendril` beside the daemon means there is nothing to point at, and inventing a `PATH`
    /// entry would only hide that from `tendril doctor`.
    #[test]
    fn no_cli_beside_the_daemon_leaves_path_alone() {
        let lonely = dir_with("tendril-path-lonely", &["tendril-server"]);
        assert!(agent_path_for(&lonely.join("tendril-server"), Some("/usr/bin")).is_none());
        let _ = std::fs::remove_dir_all(&lonely);
    }

    /// The directory is not repeated when it is already on the inherited `PATH`: an agent that
    /// re-exports `PATH` into a subprocess would otherwise accumulate copies of it.
    #[test]
    fn an_already_present_directory_is_not_duplicated() {
        let dev = dir_with("tendril-path-dedupe", &[TENDRIL_CLI_BINARY]);
        let inherited = format!(
            "/usr/bin{}{}",
            if cfg!(windows) { ";" } else { ":" },
            dev.display()
        );

        let path = agent_path_for(&dev.join(TENDRIL_CLI_BINARY), Some(&inherited)).unwrap();
        let occurrences = std::env::split_paths(&path)
            .filter(|entry| entry == &dev)
            .count();
        assert_eq!(
            occurrences, 1,
            "PATH should list the directory once: {path}"
        );

        let _ = std::fs::remove_dir_all(&dev);
    }

    /// The wiring, as opposed to the resolution: every launch path this daemon has must hand the agent
    /// the `PATH` [`agent_path`] computed, and none of them may quietly forget it. Stated as an
    /// equality against `agent_path()` so it holds wherever the test binary happens to live — the live
    /// end of this (a real daemon launching a real agent) is what proves the value itself.
    #[test]
    fn every_launch_path_carries_the_resolved_path() {
        let expected = agent_path();
        assert_eq!(super::default_environment().get("PATH"), expected.as_ref());

        for provider in [
            "claude",
            "codex",
            "gemini",
            "opencode",
            "copilot",
            "antigravity",
            "ivy",
        ] {
            let spec = super::build_agent_spec(provider, &super::AgentLaunchConfig::default());
            assert_eq!(
                spec.environment.get("PATH"),
                expected.as_ref(),
                "{provider} must launch with the daemon's own CLI first on PATH"
            );
            for file in spec.temp_files {
                let _ = std::fs::remove_file(file);
            }
        }

        let pty = build_agent_pty_spec("claude", &AgentPtyConfig::default());
        assert_eq!(pty.environment.get("PATH"), expected.as_ref());
    }

    /// An interactive session shells out to `tendril` just like a one-shot run, so it gets the same
    /// `PATH` — and a caller's own `PATH` still wins, because explicit configuration always overlays
    /// the defaults.
    #[test]
    fn a_caller_supplied_path_still_wins_for_a_pty_session() {
        let spec = build_agent_pty_spec(
            "claude",
            &AgentPtyConfig {
                environment_variables: std::collections::HashMap::from([(
                    "PATH".to_string(),
                    "/only/this".to_string(),
                )]),
                ..Default::default()
            },
        );
        assert_eq!(spec.environment.get("PATH").unwrap(), "/only/this");
    }
}

/// Tests for the one thing Cursor does that no other provider does: it has no effort argument, so
/// the reasoning rung has to be composed into the model id. Inline because `format_cursor_model` is
/// a translation between two vocabularies rather than a launch, and the ladders it reads are
/// private to this module.
#[cfg(test)]
mod cursor_model_tests {
    use super::{format_cursor_model, translate_cursor_tool};

    fn composed(model: &str, effort: &str) -> String {
        format_cursor_model(Some(model), Some(effort))
    }

    /// The rule, in the ordinary case: `<base>-<rung>`.
    #[test]
    fn an_effort_is_composed_onto_the_model_id() {
        assert_eq!(composed("claude-opus-5", "low"), "claude-opus-5-low");
        assert_eq!(composed("claude-opus-5", "medium"), "claude-opus-5-medium");
        assert_eq!(composed("gpt-5.6-terra", "max"), "gpt-5.6-terra-max");
        assert_eq!(
            composed("gemini-3.8-flash", "high"),
            "gemini-3.8-flash-high"
        );
        assert_eq!(composed("kimi-k3", "max"), "kimi-k3-max");
    }

    /// **The reason the ladders are per-family rather than per-agent.** Cursor rejects a rung its
    /// family does not have -- `claude-opus-5-max` is not a model -- so a level above the family's
    /// top has to come down to the top rather than be sent and fail.
    #[test]
    fn an_effort_above_a_familys_ladder_clamps_to_its_top() {
        // Plain Opus 5 stops at `high`; the Thinking variant is the one that goes to `max`.
        assert_eq!(composed("claude-opus-5", "xhigh"), "claude-opus-5-high");
        assert_eq!(composed("claude-opus-5", "max"), "claude-opus-5-high");
        assert_eq!(
            composed("claude-opus-5-thinking", "max"),
            "claude-opus-5-thinking-max"
        );
        // Gemini's flash rows stop at `high`, and Kimi has no `medium` at all, so `medium` takes
        // the rung below rather than inventing one.
        assert_eq!(
            composed("gemini-3.8-flash", "xhigh"),
            "gemini-3.8-flash-high"
        );
        assert_eq!(composed("kimi-k3", "medium"), "kimi-k3-low");
    }

    /// A rung two families spell differently is sent the way the family being launched spells it.
    #[test]
    fn a_familys_own_spelling_wins_over_tendrils() {
        // GPT-5.5 calls its fourth rung `extra-high`; every other GPT family calls it `xhigh`.
        assert_eq!(composed("gpt-5.5", "xhigh"), "gpt-5.5-extra-high");
        assert_eq!(composed("gpt-5.5", "max"), "gpt-5.5-extra-high");
        assert_eq!(composed("gpt-5.4", "xhigh"), "gpt-5.4-xhigh");
        // ...and a level below the family's floor takes the floor.
        assert_eq!(composed("gpt-5.3-codex", "medium"), "gpt-5.3-codex-low");
        assert_eq!(composed("claude-opus-5", "none"), "claude-opus-5-low");
    }

    /// No effort means no opinion, and the bare id is a model Cursor accepts -- it applies the
    /// family's own default rung. Tendril picking one for it would be inventing a preference.
    #[test]
    fn no_effort_sends_the_bare_model_id() {
        for effort in [None, Some(""), Some("default"), Some("Default")] {
            assert_eq!(
                format_cursor_model(Some("claude-opus-5"), effort),
                "claude-opus-5",
                "{effort:?} should leave the id bare"
            );
        }
        // A model with no ladder of its own is bare-only, at every level.
        assert_eq!(composed("gemini-3.1-pro", "high"), "gemini-3.1-pro");
        assert_eq!(composed("gpt-5-mini", "max"), "gpt-5-mini");
    }

    /// No model means no `--model` at all, which is Cursor's "use whatever is configured".
    #[test]
    fn no_model_composes_nothing() {
        for model in [None, Some(""), Some("  "), Some("default")] {
            assert_eq!(
                format_cursor_model(model, Some("high")),
                "",
                "{model:?} should send no model"
            );
        }
    }

    /// A user who types a composed id into the model box means it. Re-composing would produce
    /// `claude-opus-5-high-medium`, which is not a model.
    #[test]
    fn an_already_composed_id_passes_through() {
        assert_eq!(
            composed("claude-opus-5-thinking-max", "low"),
            "claude-opus-5-thinking-max"
        );
        assert_eq!(composed("gpt-5.5-extra-high", "low"), "gpt-5.5-extra-high");
        // `-fast` is Cursor's priority-routing suffix, and it is always last.
        assert_eq!(
            composed("gpt-5.6-terra-high-fast", "low"),
            "gpt-5.6-terra-high-fast"
        );
        assert_eq!(composed("composer-2.5-fast", "max"), "composer-2.5-fast");
    }

    /// The tool names `--allowed-tools` validates against are Cursor's own, not Tendril's.
    #[test]
    fn canonical_tool_names_become_cursors() {
        assert_eq!(translate_cursor_tool("read"), "read_tool_call");
        assert_eq!(translate_cursor_tool("write"), "edit_tool_call");
        assert_eq!(translate_cursor_tool("edit"), "edit_tool_call");
        assert_eq!(translate_cursor_tool("bash"), "shell_tool_call");
        // A scoped permission is a name with a qualifier, and the qualifier is not part of it.
        assert_eq!(translate_cursor_tool("Write(/tmp/**)"), "edit_tool_call");
        // Something already in Cursor's vocabulary is left alone.
        assert_eq!(translate_cursor_tool("mcp_tool_call"), "mcp_tool_call");
    }
}
