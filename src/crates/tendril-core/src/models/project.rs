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
    /// Repo-relative path prefixes this action renders (e.g. `src/packages/components`). Empty
    /// (the default) means unscoped: the action behaves exactly as it did before this field
    /// existed and is only ever used as a fallback by [`ProjectConfig::rank_review_actions`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LevelConfig {
    pub name: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<String>,
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
