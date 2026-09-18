use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Strips whitespace, `_` and `-` and lowercases, so `"Inherit General"`, `"inherit_general"` and
/// `"InheritGeneral"` all normalize to the same token. Used to tolerantly parse the agent security
/// enums below, which the .NET V1 app writes with spaces between words.
fn normalize_enum_token(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Whether an agent process should run inside a sandbox. `InheritGeneral` resolves to `Disabled` —
/// see [`AgentSecurityConfig::effective_sandbox_mode`] — so a project that never set this key keeps
/// exactly the unsandboxed behavior it had before this type existed.
///
/// Deserialization is lenient by design, the same reasoning as [`PromptwareHookConfig::when`]: an
/// unrecognized or garbled value must not fail the whole `config.yaml` load, so it falls back to
/// `InheritGeneral` rather than erroring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum SandboxMode {
    #[default]
    InheritGeneral,
    Enabled,
    Disabled,
}

impl<'de> Deserialize<'de> for SandboxMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match normalize_enum_token(&raw).as_str() {
            "enabled" => SandboxMode::Enabled,
            "disabled" => SandboxMode::Disabled,
            _ => SandboxMode::InheritGeneral,
        })
    }
}

/// A named bundle of security settings that overrides the individually configured fields when set
/// to anything other than `Custom`. See [`AgentSecurityConfig`]'s `effective_*` methods for exactly
/// what each preset forces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum SecurityPreset {
    #[default]
    Custom,
    Permissive,
    Restricted,
    Strict,
}

impl<'de> Deserialize<'de> for SecurityPreset {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match normalize_enum_token(&raw).as_str() {
            "permissive" => SecurityPreset::Permissive,
            "restricted" => SecurityPreset::Restricted,
            "strict" => SecurityPreset::Strict,
            _ => SecurityPreset::Custom,
        })
    }
}

/// Whether an agent may touch files outside the plan's worktree/writable directories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum OutsideFileAccessPolicy {
    #[default]
    Allow,
    Ask,
    Deny,
}

impl<'de> Deserialize<'de> for OutsideFileAccessPolicy {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match normalize_enum_token(&raw).as_str() {
            "ask" => OutsideFileAccessPolicy::Ask,
            "deny" => OutsideFileAccessPolicy::Deny,
            _ => OutsideFileAccessPolicy::Allow,
        })
    }
}

/// Whether a headless agent may run a terminal command without confirmation. `InheritGeneral`
/// resolves to `AlwaysProceed` — a batch-mode agent has no user to ask, so `AlwaysAsk` is only ever
/// meaningful as an explicit, deliberate setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum TerminalAutoExecution {
    #[default]
    InheritGeneral,
    AlwaysProceed,
    AlwaysAsk,
}

impl<'de> Deserialize<'de> for TerminalAutoExecution {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match normalize_enum_token(&raw).as_str() {
            "alwaysproceed" => TerminalAutoExecution::AlwaysProceed,
            "alwaysask" => TerminalAutoExecution::AlwaysAsk,
            _ => TerminalAutoExecution::InheritGeneral,
        })
    }
}

fn default_allow_mode() -> String {
    "Allow".to_string()
}

/// A single file-path access rule. `mode` stays a `String` (semantically `Allow`/`Ask`/`Deny`)
/// rather than a typed enum, the same "leave a typo inert" reasoning as
/// [`PromptwareHookConfig::when`] — see [`FileAccessRuleConfig::mode_is_deny`] for the tolerant
/// comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileAccessRuleConfig {
    pub path: String,
    #[serde(default = "default_allow_mode")]
    pub mode: String,
}

impl FileAccessRuleConfig {
    pub fn mode_is_deny(&self) -> bool {
        normalize_enum_token(&self.mode) == "deny"
    }
}

/// A single outbound-network access rule, keyed by URL pattern.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NetworkAccessRuleConfig {
    #[serde(rename = "urlPattern", alias = "url_pattern")]
    pub url_pattern: String,
    #[serde(default = "default_allow_mode")]
    pub mode: String,
}

impl NetworkAccessRuleConfig {
    pub fn mode_is_deny(&self) -> bool {
        normalize_enum_token(&self.mode) == "deny"
    }
}

