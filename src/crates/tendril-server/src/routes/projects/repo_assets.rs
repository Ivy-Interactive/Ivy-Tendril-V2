//! Importing skills and MCP servers from a repository into a project — V1's
//! `Apps/Settings/Dialogs/ImportRepoAssetsDialog.cs` over `Helpers/RepoAssetScanner.cs`.
//!
//! Two routes, scan then import, so the dialog can show a checklist between them:
//!
//! - `POST /api/projects/:name/repo-assets/scan` resolves the source (one of the project's repos, a
//!   local folder, or a git URL shallow-cloned into `<TENDRIL_HOME>/Cache/Imports/`) and answers what
//!   the scanners found. Nothing is written except that cache.
//! - `POST /api/projects/:name/repo-assets/import` resolves and scans the same source again and
//!   imports the named subset. It re-scans rather than trusting paths the client echoes back, so the
//!   only thing a caller chooses is *which* of the discovered items to take.
//!
//! The scanners, the skill copy and the MCP mapping are `tendril-core`'s, which the CLI's
//! `project import*` verbs already use; this adds only the source resolution and the config upsert.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use tendril_core::config::{expand_variables, load_config, sanitize_project_name, save_config};
use tendril_core::git::clone::{
    clone_or_refresh_with, extract_repo_name, is_remote_url, redact_credentials, CloneFailure,
    CloneOptions,
};
use tendril_core::mcp::discovery::{scan_repo_mcp_servers, to_project_ref};
use tendril_core::skills::{import_skill_to_project, scan_repo_skills};

/// `enum ImportAssetKind { McpServers, Skills }`.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepoAssetKind {
    Skills,
    McpServers,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRepoAssetsRequest {
    pub kind: RepoAssetKind,
    /// A configured repo path, a local folder, or a git URL.
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRepoAssetsRequest {
    pub kind: RepoAssetKind,
    pub source: String,
    /// The discovered items to import, by name (case-insensitive).
    pub names: Vec<String>,
}

/// One discovered item, as the checklist shows it: V1's `DiscoveredItemRowView(name, badge, text)`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRepoAsset {
    pub name: String,
    /// Where it was found, relative to the repo root — the row's badge.
    pub source_path: String,
    /// A skill's description, or an MCP server's command line.
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRepoAssetsResponse {
    pub items: Vec<DiscoveredRepoAsset>,
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

/// `RepoAssetScanner.ResolveAndPrepareRepoPath`: a directory is used as it is, a remote URL is
/// shallow-cloned into the import cache (the CLI's `clone_for_import`), anything else is refused.
///
/// A relative path is refused for the reason `cloning::materialize_repos` gives: it would resolve
/// against the daemon's own working directory, which is nothing the operator chose.
fn resolve_source(raw: &str, tendril_home: &FsPath) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Please specify a repository source.".to_string());
    }
    if trimmed.starts_with('-') {
        return Err(format!(
            "'{}' is not a valid repository source: it starts with a dash, which git would read as an option.",
            redact_credentials(trimmed)
        ));
    }

    let expanded = expand_variables(trimmed, &tendril_home.to_string_lossy());
    if is_remote_url(&expanded) {
        return clone_for_import(&expanded, tendril_home);
    }

    let path = PathBuf::from(&expanded);
    if !path.is_absolute() {
        return Err(format!(
            "'{}' is relative. Use an absolute path to the repository folder.",
            redact_credentials(trimmed)
        ));
    }
    if !path.is_dir() {
        return Err(format!(
            "Repository path not found: {}",
            redact_credentials(trimmed)
        ));
    }
    Ok(path.canonicalize().unwrap_or(path))
}

/// Shallow-clones `url` into `<TENDRIL_HOME>/Cache/Imports/<repo-name>`, refreshing an existing
/// clone — the same cache, and the same throw-away-and-retry on a conflicting entry, as the CLI's
/// `tendril-cli/src/commands/project/import.rs::clone_for_import`.
fn clone_for_import(url: &str, tendril_home: &FsPath) -> Result<PathBuf, String> {
    let repo_name = extract_repo_name(url).unwrap_or_else(|| "remote-repo".to_string());
    let sanitized = sanitize_project_name(&repo_name);
    let name = if sanitized.is_empty() {
        "remote-repo".to_string()
    } else {
        sanitized
    };
    let target_dir = tendril_home.join("Cache").join("Imports").join(&name);
    let options = CloneOptions { depth: Some(1) };

    match clone_or_refresh_with(url, &target_dir, options) {
        Ok(cloned) => Ok(cloned.path),
        Err(e) if e.kind == CloneFailure::DestinationConflict && target_dir.exists() => {
            std::fs::remove_dir_all(&target_dir).map_err(|err| err.to_string())?;
            clone_or_refresh_with(url, &target_dir, options)
                .map(|cloned| cloned.path)
                .map_err(|err| err.message)
        }
        Err(e) => Err(e.message),
    }
}

