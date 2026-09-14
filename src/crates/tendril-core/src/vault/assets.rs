//! Port of `VaultService.CollectProjectAssets`.
//!
//! Answers "what could I push for this project?" so a caller can present a selection before an
//! export. Nothing here touches the network or the vault clone.
//!
//! One adaptation: the C# `ProjectConfig` carries a `Skills` list, which V2's does not, so skills come
//! from `Projects/<name>/Skills/*.md` alone. That is the same set in practice — the C# code unions the
//! config list with exactly that directory — but it means a skill declared in config yet missing from
//! disk is not reported.

use crate::config::{get_project_memory_dir, get_project_skills_dir, TendrilSettings};
use crate::vault::models::ProjectAssets;
use std::path::Path;

/// Collects the skills, MCP servers, memories, review actions and verifications of a local project.
///
/// An unknown project name yields an otherwise-empty `ProjectAssets` carrying that name, rather than
/// an error: callers list assets speculatively while a user is still typing.
pub fn collect_project_assets(
    tendril_home: &Path,
    settings: &TendrilSettings,
    project_name: &str,
) -> ProjectAssets {
    let Some(project) = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(project_name))
    else {
        return ProjectAssets {
            project_name: project_name.to_string(),
            ..Default::default()
        };
    };

    ProjectAssets {
        project_name: project.name.clone(),
        skills: dedupe(file_stems(
            &get_project_skills_dir(tendril_home, &project.name),
            "md",
        )),
        mcp_servers: dedupe(
            project
                .mcp_servers
                .iter()
                .map(|server| server.name.clone())
                .collect(),
        ),
        memories: dedupe(file_names(
            &get_project_memory_dir(tendril_home, &project.name),
            "md",
        )),
        review_actions: dedupe(
            project
                .review_actions
                .iter()
                .map(|action| action.name.clone())
                .collect(),
        ),
        verifications: dedupe(
            project
                .verifications
                .iter()
                .map(|verification| verification.name.clone())
                .collect(),
        ),
    }
}

/// File names without their extension, e.g. `Skills/rust.md` → `rust`.
pub fn file_stems(dir: &Path, extension: &str) -> Vec<String> {
    list_files(dir, extension)
        .into_iter()
        .filter_map(|path| {
            path.file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
        })
        .filter(|name| !name.trim().is_empty())
        .collect()
}

/// File names including their extension, e.g. `Memory/stack.md` → `stack.md`.
pub fn file_names(dir: &Path, extension: &str) -> Vec<String> {
    list_files(dir, extension)
        .into_iter()
        .filter_map(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .filter(|name| !name.trim().is_empty())
        .collect()
}

/// Every `*.<extension>` directly inside `dir`, sorted. A missing directory yields nothing.
fn list_files(dir: &Path, extension: &str) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut files: Vec<std::path::PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.extension()
                .map(|found| found.eq_ignore_ascii_case(extension))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    files
}

/// Case-insensitive dedupe keeping the first spelling of each name, sorted case-insensitively.
///
/// The C# original collects into an `OrdinalIgnoreCase` `HashSet`, whose order is unspecified; sorting
/// here makes the output stable enough to assert on.
fn dedupe(names: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut result: Vec<String> = names
        .into_iter()
        .filter(|name| !name.trim().is_empty())
        .filter(|name| seen.insert(name.to_lowercase()))
        .collect();
    result.sort_by_key(|name| name.to_lowercase());
    result
}
