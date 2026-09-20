//! Resolves what a coding agent is actually launched with: model, effort, tool allowlist, denials,
//! extra arguments and environment.
//!
//! Everything here is driven by config (`codingAgents` / `promptwares`) with per-agent built-in
//! defaults underneath, so a Tendril with no agent configuration at all still gets a sensible model
//! and effort for `deep` / `balanced` / `quick`.

use crate::config::{AgentProfileConfig, PromptwareConfig, TendrilSettings};
use std::collections::HashMap;

/// Tools every promptware gets, whatever it is.
pub const BASE_TOOLS: [&str; 6] = ["Read", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"];

/// Promptwares that write files, and therefore need the write tools on top of [`BASE_TOOLS`].
const BUILT_IN_EXTRA_TOOLS: [(&str, [&str; 2]); 3] = [
    ("ExecutePlan", ["Write", "Edit"]),
    ("RetryPlan", ["Write", "Edit"]),
    ("IvyFrameworkVerification", ["Write", "Edit"]),
];

/// The reserved `promptwares` key whose settings apply to every promptware.
const DEFAULT_PROMPTWARE_KEY: &str = "_default";

/// What the agent is launched with, after config, profile and built-in defaults have all had a say.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AgentResolution {
    /// Normalized coding agent id (`claudecode` becomes `claude`).
    pub agent: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// The profile that actually applied — a configured profile's name, or the tier name when the
    /// built-in defaults supplied the model or effort. `None` when nothing shaped either.
    pub profile: Option<String>,
    pub allowed_tools: Vec<String>,
    pub denied_tools: Vec<String>,
    pub extra_arguments: Vec<String>,
    pub environment_variables: HashMap<String, String>,
}

/// Which knobs an agent's CLI actually has. Handing an agent an argument it does not support makes
/// it exit with "unknown option" rather than ignoring it, so this table is load-bearing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentCapabilities {
    pub model_selection: bool,
    pub effort_control: bool,
}

/// A built-in `(model, effort)` pair for one tier, used when config names no matching profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TierDefault {
    pub tier: &'static str,
    pub model: Option<&'static str>,
    pub effort: Option<&'static str>,
}

/// `claudecode` is the legacy spelling of the same agent; everything else is just lowercased.
pub fn normalize_agent_name(name: &str) -> String {
    let lower = name.trim().to_ascii_lowercase();
    match lower.as_str() {
        "claudecode" => "claude".to_string(),
        _ => lower,
    }
}

/// Gemini's CLI has no effort argument and Apple's on-device model has no reasoning-effort control;
/// every other agent takes one. Apple also serves exactly one model, so it selects none.
pub fn agent_capabilities(agent: &str) -> AgentCapabilities {
    let agent = normalize_agent_name(agent);
    AgentCapabilities {
        model_selection: agent != "apple",
        effort_control: agent != "gemini" && agent != "apple",
    }
}

/// The built-in `deep` / `balanced` / `quick` defaults for an agent, in that order.
pub fn default_profiles(agent: &str) -> [TierDefault; 3] {
    match normalize_agent_name(agent).as_str() {
        "codex" => tiers(
            (Some("gpt-5.6-sol"), Some("high")),
            (Some("gpt-5.6-terra"), Some("medium")),
            (Some("gpt-5.6-luna"), Some("low")),
        ),
        "gemini" => tiers(
            (Some("gemini-3.7-flash"), None),
            (Some("gemini-3.7-flash"), None),
            (Some("gemini-3.7-flash"), None),
        ),
        "opencode" => tiers(
            (Some("default"), Some("high")),
            (Some("default"), Some("medium")),
            (Some("default"), Some("low")),
        ),
        "copilot" => tiers(
            (None, Some("high")),
            (None, Some("medium")),
            (None, Some("low")),
        ),
        "antigravity" | "agy" => tiers(
            (Some("gemini-3.7-flash"), Some("medium")),
            (Some("gemini-3.7-flash"), Some("medium")),
            (Some("gemini-3.7-flash"), Some("medium")),
        ),
        "ivy" => ivy_tiers(),
        // `fm serve` serves one model and takes no effort argument, so every tier is the same run.
        "apple" => tiers((None, None), (None, None), (None, None)),
        "openaiproxy" | "proxy" => openai_proxy_tiers(proxy_base_url().as_deref()),
        // claude, and any id we do not know: Claude is the default provider.
        _ => tiers(
            (Some("opus"), Some("max")),
            (Some("sonnet"), Some("high")),
            (Some("haiku"), Some("low")),
        ),
    }
}