/// The seven agent security controls the .NET V1 app writes under each project in `config.yaml`
/// (`sandboxMode`, `securityPreset`, `outsideFileAccessPolicy`, `filePermissions`,
/// `networkAccessRules`, `allowedTerminalCommands`, `terminalAutoExecution`). Flattened directly
/// onto [`ProjectConfig`] so they serialize back to top-level project keys, not a nested object —
/// see the flatten note on `ProjectConfig::security`.
///
/// Every field defaults to the value that reproduces today's unenforced behavior when the key is
/// absent, so a project that predates this type keeps running exactly as it did before: no
/// sandboxing, no file/network restrictions, terminal commands proceed automatically.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct AgentSecurityConfig {
    #[serde(rename = "sandboxMode", alias = "sandbox_mode", default)]
    pub sandbox_mode: SandboxMode,
    #[serde(rename = "securityPreset", alias = "security_preset", default)]
    pub security_preset: SecurityPreset,
    #[serde(
        rename = "outsideFileAccessPolicy",
        alias = "outside_file_access_policy",
        default
    )]
    pub outside_file_access_policy: OutsideFileAccessPolicy,
    #[serde(rename = "filePermissions", alias = "file_permissions", default)]
    pub file_permissions: Vec<FileAccessRuleConfig>,
    #[serde(rename = "networkAccessRules", alias = "network_access_rules", default)]
    pub network_access_rules: Vec<NetworkAccessRuleConfig>,
    #[serde(
        rename = "allowedTerminalCommands",
        alias = "allowed_terminal_commands",
        default
    )]
    pub allowed_terminal_commands: Vec<String>,
    #[serde(
        rename = "terminalAutoExecution",
        alias = "terminal_auto_execution",
        default
    )]
    pub terminal_auto_execution: TerminalAutoExecution,
}

impl AgentSecurityConfig {
    /// `InheritGeneral` resolves to `Disabled` (no process sandboxing) — the "Permissive" resolution
    /// chosen for this project, see the `inherit-general-fallback` question in the plan that added
    /// this type. A `Permissive` preset forces the same; `Strict` and `Restricted` force `Enabled`.
    pub fn effective_sandbox_mode(&self) -> SandboxMode {
        match self.security_preset {
            SecurityPreset::Permissive => SandboxMode::Disabled,
            SecurityPreset::Strict | SecurityPreset::Restricted => SandboxMode::Enabled,
            SecurityPreset::Custom => match self.sandbox_mode {
                SandboxMode::InheritGeneral => SandboxMode::Disabled,
                explicit => explicit,
            },
        }
    }

    /// `InheritGeneral` resolves to `AlwaysProceed`: a headless batch agent has no user to ask, so
    /// there is no meaningful "inherited" behavior other than proceeding. Independent of preset —
    /// `SecurityPreset` only governs sandboxing and file/network access, not terminal confirmation.
    pub fn effective_terminal_auto_execution(&self) -> TerminalAutoExecution {
        match self.terminal_auto_execution {
            TerminalAutoExecution::InheritGeneral => TerminalAutoExecution::AlwaysProceed,
            explicit => explicit,
        }
    }

    /// Preset overrides win over the explicit field, same precedence as `effective_sandbox_mode`.
    pub fn effective_outside_file_access(&self) -> OutsideFileAccessPolicy {
        match self.security_preset {
            SecurityPreset::Permissive => OutsideFileAccessPolicy::Allow,
            SecurityPreset::Strict => OutsideFileAccessPolicy::Deny,
            SecurityPreset::Restricted => OutsideFileAccessPolicy::Ask,
            SecurityPreset::Custom => self.outside_file_access_policy,
        }
    }

    /// `false` if the preset is `Strict`, or if any configured rule denies network access — there is
    /// no URL to check against here, so a single deny rule is treated as denying network access
    /// outright rather than being scoped to its own pattern.
    pub fn is_network_allowed(&self) -> bool {
        if self.security_preset == SecurityPreset::Strict {
            return false;
        }
        !self
            .network_access_rules
            .iter()
            .any(|rule| rule.mode_is_deny())
    }
}

