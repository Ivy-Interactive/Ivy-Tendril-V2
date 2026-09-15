//! Scans a repo for MCP server declarations, for `tendril project import-mcp` / `project import`.
//!
//! The MCP-side mirror of [`crate::skills::scan_repo_skills`]: same job, same "one entry per name,
//! first file wins" rule, same refusal to fail the whole scan over one unreadable file.

use crate::models::ProjectMcpServerRef;
use std::collections::HashMap;
use std::path::Path;

/// An MCP server found while scanning a repo, not yet added to a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredMcpServer {
    pub name: String,
    pub command: String,
    pub arguments: Vec<String>,
    pub environment: HashMap<String, String>,
    /// Config file it came from, relative to the repo root — printed by `import-mcp`.
    pub source_file: String,
}

/// Config files to look at, in precedence order: the first file declaring a name owns it.
const MCP_CONFIG_FILES: &[&str] = &[
    ".mcp.json",
    "mcp.json",
    ".mcp_config.json",
    "mcp_config.json",
    ".vscode/mcp.json",
    ".cursor/mcp.json",
    ".gemini/mcp_config.json",
    ".agents/mcp_config.json",
    ".claude/mcp.json",
    "claude_desktop_config.json",
];

/// Every MCP server declared by a config file in `repo_path`.
///
/// A file that will not parse is skipped in silence: a malformed config in one repo must not fail
/// the scan, and the operator sees the shortfall as a missing entry in the import output.
pub fn scan_repo_mcp_servers(repo_path: &Path) -> Vec<DiscoveredMcpServer> {
    let mut results: Vec<DiscoveredMcpServer> = Vec::new();
    if !repo_path.is_dir() {
        return results;
    }

    for relative_file in MCP_CONFIG_FILES {
        let mut full_path = repo_path.to_path_buf();
        for segment in relative_file.split('/') {
            full_path.push(segment);
        }
        if !full_path.is_file() {
            continue;
        }

        let Ok(text) = std::fs::read_to_string(&full_path) else {
            continue;
        };
        let Ok(root) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let Some(root_obj) = root.as_object() else {
            continue;
        };

        // `mcpServers` is the Claude/Cursor shape, `servers` the VS Code one; a file that is just
        // the map itself is the third shape seen in the wild.
        let servers = root_obj
            .get("mcpServers")
            .and_then(|v| v.as_object())
            .or_else(|| root_obj.get("servers").and_then(|v| v.as_object()))
            .unwrap_or(root_obj);

        for (name, entry) in servers {
            let Some(entry) = entry.as_object() else {
                continue;
            };
            let command = entry
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if command.trim().is_empty() {
                continue;
            }

            let arguments = entry
                .get("args")
                .and_then(|v| v.as_array())
                .map(|args| {
                    args.iter()
                        .filter_map(|a| a.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();

            let environment = entry
                .get("env")
                .and_then(|v| v.as_object())
                .map(|env| {
                    env.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();

            if results.iter().any(|r| r.name.eq_ignore_ascii_case(name)) {
                continue;
            }

            results.push(DiscoveredMcpServer {
                name: name.clone(),
                command,
                arguments,
                environment,
                source_file: (*relative_file).to_string(),
            });
        }
    }

    results
}

/// The project config entry for a discovered server. Imported servers start enabled.
pub fn to_project_ref(server: &DiscoveredMcpServer) -> ProjectMcpServerRef {
    ProjectMcpServerRef {
        name: server.name.clone(),
        command: server.command.clone(),
        arguments: server.arguments.clone(),
        environment: server.environment.clone(),
        disabled: false,
        extra: Default::default(),
    }
}