fn tiers(
    deep: (Option<&'static str>, Option<&'static str>),
    balanced: (Option<&'static str>, Option<&'static str>),
    quick: (Option<&'static str>, Option<&'static str>),
) -> [TierDefault; 3] {
    [
        TierDefault {
            tier: "deep",
            model: deep.0,
            effort: deep.1,
        },
        TierDefault {
            tier: "balanced",
            model: balanced.0,
            effort: balanced.1,
        },
        TierDefault {
            tier: "quick",
            model: quick.0,
            effort: quick.1,
        },
    ]
}

fn ivy_tiers() -> [TierDefault; 3] {
    tiers(
        (Some("claude-opus-5"), Some("max")),
        (Some("gemini-3.7-flash"), Some("medium")),
        (Some("gemini-3.7-flash"), Some("low")),
    )
}

/// `build_openai_proxy_spec` reads the base URL in this order, so the defaults must too — otherwise
/// the model we pick and the endpoint we send it to disagree.
fn proxy_base_url() -> Option<String> {
    std::env::var("OPENAI_BASE_URL")
        .or_else(|_| std::env::var("ANTHROPIC_BASE_URL"))
        .ok()
}

/// The proxy has no model line of its own — the defaults follow whatever it points at.
pub fn openai_proxy_tiers(base_url: Option<&str>) -> [TierDefault; 3] {
    let base = base_url.unwrap_or("");
    if base.contains("llmproxy.ivy.app") {
        return ivy_tiers();
    }
    if base.contains("api.anthropic.com") {
        return tiers(
            (Some("claude-opus-5"), Some("max")),
            (Some("claude-sonnet-5"), Some("high")),
            (Some("claude-haiku-4-5"), Some("low")),
        );
    }
    if base.contains("generativelanguage.googleapis.com")
        || base.contains("gemini")
        || base.contains("google")
    {
        return tiers(
            (Some("gemini-3.7-flash"), Some("high")),
            (Some("gemini-3.7-flash"), Some("medium")),
            (Some("gemini-3.7-flash"), Some("medium")),
        );
    }
    if base.contains("api.berget.ai") {
        return tiers(
            (Some("moonshotai/Kimi-K3"), Some("max")),
            (Some("moonshotai/Kimi-K3"), Some("high")),
            (Some("moonshotai/Kimi-K3"), Some("low")),
        );
    }
    tiers(
        (Some("gpt-5.6-sol"), Some("high")),
        (Some("gpt-5.6-terra"), Some("medium")),
        (Some("gpt-5.6-luna"), Some("low")),
    )
}

/// Resolves everything a launch needs for one promptware run.
///
/// `agent` is the coding agent id the caller already picked (including any per-job override);
/// `profile_override` is the plan's `executionProfile` or the CLI's `--profile`; `job_context`
/// supplies the `%PLAN_DIR%`-style tokens allowed in tool rules.
pub fn resolve_agent(
    settings: &TendrilSettings,
    agent: &str,
    promptware: &str,
    profile_override: Option<&str>,
    job_context: &HashMap<String, String>,
) -> AgentResolution {
    let agent_id = normalize_agent_name(agent);

    let (allowed_tools, denied_tools) = resolve_tools(settings, promptware, job_context);
    let (profile_name, mut extra_arguments, environment_variables) =
        resolve_agent_config(settings, &agent_id, promptware, profile_override);
    let (model, effort, profile) =
        apply_profile(settings, &agent_id, &profile_name, &mut extra_arguments);

    AgentResolution {
        agent: agent_id,
        model,
        effort,
        profile,
        allowed_tools,
        denied_tools,
        extra_arguments,
        environment_variables,
    }
}

/// The profile name, agent-level arguments and environment for an agent/promptware pair.
///
/// Profile name is last-writer-wins: `_default`, then the promptware's own entry, then the override.
fn resolve_agent_config(
    settings: &TendrilSettings,
    agent_id: &str,
    promptware: &str,
    profile_override: Option<&str>,
) -> (String, Vec<String>, HashMap<String, String>) {
    let mut profile_name = String::new();

    if let Some(cfg) = promptware_config(settings, DEFAULT_PROMPTWARE_KEY) {
        if !cfg.profile.is_empty() {
            profile_name = cfg.profile.clone();
        }
    }
    if !promptware.is_empty() {
        if let Some(cfg) = promptware_config(settings, promptware) {
            if !cfg.profile.is_empty() {
                profile_name = cfg.profile.clone();
            }
        }
    }
    if let Some(over) = profile_override {
        if !over.is_empty() {
            profile_name = over.to_string();
        }
    }

    let agent_config = find_agent_config(settings, agent_id);

    let mut extra_arguments = Vec::new();
    if let Some(cfg) = agent_config {
        extra_arguments.extend(split_args(&cfg.arguments));
    }

    let environment_variables = agent_config
        .map(|c| c.environment_variables.clone())
        .unwrap_or_default();

    (profile_name, extra_arguments, environment_variables)
}