/// Keys a `config.yaml` object under `projects:` carries that the corresponding struct does not
/// model, kept verbatim so a project mutation cannot drop them.
///
/// `config.yaml` is shared with the .NET V1 app, which writes an agent security block
/// (`sandboxMode`, `securityPreset`, `outsideFileAccessPolicy`, `filePermissions`,
/// `networkAccessRules`, `allowedTerminalCommands`, `terminalAutoExecution`) plus
/// `autoImplementPlans` and `meta` under each project.
/// [`save_config`][crate::config::save_config] rewrites the whole file from the typed value, so
/// without a catch-all every `tendril project ...` verb and every `/api/projects` write silently
/// deleted that block.
///
/// Two things about the shape are deliberate and should not be "tidied":
///
/// - `serde_json::Value`, **not** `serde_yaml::Value` — this matches the four extras maps already
///   on [`TendrilSettings`][crate::config::TendrilSettings] and friends, and
///   [`update_config_raw`][crate::config::update_config_raw] already round-trips config through
///   `serde_json::Value`.
/// - **No `skip_serializing_if`.** A flattened empty map emits zero keys, so a `config.yaml` with
///   no extras round-trips byte-identically without it; `skip_serializing_if` on a flattened map is
///   a no-op, and none of the existing extras fields carry one.
///
/// Every type holding one of these drops its `Eq` derive (keeping `PartialEq`), because
/// `serde_json::Value` is not `Eq` — its `Number` may hold an `f64`.
pub type ExtraKeys = BTreeMap<String, serde_json::Value>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepoRef {
    pub path: String,
    #[serde(
        rename = "baseBranch",
        alias = "base_branch",
        skip_serializing_if = "Option::is_none"
    )]
    pub base_branch: Option<String>,
    /// Unmodeled keys — see [`ExtraKeys`].
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectVerificationRef {
    pub name: String,
    #[serde(default)]
    pub required: bool,
    /// Unmodeled keys — see [`ExtraKeys`].
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReviewActionConfig {
    pub name: String,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub command: String,
    /// Repo-relative path prefixes this action renders (e.g. `src/packages/components`). Empty
    /// (the default) means unscoped: the action behaves exactly as it did before this field
    /// existed and is only ever used as a fallback by [`ProjectConfig::rank_review_actions`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    /// Unmodeled keys — see [`ExtraKeys`].
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

/// A shell command a project runs around a promptware run.
///
/// `when` is `before` or `after` (compared case-insensitively; any other value never matches).
/// An empty `promptwares` list matches every promptware. An empty `condition` always holds.
///
/// `when` stays a `String` rather than an enum on purpose: a typo in `config.yaml` must leave the
/// hook inert, not fail the whole config load.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptwareHookConfig {
    pub name: String,
    #[serde(default = "default_hook_when")]
    pub when: String,
    #[serde(default)]
    pub promptwares: Vec<String>,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub action: String,
    /// Unmodeled keys — see [`ExtraKeys`].
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

fn default_hook_when() -> String {
    "before".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LevelConfig {
    pub name: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<String>,
}

/// A named service port. Each plan gets its own concrete port for it, so two plans under review at
/// the same time never collide on the static default.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProjectPortConfig {
    #[serde(rename = "defaultPort", alias = "default_port", default)]
    pub default_port: u16,
    #[serde(default)]
    pub description: String,
    /// Unmodeled keys — see [`ExtraKeys`].
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

/// An environment file to materialize into a plan's worktree. Git worktrees start without the
/// untracked `.env` files that exist in the original checkout, so services and migrations cannot
/// boot until the file is recreated from `template` plus `overrides`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProjectEnvFileConfig {
    /// Target path, relative to the worktree root (e.g. `apps/web/.env`).
    #[serde(default)]
    pub path: String,
    /// Optional source file, relative to the worktree root (e.g. `.env.example`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    /// Keys written on top of the template. Values support placeholder expansion.
    #[serde(default)]
    pub overrides: std::collections::BTreeMap<String, String>,
    /// Unmodeled keys — see [`ExtraKeys`].
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub repos: Vec<RepoRef>,
    #[serde(default)]
    pub verifications: Vec<ProjectVerificationRef>,
    #[serde(default)]
    pub context: String,
    #[serde(rename = "stackHash", skip_serializing_if = "Option::is_none")]
    pub stack_hash: Option<String>,
    #[serde(rename = "reviewActions", default)]
    pub review_actions: Vec<ReviewActionConfig>,
    /// Shell commands run before and after each of the project's promptware runs. `#[serde(default)]`
    /// is what makes a `config.yaml` with no `hooks:` key load, and what stops `save_config` from
    /// dropping the block it does not know about.
    #[serde(default)]
    pub hooks: Vec<PromptwareHookConfig>,
    #[serde(rename = "buildDependencies", default)]
    pub build_dependencies: Vec<String>,
    /// Named service ports, keyed by service name. A `BTreeMap` so iteration and printing are
    /// deterministic.
    #[serde(default)]
    pub ports: std::collections::BTreeMap<String, ProjectPortConfig>,
    #[serde(rename = "envFiles", default)]
    pub env_files: Vec<ProjectEnvFileConfig>,
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: Vec<ProjectMcpServerRef>,

    /// Whether planning agents may make wireframes for this project's plans. Turn it off for a
    /// project with no user interface: `tendril wireframe setup` then refuses inside its plans.
    ///
    /// `Option` rather than a `bool` with a serde default, so that absent means on *structurally* -
    /// for a config.yaml written before wireframes existed, and equally for `ProjectConfig::default()`,
    /// which `#[derive(Default)]` would otherwise give `false`. Read it through [`Self::wireframes`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wireframes: Option<bool>,

    /// Whether Tendril checks this project's plan changes for wireframe code before they reach
    /// Review, a PR or Completed. Off only for the repos that are the wireframe tooling itself,
    /// where wireframe code in the diff is the product rather than a leak. Read it through
    /// [`Self::wireframe_guard`].
    #[serde(
        rename = "wireframeGuard",
        alias = "wireframe_guard",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub wireframe_guard: Option<bool>,
    #[serde(default)]
    pub skills: Vec<ProjectSkillRef>,
    /// The seven agent security controls — flattened so they still serialize as top-level project
    /// keys (`sandboxMode`, `securityPreset`, ...) rather than a nested `security:` object, keeping
    /// `config.yaml`'s shape unchanged from before this field existed.
    #[serde(flatten)]
    pub security: AgentSecurityConfig,
    /// Unmodeled project-level keys — see [`ExtraKeys`]. This is the field that fixes the data loss:
    /// every one of the `save_config` call sites in `tendril-server` and `tendril-cli` mutates the
    /// loaded `ProjectConfig` in place, so capturing the keys on load is enough to carry them back
    /// out on save.
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

/// An MCP server every job of a project gets, declared under the project in `config.yaml`.
///
/// `command`, each `arguments` entry and each `environment` value are expanded against
/// `TENDRIL_HOME` when a job is launched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectMcpServerRef {
    pub name: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub environment: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub disabled: bool,
    /// Unmodeled keys — see [`ExtraKeys`].
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

/// A skill every job of a project gets, declared under the project in `config.yaml`.
///
/// `path` is expanded against `TENDRIL_HOME` and may name a markdown file or a folder holding
/// `SKILL.md`; when it resolves, its contents replace `instructions`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectSkillRef {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    /// Unmodeled keys — see [`ExtraKeys`].
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

/// A project skill with its instructions already read off disk, ready to render into a firmware.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectSkillInfo {
    pub name: String,
    pub description: String,
    pub instructions: String,
}

impl ProjectConfig {
    /// Whether planning agents may make wireframes for this project's plans. Absent means yes.
    pub fn wireframes(&self) -> bool {
        self.wireframes.unwrap_or(true)
    }

    /// Whether the wireframe leak guard runs for this project's plans. Absent means yes -- the
    /// safe direction, since the guard is what keeps throwaway plan material out of a repo.
    pub fn wireframe_guard(&self) -> bool {
        self.wireframe_guard.unwrap_or(true)
    }

    pub fn repo_paths(&self) -> Vec<String> {
        self.repos.iter().map(|r| r.path.clone()).collect()
    }

    /// Ranks `review_actions` against a plan's changed files, so the first action whose
    /// `condition` holds is one that actually exercises what the plan touched.
    ///
    /// Rules, in order:
    /// 1. Actions with non-empty `paths` where *every* changed file falls under one of the
    ///    prefixes, ranked by their longest matching prefix (most specific first, ties keep
    ///    configured order).
    /// 2. Everything else (unscoped, or scoped but not covering every changed file), in
    ///    configured order — this is the fallback and preserves today's behaviour.
    ///
    /// `changed_files` empty returns the configured order unchanged.
    pub fn rank_review_actions(&self, changed_files: &[String]) -> Vec<&ReviewActionConfig> {
        if changed_files.is_empty() {
            return self.review_actions.iter().collect();
        }

        let normalized_changed: Vec<String> = changed_files
            .iter()
            .map(|f| normalize_path_separators(f))
            .collect();

        let mut covering: Vec<(usize, usize, &ReviewActionConfig)> = Vec::new();
        let mut rest: Vec<&ReviewActionConfig> = Vec::new();

        for (idx, action) in self.review_actions.iter().enumerate() {
            match longest_covering_prefix_len(action, &normalized_changed) {
                Some(longest) => covering.push((longest, idx, action)),
                None => rest.push(action),
            }
        }

        // Longest prefix first; ties keep configured order.
        covering.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));

        covering
            .into_iter()
            .map(|(_, _, a)| a)
            .chain(rest)
            .collect()
    }
}

