//! Vault operations, ported from `VaultService.cs`.
//!
//! V2 has no DI container, so each operation is a free function taking `tendril_home`. The C#
//! `VaultChanged` event has no consumer here and is dropped.
//!
//! Every operation that shells out to `gh` has a `*_with(..., gh: GhRunner)` twin following the house
//! injectable-seam convention (`plans::dependencies::PrStateResolver`), so tests inject canned output
//! and never reach the network. The seam yields `(exit_code, stdout, stderr)` rather than the plan's
//! `Result<String>` because several vault operations need the output of a *failing* call — probing
//! whether a repository already exists, or deciding whether a failed `gh pr create` is recoverable.
//!
//! The operations are grouped one module per lifecycle stage — `discovery` and `connection` to
//! get a vault, `push` and `import` to move projects through it, `status`, `catalog` and
//! `maintenance` to keep it current — over the shared plumbing in `internals`. Every public
//! function is re-exported here, so `vault::service::*` is the same surface it has always been.

mod catalog;
mod connection;
mod discovery;
mod import;
mod internals;
mod maintenance;
mod push;
mod status;

pub use catalog::get_catalog;
pub use connection::{
    connect_vault, connect_vault_with, create_vault_repo, create_vault_repo_with, disconnect_vault,
    set_always_up_to_date,
};
pub use discovery::{
    discover_existing_vaults, discover_existing_vaults_with, list_github_accounts,
    list_github_accounts_with,
};
pub use import::{
    import_project, import_project_with, import_project_with_mappings, merge_project,
    vault_project_dir,
};
pub use internals::{generate_version_timestamp, production_gh, GhFuture, GhRunner};
pub use maintenance::{
    delete_project_from_vault, delete_project_from_vault_with, pull_latest, pull_latest_with,
};
pub use push::{push_and_create_pr, push_and_create_pr_with};
pub use status::{get_status, get_vaults};

use crate::config::TendrilSettings;
use crate::config::{get_config_path, load_config};
use crate::error::{Result, TendrilError};
use crate::vault::models::ProjectAssets;
use std::path::Path;

/// Collects the assets of a local project, for building an export selection.
pub fn project_assets(tendril_home: &Path, project_name: &str) -> Result<ProjectAssets> {
    let settings = load_config(&get_config_path(tendril_home))?;
    Ok(crate::vault::assets::collect_project_assets(
        tendril_home,
        &settings,
        project_name,
    ))
}

/// Resolves a project name to its canonical spelling, failing with the available names listed.
pub fn require_project(settings: &TendrilSettings, name: &str) -> Result<String> {
    match settings
        .projects
        .iter()
        .find(|project| project.name.eq_ignore_ascii_case(name))
    {
        Some(project) => Ok(project.name.clone()),
        None => {
            let available: Vec<&str> = settings
                .projects
                .iter()
                .map(|project| project.name.as_str())
                .collect();
            Err(TendrilError::ProjectNotFound(format!(
                "{}. Available projects: {}",
                name,
                if available.is_empty() {
                    "none".to_string()
                } else {
                    available.join(", ")
                }
            )))
        }
    }
}