/// Turns a profile name into a model and an effort, filling gaps from the built-in tier defaults.
///
/// Returns the profile that actually applied. Unlike legacy, a tier that supplied the model or effort
/// is reported by name: `job.execution_profile` is shown in the UI, and `deep` is the honest answer
/// when `deep` is what ran, even with no `codingAgents` section to match against.
fn apply_profile(
    settings: &TendrilSettings,
    agent_id: &str,
    profile_name: &str,
    extra_arguments: &mut Vec<String>,
) -> (Option<String>, Option<String>, Option<String>) {
    let agent_config = find_agent_config(settings, agent_id);

    if agent_config.is_none() && profile_name.is_empty() {
        return (None, None, None);
    }

    let mut profile: Option<&AgentProfileConfig> = None;
    if !profile_name.is_empty() {
        if let Some(cfg) = agent_config {
            profile = cfg
                .profiles
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case(profile_name));
        }
    }

    // A profile name the agent does not define must not silently disable model selection, so fall
    // back to something usable rather than nothing.
    if profile.is_none() {
        if let Some(cfg) = agent_config {
            profile = cfg
                .profiles
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case("balanced"))
                .or_else(|| {
                    cfg.profiles
                        .iter()
                        .find(|p| p.name.eq_ignore_ascii_case("default"))
                })
                .or_else(|| cfg.profiles.iter().find(|p| is_set(&p.model)));
        }
    }

    let caps = agent_capabilities(agent_id);
    let mut model: Option<String> = None;
    let mut effort: Option<String> = None;

    if let Some(p) = profile {
        if is_set(&p.model) && caps.model_selection {
            model = Some(p.model.clone());
        }
        if is_set(&p.effort) && caps.effort_control {
            effort = Some(p.effort.clone());
        }
        extra_arguments.extend(split_args(&p.arguments));
    }

    let target_profile = profile.map(|p| p.name.as_str()).unwrap_or(profile_name);
    let mut applied_tier: Option<&str> = None;
    if let Some(tier) = map_profile_tier(target_profile) {
        let defaults = default_profiles(agent_id);
        if let Some(d) = defaults.iter().find(|d| d.tier == tier) {
            if model.is_none() && caps.model_selection {
                if let Some(m) = d.model.filter(|m| is_set(m)) {
                    model = Some(m.to_string());
                    applied_tier = Some(d.tier);
                }
            }
            if effort.is_none() && caps.effort_control {
                if let Some(e) = d.effort.filter(|e| is_set(e)) {
                    effort = Some(e.to_string());
                    applied_tier = Some(d.tier);
                }
            }
        }
    }

    let applied_profile = profile
        .map(|p| p.name.clone())
        .or_else(|| applied_tier.map(|t| t.to_string()));

    (model, effort, applied_profile)
}

/// The merged allowlist and the denials taken out of it.
///
/// The allowlist is additive at every step — base tools, the promptware's built-in extras,
/// `_default` and then the promptware's own entry — because a per-promptware `allowedTools` is a
/// list of extra rules, not a replacement. Treating it as a replacement would strip `Read` and
/// `Bash` from every configured promptware and fail every job.
fn resolve_tools(
    settings: &TendrilSettings,
    promptware: &str,
    job_context: &HashMap<String, String>,
) -> (Vec<String>, Vec<String>) {
    let mut allowed: Vec<String> = BASE_TOOLS.iter().map(|t| t.to_string()).collect();

    if let Some((_, extras)) = BUILT_IN_EXTRA_TOOLS
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(promptware))
    {
        allowed.extend(extras.iter().map(|t| t.to_string()));
    }

    if let Some(cfg) = promptware_config(settings, DEFAULT_PROMPTWARE_KEY) {
        if !cfg.allowed_tools.is_empty() {
            allowed.extend(cfg.allowed_tools.iter().cloned());
        }
    }
    if !promptware.is_empty() {
        if let Some(cfg) = promptware_config(settings, promptware) {
            if !cfg.allowed_tools.is_empty() {
                allowed.extend(cfg.allowed_tools.iter().cloned());
            }
        }
    }

    let allowed = dedupe_ignore_case(
        allowed
            .into_iter()
            .map(|t| expand_tool_tokens(&t, job_context)),
    );

    // A denial is a safety statement, so a more specific entry unions with `_default` rather than
    // narrowing it.
    let mut denied: Vec<String> = Vec::new();
    if let Some(cfg) = promptware_config(settings, DEFAULT_PROMPTWARE_KEY) {
        denied.extend(cfg.denied_tools.iter().cloned());
    }
    if !promptware.is_empty() {
        if let Some(cfg) = promptware_config(settings, promptware) {
            denied.extend(cfg.denied_tools.iter().cloned());
        }
    }
    let denied = dedupe_ignore_case(
        denied
            .into_iter()
            .map(|t| expand_tool_tokens(&t, job_context)),
    );

    // Subtracting the denials from the allowlist is the only enforcement that works for agents whose
    // CLI has no deny flag, so it happens for all of them.
    let allowed = allowed
        .into_iter()
        .filter(|rule| !is_denied(rule, &denied))
        .collect();

    (allowed, denied)
}