fn normalize_path_separators(path: &str) -> String {
    path.replace('\\', "/")
}

/// Strips a trailing `/`, `/*` or `/**` from a `paths` entry, after normalizing separators.
fn normalize_scope_prefix(prefix: &str) -> String {
    let normalized = normalize_path_separators(prefix);
    for suffix in ["/**", "/*", "/"] {
        if let Some(stripped) = normalized.strip_suffix(suffix) {
            return stripped.to_string();
        }
    }
    normalized
}

fn path_under_prefix(file: &str, prefix: &str) -> bool {
    file == prefix || file.starts_with(&format!("{}/", prefix))
}

/// `None` unless `action` covers every entry in `changed_files`; `Some(len)` with `len` the
/// longest single prefix (by character length) that matched, for ranking overlapping scopes.
fn longest_covering_prefix_len(
    action: &ReviewActionConfig,
    changed_files: &[String],
) -> Option<usize> {
    if action.paths.is_empty() {
        return None;
    }

    let prefixes: Vec<String> = action
        .paths
        .iter()
        .map(|p| normalize_scope_prefix(p))
        .collect();
    let mut longest = 0;

    for file in changed_files {
        let matched = prefixes
            .iter()
            .filter(|prefix| path_under_prefix(file, prefix))
            .map(|prefix| prefix.len())
            .max()?;
        longest = longest.max(matched);
    }

    Some(longest)
}

