use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoRef {
    pub path: String,
    #[serde(
        rename = "baseBranch",
        alias = "base_branch",
        skip_serializing_if = "Option::is_none"
    )]
    pub base_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectVerificationRef {
    pub name: String,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewActionConfig {
    pub name: String,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub command: String,
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
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectPortConfig {
    #[serde(rename = "defaultPort", alias = "default_port", default)]
    pub default_port: u16,
    #[serde(default)]
    pub description: String,
}

/// An environment file to materialize into a plan's worktree. Git worktrees start without the
/// untracked `.env` files that exist in the original checkout, so services and migrations cannot
/// boot until the file is recreated from `template` plus `overrides`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
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
    #[serde(default)]
    pub skills: Vec<ProjectSkillRef>,
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
}

/// A skill every job of a project gets, declared under the project in `config.yaml`.
///
/// `path` is expanded against `TENDRIL_HOME` and may name a markdown file or a folder holding
/// `SKILL.md`; when it resolves, its contents replace `instructions`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
}

/// A project skill with its instructions already read off disk, ready to render into a firmware.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectSkillInfo {
    pub name: String,
    pub description: String,
    pub instructions: String,
}

impl ProjectConfig {
    pub fn repo_paths(&self) -> Vec<String> {
        self.repos.iter().map(|r| r.path.clone()).collect()
    }
}