/// Whether a denial covers a rule: an exact match, or a bare tool name covering every parameterised
/// rule of that tool (`Bash` denies `Bash(git *)`).
fn is_denied(rule: &str, denied: &[String]) -> bool {
    denied.iter().any(|d| {
        if d.eq_ignore_ascii_case(rule) {
            return true;
        }
        if d.contains('(') {
            return false;
        }
        rule.len() > d.len()
            && rule[..d.len()].eq_ignore_ascii_case(d)
            && rule[d.len()..].starts_with('(')
    })
}

/// Expands `%KEY%` job-context tokens (case-insensitively on the key), then OS environment
/// variables, then normalizes separators. A token with no value is left verbatim rather than
/// collapsing to an empty path, which would widen the rule instead of narrowing it.
fn expand_tool_tokens(tool: &str, job_context: &HashMap<String, String>) -> String {
    let mut out = tool.to_string();
    for (key, value) in job_context {
        out = replace_token_ignore_case(&out, key, value);
    }
    out = expand_os_variables(&out);
    out.replace('\\', "/")
}

/// Replaces every `%key%` occurrence, matching the key without regard to case.
fn replace_token_ignore_case(input: &str, key: &str, value: &str) -> String {
    let token = format!("%{}%", key);
    let lower_input = input.to_ascii_lowercase();
    let lower_token = token.to_ascii_lowercase();

    let mut out = String::with_capacity(input.len());
    let mut idx = 0;
    while let Some(found) = lower_input[idx..].find(&lower_token) {
        let start = idx + found;
        out.push_str(&input[idx..start]);
        out.push_str(value);
        idx = start + token.len();
    }
    out.push_str(&input[idx..]);
    out
}

/// `%VAR%` on Windows, `$VAR` / `${VAR}` on Unix — the forms each platform's shell writes.
fn expand_os_variables(input: &str) -> String {
    #[cfg(windows)]
    {
        expand_percent_variables(input)
    }
    #[cfg(not(windows))]
    {
        expand_dollar_variables(input)
    }
}

#[cfg(windows)]
fn expand_percent_variables(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(open) = rest.find('%') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find('%') {
            Some(close) if close > 0 => {
                let name = &after[..close];
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[close + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(not(windows))]
fn expand_dollar_variables(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'$' {
            let ch_len = input[i..].chars().next().map(char::len_utf8).unwrap_or(1);
            out.push_str(&input[i..i + ch_len]);
            i += ch_len;
            continue;
        }

        if input[i + 1..].starts_with('{') {
            if let Some(close) = input[i + 2..].find('}') {
                let name = &input[i + 2..i + 2 + close];
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => out.push_str(&input[i..i + 3 + close]),
                }
                i += 3 + close;
                continue;
            }
        }

        let name_len = input[i + 1..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .map(char::len_utf8)
            .sum::<usize>();
        if name_len == 0 {
            out.push('$');
            i += 1;
            continue;
        }
        let name = &input[i + 1..i + 1 + name_len];
        match std::env::var(name) {
            Ok(value) => out.push_str(&value),
            Err(_) => out.push_str(&input[i..i + 1 + name_len]),
        }
        i += 1 + name_len;
    }
    out
}

fn promptware_config<'a>(
    settings: &'a TendrilSettings,
    name: &str,
) -> Option<&'a PromptwareConfig> {
    settings.promptwares.get(name)
}

fn find_agent_config<'a>(
    settings: &'a TendrilSettings,
    agent_id: &str,
) -> Option<&'a crate::config::AgentConfig> {
    settings
        .coding_agents
        .iter()
        .find(|a| normalize_agent_name(&a.name) == agent_id)
}

fn map_profile_tier(profile_name: &str) -> Option<&'static str> {
    match profile_name.to_ascii_lowercase().as_str() {
        "deep" => Some("deep"),
        "balanced" => Some("balanced"),
        "quick" => Some("quick"),
        _ => None,
    }
}

/// `default` is how the config spells "leave it to the CLI", so it counts as unset everywhere.
fn is_set(value: &str) -> bool {
    !value.is_empty() && !value.eq_ignore_ascii_case("default")
}

fn split_args(args: &str) -> Vec<String> {
    args.split_whitespace().map(|s| s.to_string()).collect()
}

fn dedupe_ignore_case(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for item in items {
        let key = item.to_ascii_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        out.push(item);
    }
    out
}