#[cfg(test)]
mod agent_security_tests {
    use super::*;

    #[test]
    fn parses_all_seven_keys_from_camel_case_config_yaml() {
        let yaml = r#"
name: demo
sandboxMode: Enabled
securityPreset: Restricted
outsideFileAccessPolicy: Ask
filePermissions:
  - path: /etc
    mode: Deny
networkAccessRules:
  - urlPattern: "https://internal.example.com/*"
    mode: Deny
allowedTerminalCommands:
  - git
  - cargo
terminalAutoExecution: AlwaysAsk
"#;
        let project: ProjectConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(project.security.sandbox_mode, SandboxMode::Enabled);
        assert_eq!(project.security.security_preset, SecurityPreset::Restricted);
        assert_eq!(
            project.security.outside_file_access_policy,
            OutsideFileAccessPolicy::Ask
        );
        assert_eq!(project.security.file_permissions.len(), 1);
        assert_eq!(project.security.file_permissions[0].path, "/etc");
        assert!(project.security.file_permissions[0].mode_is_deny());
        assert_eq!(project.security.network_access_rules.len(), 1);
        assert!(project.security.network_access_rules[0].mode_is_deny());
        assert_eq!(
            project.security.allowed_terminal_commands,
            vec!["git".to_string(), "cargo".to_string()]
        );
        assert_eq!(
            project.security.terminal_auto_execution,
            TerminalAutoExecution::AlwaysAsk
        );
        assert!(project.extra.is_empty());
    }

    #[test]
    fn normalizes_legacy_space_separated_values() {
        let yaml = r#"
name: demo
sandboxMode: "Inherit General"
terminalAutoExecution: "Always Proceed"
securityPreset: "inherit_general"
"#;
        let project: ProjectConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(project.security.sandbox_mode, SandboxMode::InheritGeneral);
        assert_eq!(
            project.security.terminal_auto_execution,
            TerminalAutoExecution::AlwaysProceed
        );
        // Unrecognized token falls back to the default variant rather than failing the load.
        assert_eq!(project.security.security_preset, SecurityPreset::Custom);
    }