fn scan(kind: RepoAssetKind, repo: &FsPath) -> Vec<DiscoveredRepoAsset> {
    match kind {
        RepoAssetKind::Skills => scan_repo_skills(repo)
            .into_iter()
            .map(|skill| DiscoveredRepoAsset {
                name: skill.name,
                source_path: skill.relative_path,
                detail: skill.description,
            })
            .collect(),
        RepoAssetKind::McpServers => scan_repo_mcp_servers(repo)
            .into_iter()
            .map(|server| DiscoveredRepoAsset {
                detail: if server.arguments.is_empty() {
                    server.command.clone()
                } else {
                    format!("{} {}", server.command, server.arguments.join(" "))
                },
                name: server.name,
                source_path: server.source_file,
            })
            .collect(),
    }
}

/// Resolving may clone for minutes, so it runs off the async runtime, as `sync_project_repos` does.
async fn resolve_blocking(source: String, tendril_home: PathBuf) -> Result<PathBuf, String> {
    tokio::task::spawn_blocking(move || resolve_source(&source, &tendril_home))
        .await
        .map_err(|e| format!("Scan failed: {e}"))?
}

fn project_exists(state: &AppState, name: &str) -> Result<(), Response> {
    let settings = load_config(&state.config_path).map_err(|e| {
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load config: {e}"),
        )
    })?;
    if settings
        .projects
        .iter()
        .any(|p| p.name.eq_ignore_ascii_case(name))
    {
        Ok(())
    } else {
        Err(error(
            StatusCode::NOT_FOUND,
            format!("Project '{name}' not found"),
        ))
    }
}

pub async fn scan_project_repo_assets(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<ScanRepoAssetsRequest>,
) -> impl IntoResponse {
    if let Err(response) = project_exists(&state, &name) {
        return response;
    }
    let repo = match resolve_blocking(req.source, state.tendril_home.clone()).await {
        Ok(path) => path,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };
    let kind = req.kind;
    let items = tokio::task::spawn_blocking(move || scan(kind, &repo))
        .await
        .unwrap_or_default();
    (
        StatusCode::OK,
        Json(json!(ScanRepoAssetsResponse { items })),
    )
        .into_response()
}

pub async fn import_project_repo_assets(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<ImportRepoAssetsRequest>,
) -> impl IntoResponse {
    if req.names.is_empty() {
        return error(StatusCode::BAD_REQUEST, "Nothing was selected to import.");
    }
    if let Err(response) = project_exists(&state, &name) {
        return response;
    }
    let repo = match resolve_blocking(req.source, state.tendril_home.clone()).await {
        Ok(path) => path,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };
    let wanted = |candidate: &str| req.names.iter().any(|n| n.eq_ignore_ascii_case(candidate));

    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load config: {e}"),
            )
        }
    };
    let Some(idx) = settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    else {
        return error(StatusCode::NOT_FOUND, format!("Project '{name}' not found"));
    };
    let project_name = settings.projects[idx].name.clone();

    let mut imported = Vec::new();
    match req.kind {
        RepoAssetKind::McpServers => {
            for server in scan_repo_mcp_servers(&repo)
                .iter()
                .filter(|s| wanted(&s.name))
            {
                let entry = to_project_ref(server);
                let servers = &mut settings.projects[idx].mcp_servers;
                match servers
                    .iter()
                    .position(|m| m.name.eq_ignore_ascii_case(&entry.name))
                {
                    Some(i) => servers[i] = entry,
                    None => servers.push(entry),
                }
                imported.push(server.name.clone());
            }
        }
        RepoAssetKind::Skills => {
            // Copied before the config is written, so a copy failure leaves no entry pointing at
            // files that are not there — the CLI's order, for its reason.
            for skill in scan_repo_skills(&repo).iter().filter(|s| wanted(&s.name)) {
                let entry = match import_skill_to_project(
                    &state.tendril_home,
                    &project_name,
                    skill,
                    true,
                ) {
                    Ok(entry) => entry,
                    Err(e) => {
                        return error(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to copy skill '{}': {e}", skill.name),
                        )
                    }
                };
                let skills = &mut settings.projects[idx].skills;
                match skills
                    .iter()
                    .position(|s| s.name.eq_ignore_ascii_case(&entry.name))
                {
                    Some(i) => skills[i] = entry,
                    None => skills.push(entry),
                }
                imported.push(skill.name.clone());
            }
        }
    }

    if imported.is_empty() {
        return error(
            StatusCode::NOT_FOUND,
            "None of the selected items were found in the repository any more.",
        );
    }
    if let Err(e) = save_config(&state.config_path, &settings) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save config: {e}"),
        );
    }

    (StatusCode::OK, Json(json!({ "imported": imported }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_blank_dash_and_relative_sources() {
        let home = std::env::temp_dir();
        assert!(resolve_source("  ", &home).is_err());
        assert!(resolve_source("--upload-pack=x", &home).is_err());
        assert!(resolve_source("some/relative/dir", &home).is_err());
    }

    #[test]
    fn accepts_an_existing_absolute_folder() {
        let dir = std::env::temp_dir();
        assert!(resolve_source(&dir.to_string_lossy(), &dir).is_ok());
    }
}
