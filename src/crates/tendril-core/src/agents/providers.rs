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
        "ivy" => build_ivy_spec(config),
        "openaiproxy" | "proxy" => build_openai_proxy_spec(config),
        _ => build_claude_spec(config),
    }
}

/// The binary `provider` is launched as, derived from the same builders that launch it so the two
/// can never drift. Safe to call for its command alone: a default `AgentLaunchConfig` has no
/// system prompt and no MCP servers, so no temp files are written.
pub fn agent_command(provider: &str) -> String {
    build_agent_spec(provider, &AgentLaunchConfig::default()).command
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
        "opencode" | "ivy" | "openaiproxy" | "proxy" => {
            argv.push(if normalized == "opencode" {
                resolve_opencode_binary()
            } else {
                resolve_ivy_agent_binary()
            });
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

/// Antigravity's built-in tools enforce a stricter JSON schema than the model expects, so without
/// this notice it routinely fails common calls: `find_by_name` treats `Pattern` as required even
/// when searching by `Extensions`, and `grep_search`'s `Includes` must be a JSON array rather than
/// the comma-separated string a model naturally reaches for. Prepended to every prompt in
/// [`build_antigravity_spec`] so the guidance survives regardless of caller-supplied prompt files.
pub const ANTIGRAVITY_TOOL_SCHEMA_GUARDRAILS: &str = "Tool usage notes:\n\
- `find_by_name` requires a `Pattern` argument; always pass one (e.g. \"*.cs\").\n\
- `grep_search`'s `Includes` argument must be a JSON array of strings (e.g. [\"*.cs\"]), never a comma-separated string.";

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
    let final_prompt = format!("{}\n\n{}", ANTIGRAVITY_TOOL_SCHEMA_GUARDRAILS, base_prompt);

    // Always write to a fresh temp file rather than trusting `config.prompt_file_path` as-is, so
    // the guardrails above are present even when the caller already supplied its own prompt file.
    args.push("--print".to_string());
    let temp_path = write_temp_prompt(&final_prompt, "tendril-agy-prompt");
    let normalized = temp_path.to_string_lossy().replace('\\', "/");
    args.push(format!("@{}", normalized));
    temp_files.push(temp_path);

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

    if let Some(sys) = &config.system_prompt {
        if !sys.is_empty() {
            let temp_sys = write_temp_prompt(sys, "tendril-sysprompt");
            args.push("--system-prompt-file".to_string());
            args.push(temp_sys.to_string_lossy().to_string());
            temp_files.push(temp_sys);
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
        stdin_content: Some(config.prompt.clone()),
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

    let mut temp_files = Vec::new();
    if let Some(mcp_file) = write_mcp_config(&config.mcp_servers) {
        args.push("--mcp-config".to_string());
        args.push(mcp_file.to_string_lossy().to_string());
        temp_files.push(mcp_file);
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
        temp_files,
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
// Ivy Agent (ivy)
// ---------------------------------------------------------------------------
fn build_ivy_spec(config: &AgentLaunchConfig) -> AgentProcessSpec {
    let mut modified = config.clone();
    modified.model = Some(format_opencode_model(
        config.model.as_deref(),
        Some("https://llmproxy.ivy.app"),
    ));

    let mut spec = build_opencode_spec(&modified);
    spec.command = resolve_ivy_agent_binary();

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
    spec.command = resolve_ivy_agent_binary();

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
/// is checked too, mirroring [`resolve_ivy_agent_binary`].
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
    if lower == "default" || lower.contains("opus") {
        "opus".to_string()
    } else if lower.contains("sonnet") {
        "sonnet".to_string()
    } else if lower.contains("haiku") {
        "haiku".to_string()
    } else {
        model.to_string()
    }
}

pub fn format_opencode_model(model: Option<&str>, base_url: Option<&str>) -> String {
    let m = model.unwrap_or("").trim();
    if m.is_empty() || m.eq_ignore_ascii_case("default") {
        if let Some(b) = base_url {
            if b.contains("llmproxy.ivy.app") {
                return "anthropic/claude-opus-5".to_string();
            }
            if b.contains("api.anthropic.com") {
                return "anthropic/claude-sonnet-5".to_string();
            }
            if b.contains("generativelanguage.googleapis.com")
                || b.contains("gemini")
                || b.contains("google")
            {
                return "openai/gemini-3.7-flash".to_string();
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
    let _ = std::fs::write(
        &path,
        serde_json::to_string_pretty(&root).unwrap_or_default(),
    );
    Some(path)
}

fn write_temp_prompt(content: &str, prefix: &str) -> PathBuf {
    let temp_dir = std::env::temp_dir();
    let filename = format!("{}-{}.md", prefix, uuid::Uuid::new_v4().simple());
    let path = temp_dir.join(filename);
    let _ = std::fs::write(&path, content);
    path
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

fn resolve_copilot_binary() -> (String, Vec<String>) {
    if find_on_path("copilot").is_some() {
        return ("copilot".to_string(), vec![]);
    }
    if find_on_path("gh").is_some() {
        return ("gh".to_string(), vec!["copilot".to_string()]);
    }
    ("copilot".to_string(), vec![])
}

fn resolve_opencode_binary() -> String {
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
            let candidate = fallback.join("opencode");
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    "opencode".to_string()
}

fn resolve_ivy_agent_binary() -> String {
    let exe_name = if cfg!(windows) {
        "ivy-agent.exe"
    } else {
        "ivy-agent"
    };

    if let Ok(curr_exe) = std::env::current_exe() {
        if let Some(parent) = curr_exe.parent() {
            let direct = parent.join(exe_name);
            if direct.is_file() {
                return direct.to_string_lossy().to_string();
            }
            let bin = parent.join("bin").join(exe_name);
            if bin.is_file() {
                return bin.to_string_lossy().to_string();
            }
        }
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let tendril_managed = Path::new(&home).join(".tendril").join("bin").join(exe_name);
        if tendril_managed.is_file() {
            return tendril_managed.to_string_lossy().to_string();
        }
    }

    if let Some(p) = find_on_path("ivy-agent") {
        return p.to_string_lossy().to_string();
    }

    "ivy-agent".to_string()
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