    #[test]
    fn unrecognized_enum_value_falls_back_to_default_instead_of_erroring() {
        let yaml = r#"
name: demo
sandboxMode: "some-typo-value"
"#;
        let project: ProjectConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(project.security.sandbox_mode, SandboxMode::InheritGeneral);
    }

    #[test]
    fn serializes_security_fields_as_top_level_project_keys() {
        let mut project = ProjectConfig {
            name: "demo".to_string(),
            ..Default::default()
        };
        project.security.sandbox_mode = SandboxMode::Enabled;
        project.security.allowed_terminal_commands = vec!["git".to_string()];

        let value = serde_json::to_value(&project).unwrap();
        assert_eq!(value["sandboxMode"], "Enabled");
        assert_eq!(value["allowedTerminalCommands"][0], "git");
        assert!(value.get("security").is_none());
    }

    #[test]
    fn absent_security_keys_default_to_todays_unenforced_behavior() {
        let yaml = "name: demo\n";
        let project: ProjectConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            project.security.effective_sandbox_mode(),
            SandboxMode::Disabled
        );
        assert_eq!(
            project.security.effective_terminal_auto_execution(),
            TerminalAutoExecution::AlwaysProceed
        );
        assert_eq!(
            project.security.effective_outside_file_access(),
            OutsideFileAccessPolicy::Allow
        );
        assert!(project.security.is_network_allowed());
    }

    #[test]
    fn inherit_general_sandbox_mode_resolves_to_disabled() {
        let config = AgentSecurityConfig {
            sandbox_mode: SandboxMode::InheritGeneral,
            security_preset: SecurityPreset::Custom,
            ..Default::default()
        };
        assert_eq!(config.effective_sandbox_mode(), SandboxMode::Disabled);
    }

    #[test]
    fn permissive_preset_forces_sandbox_disabled_even_if_explicit_enabled() {
        let config = AgentSecurityConfig {
            sandbox_mode: SandboxMode::Enabled,
            security_preset: SecurityPreset::Permissive,
            ..Default::default()
        };
        assert_eq!(config.effective_sandbox_mode(), SandboxMode::Disabled);
    }

    #[test]
    fn strict_and_restricted_presets_force_sandbox_enabled() {
        for preset in [SecurityPreset::Strict, SecurityPreset::Restricted] {
            let config = AgentSecurityConfig {
                sandbox_mode: SandboxMode::Disabled,
                security_preset: preset,
                ..Default::default()
            };
            assert_eq!(config.effective_sandbox_mode(), SandboxMode::Enabled);
        }
    }

    #[test]
    fn custom_preset_respects_explicit_sandbox_mode() {
        let config = AgentSecurityConfig {
            sandbox_mode: SandboxMode::Enabled,
            security_preset: SecurityPreset::Custom,
            ..Default::default()
        };
        assert_eq!(config.effective_sandbox_mode(), SandboxMode::Enabled);
    }

    #[test]
    fn strict_preset_forces_outside_file_access_deny_and_network_denied() {
        let config = AgentSecurityConfig {
            outside_file_access_policy: OutsideFileAccessPolicy::Allow,
            security_preset: SecurityPreset::Strict,
            ..Default::default()
        };
        assert_eq!(
            config.effective_outside_file_access(),
            OutsideFileAccessPolicy::Deny
        );
        assert!(!config.is_network_allowed());
    }

    #[test]
    fn restricted_preset_forces_outside_file_access_ask() {
        let config = AgentSecurityConfig {
            outside_file_access_policy: OutsideFileAccessPolicy::Allow,
            security_preset: SecurityPreset::Restricted,
            ..Default::default()
        };
        assert_eq!(
            config.effective_outside_file_access(),
            OutsideFileAccessPolicy::Ask
        );
    }

    #[test]
    fn a_single_deny_network_rule_denies_network_access_outright() {
        let config = AgentSecurityConfig {
            network_access_rules: vec![NetworkAccessRuleConfig {
                url_pattern: "https://example.com/*".to_string(),
                mode: "Deny".to_string(),
            }],
            ..Default::default()
        };
        assert!(!config.is_network_allowed());
    }

    #[test]
    fn allow_only_network_rules_permit_network_access() {
        let config = AgentSecurityConfig {
            network_access_rules: vec![NetworkAccessRuleConfig {
                url_pattern: "https://example.com/*".to_string(),
                mode: "Allow".to_string(),
            }],
            ..Default::default()
        };
        assert!(config.is_network_allowed());
    }
}
