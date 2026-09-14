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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: Vec<ProjectMcpServerRef>,
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

impl ProjectConfig {
    pub fn repo_paths(&self) -> Vec<String> {
        self.repos.iter().map(|r| r.path.clone()).collect()
    }
}
