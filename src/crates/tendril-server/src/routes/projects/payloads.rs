//! The request bodies and query params the project routes accept.
//!
//! Several of these exist to be lenient about shapes the app and older clients actually send — a
//! verification as either a bare string or an object, a port as either a string or an int — so the
//! `From` conversions next to each type are the whole point of keeping them together.

use serde::{Deserialize, Serialize};
use tendril_core::models::{
    AgentSecurityConfig, ExtraKeys, FileAccessRuleConfig, NetworkAccessRuleConfig,
    OutsideFileAccessPolicy, ProjectMcpServerRef, ProjectSkillRef, ProjectVerificationRef,
    PromptwareHookConfig, RepoRef, ReviewActionConfig, SandboxMode, SecurityPreset,
    TerminalAutoExecution,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RepoInput {
    String(String),
    Object(RepoRef),
}

impl From<RepoInput> for RepoRef {
    fn from(input: RepoInput) -> Self {
        match input {
            RepoInput::String(path) => RepoRef {
                path,
                base_branch: None,
                extra: Default::default(),
            },
            RepoInput::Object(r) => r,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VerificationInput {
    String(String),
    Object(VerificationObjectInput),
}

/// A verification in a request body. `after` is a placement hint, not part of the stored
/// verification: it names the verification this one goes behind, and only the add endpoint reads
/// it — requests that supply the whole list already carry their own order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VerificationObjectInput {
    pub name: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    /// Unmodeled keys, carried onto the stored `ProjectVerificationRef`. A request that replaces the
    /// whole `verifications` list would otherwise drop any key this DTO does not name. `after` is
    /// modeled, so it stays a placement hint and never leaks into the persisted extras.
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

impl VerificationInput {
    pub fn after(&self) -> Option<&str> {
        match self {
            VerificationInput::String(_) => None,
            VerificationInput::Object(v) => v.after.as_deref(),
        }
    }
}

impl From<VerificationInput> for ProjectVerificationRef {
    fn from(input: VerificationInput) -> Self {
        match input {
            VerificationInput::String(name) => ProjectVerificationRef {
                name,
                required: true,
                extra: Default::default(),
            },
            VerificationInput::Object(v) => ProjectVerificationRef {
                name: v.name,
                required: v.required,
                extra: v.extra,
            },
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(default = "default_project_color")]
    pub color: String,
    #[serde(default)]
    pub repos: Vec<RepoInput>,
    #[serde(default)]
    pub verifications: Vec<VerificationInput>,
    #[serde(default)]
    pub context: String,
    #[serde(rename = "stackHash", alias = "stack_hash")]
    pub stack_hash: Option<String>,
    #[serde(rename = "reviewActions", alias = "review_actions", default)]
    pub review_actions: Vec<ReviewActionConfig>,
    #[serde(default)]
    pub hooks: Vec<PromptwareHookConfig>,
    #[serde(rename = "buildDependencies", alias = "build_dependencies", default)]
    pub build_dependencies: Vec<String>,
    #[serde(rename = "mcpServers", alias = "mcp_servers", default)]
    pub mcp_servers: Vec<ProjectMcpServerRef>,
    #[serde(default)]
    pub skills: Vec<ProjectSkillRef>,
    /// The seven agent security controls. Flattened rather than nested, matching
    /// `ProjectConfig::security`'s own shape — a create payload sends `sandboxMode`,
    /// `securityPreset`, etc. as top-level keys, not under a `security` object.
    #[serde(flatten)]
    pub security: AgentSecurityConfig,
    /// Project keys this DTO does not name, persisted onto the new `ProjectConfig`.
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

fn default_project_color() -> String {
    "Blue".to_string()
}

/// A partial update to a project's [`AgentSecurityConfig`]: every field is `Option`, and only the
/// ones a request body actually names get applied — see
/// [`update_project`](super::crud::update_project). Flattened directly onto
/// [`UpdateProjectRequest`], the same shape as [`CreateProjectRequest::security`].
#[derive(Debug, Deserialize, Default)]
pub struct AgentSecurityPatch {
    #[serde(rename = "sandboxMode", alias = "sandbox_mode", default)]
    pub sandbox_mode: Option<SandboxMode>,
    #[serde(rename = "securityPreset", alias = "security_preset", default)]
    pub security_preset: Option<SecurityPreset>,
    #[serde(
        rename = "outsideFileAccessPolicy",
        alias = "outside_file_access_policy",
        default
    )]
    pub outside_file_access_policy: Option<OutsideFileAccessPolicy>,
    #[serde(rename = "filePermissions", alias = "file_permissions", default)]
    pub file_permissions: Option<Vec<FileAccessRuleConfig>>,
    #[serde(rename = "networkAccessRules", alias = "network_access_rules", default)]
    pub network_access_rules: Option<Vec<NetworkAccessRuleConfig>>,
    #[serde(
        rename = "allowedTerminalCommands",
        alias = "allowed_terminal_commands",
        default
    )]
    pub allowed_terminal_commands: Option<Vec<String>>,
    #[serde(
        rename = "terminalAutoExecution",
        alias = "terminal_auto_execution",
        default
    )]
    pub terminal_auto_execution: Option<TerminalAutoExecution>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    #[serde(rename = "newName", alias = "new_name")]
    pub new_name: Option<String>,
    pub color: Option<String>,
    pub repos: Option<Vec<RepoInput>>,
    pub verifications: Option<Vec<VerificationInput>>,
    pub context: Option<String>,
    #[serde(default, rename = "stackHash", alias = "stack_hash")]
    pub stack_hash: Option<Option<String>>,
    #[serde(rename = "reviewActions", alias = "review_actions")]
    pub review_actions: Option<Vec<ReviewActionConfig>>,
    pub hooks: Option<Vec<PromptwareHookConfig>>,
    #[serde(rename = "buildDependencies", alias = "build_dependencies")]
    pub build_dependencies: Option<Vec<String>>,
    #[serde(rename = "mcpServers", alias = "mcp_servers")]
    pub mcp_servers: Option<Vec<ProjectMcpServerRef>>,
    pub skills: Option<Vec<ProjectSkillRef>>,
    #[serde(flatten)]
    pub security: AgentSecurityPatch,
    /// Project keys this DTO does not name. These are **merged** key-by-key into the stored
    /// project's `extra` rather than replacing the map — that is what makes a partial PUT safe: a
    /// payload naming one key must not clear the others. Keys this DTO does name (`name`, `newName`,
    /// `color`, `repos`, the security fields, …) never land here.
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum StringOrInt {
    String(String),
    Int(i64),
}

impl StringOrInt {
    pub fn to_string_val(&self) -> String {
        match self {
            StringOrInt::String(s) => s.clone(),
            StringOrInt::Int(i) => i.to_string(),
        }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct ExecuteReviewActionParams {
    #[serde(alias = "planId", alias = "plan")]
    pub plan_id: Option<StringOrInt>,
    #[serde(alias = "worktreeDir", alias = "worktree_dir")]
    pub worktree: Option<String>,
}
