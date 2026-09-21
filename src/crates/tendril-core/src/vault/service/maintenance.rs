//! Removing a project from the vault, and pulling the vault clone up to date.// ---------------------------------------------------------------------------------------------

use super::catalog::build_catalog;
use super::catalog::match_tracking;
use super::import::import_project_with;
use super::internals::{
    branch_timestamp, create_vault_pr, ensure_base_branch, generate_version_timestamp, git_commit,
    git_run, load_state, persist, production_gh, update_vault, write_yaml, GhRunner,
};
use crate::error::Result;
use crate::vault::models::*;
use crate::vault::settings::{resolve_vault, vault_dir, VaultSettings};
use chrono::Utc;
use std::path::Path;

// ---------------------------------------------------------------------------------------------
// Delete / pull
// ---------------------------------------------------------------------------------------------

/// Removes a project from the vault via a PR on a `vault/delete-<name>-<timestamp>` branch, and drops
/// its tracking entry. The deletion goes through review like any other vault change.
pub async fn delete_project_from_vault(
    tendril_home: &Path,
    project_name: &str,
    vault_id: Option<&str>,
) -> Result<VaultPrResult> {
    delete_project_from_vault_with(tendril_home, project_name, vault_id, &production_gh).await
}

pub async fn delete_project_from_vault_with(
    tendril_home: &Path,
    project_name: &str,
    vault_id: Option<&str>,
    gh: GhRunner<'_>,
) -> Result<VaultPrResult> {
    let (mut settings, mut state) = load_state(tendril_home)?;
    let Some(mut vault) = resolve_vault(&state, vault_id) else {
        return Ok(VaultPrResult::failure("No vault configured for deletion."));
    };

    let dir = vault_dir(tendril_home, Some(&vault));
    if !dir.join(".git").exists() {
        return Ok(VaultPrResult::failure(
            "Vault repository is not initialized locally.",
        ));
    }

    let project_dir = dir.join("projects").join(project_name);
    if !project_dir.exists() {
        return Ok(VaultPrResult::failure(format!(
            "Project '{}' was not found in vault '{}'.",
            project_name, vault.name
        )));
    }

    let version = generate_version_timestamp();
    let branch = format!(
        "vault/delete-{}-{}",
        project_name.to_lowercase(),
        branch_timestamp()
    );

    let base_branch = ensure_base_branch(&dir, &mut vault, gh).await?;
    git_run(&dir, &["checkout", &base_branch]);
    git_run(&dir, &["pull", "origin", &base_branch]);
    git_run(&dir, &["checkout", "-B", &branch]);

    if let Err(e) = std::fs::remove_dir_all(&project_dir) {
        return Ok(VaultPrResult::failure(e.to_string()));
    }

    write_yaml(
        &dir.join("vault.yaml"),
        &VaultManifest {
            name: vault.name.clone(),
            version: version.clone(),
            updated_at: Utc::now(),
            ..Default::default()
        },
    )?;

    git_run(&dir, &["add", "-A"]);
    git_commit(
        &dir,
        &settings,
        &[
            "-m",
            &format!(
                "chore(vault): delete {} from vault (v{})",
                project_name, version
            ),
        ],
    );
    git_run(&dir, &["push", "-u", "origin", &branch]);

    let pr_url = create_vault_pr(
        gh,
        &dir,
        &format!("Delete {} from vault (v{})", project_name, version),
        &format!(
            "### Vault Project Deletion\n\nThis PR removes the **{}** project and its assets from the vault.",
            project_name
        ),
        &base_branch,
        &branch,
        &[],
        &vault.repo_url,
    )
    .await?;

    git_run(&dir, &["checkout", &base_branch]);
    git_run(&dir, &["pull", "origin", &base_branch]);

    let key = project_name.to_string();
    update_vault(&mut state, &vault.id, |vault| {
        vault.tracked_projects.remove(&key);
        vault.last_synced_at = Some(Utc::now());
    });
    persist(tendril_home, &mut settings, &state)?;

    Ok(VaultPrResult {
        success: true,
        pr_url,
        branch_name: Some(branch),
        error_message: None,
    })
}

/// Pulls each vault's base branch, then re-imports every catalog project that still has a live local
/// tracking entry, reusing its stored `localRepoPaths`.
pub async fn pull_latest(tendril_home: &Path, vault_id: Option<&str>) -> Result<VaultSyncResult> {
    pull_latest_with(tendril_home, vault_id, &production_gh).await
}

pub async fn pull_latest_with(
    tendril_home: &Path,
    vault_id: Option<&str>,
    gh: GhRunner<'_>,
) -> Result<VaultSyncResult> {
    let (mut settings, mut state) = load_state(tendril_home)?;

    let mut to_sync: Vec<VaultSettings> = match vault_id.map(str::trim).filter(|id| !id.is_empty())
    {
        Some(id) if !id.eq_ignore_ascii_case("default") => state
            .vaults
            .iter()
            .filter(|vault| {
                vault.id.eq_ignore_ascii_case(id) || vault.repo_url.eq_ignore_ascii_case(id)
            })
            .cloned()
            .collect(),
        _ => state
            .vaults
            .iter()
            .filter(|vault| vault.enabled)
            .cloned()
            .collect(),
    };

    if to_sync.is_empty() {
        if let Some(primary) = state.primary.clone().filter(|primary| primary.enabled) {
            to_sync.push(primary);
        }
    }

    if to_sync.is_empty() {
        return Ok(VaultSyncResult {
            success: false,
            message: "No vaults are configured.".to_string(),
            ..Default::default()
        });
    }

    let mut first_error: Option<String> = None;
    let mut pending_imports: Vec<(String, VaultImportRequest)> = Vec::new();

    for mut vault in to_sync {
        let dir = vault_dir(tendril_home, Some(&vault));
        if !dir.join(".git").exists() {
            continue;
        }

        let base_branch = ensure_base_branch(&dir, &mut vault, gh).await?;
        git_run(&dir, &["checkout", &base_branch]);
        git_run(&dir, &["fetch", "origin"]);
        let (code, _, stderr) = git_run(&dir, &["pull", "--rebase", "origin", &base_branch]);
        if code != 0 && stderr.to_lowercase().contains("error") {
            first_error.get_or_insert_with(|| stderr.trim().to_string());
            continue;
        }

        update_vault(&mut state, &vault.id, |vault| {
            vault.last_synced_at = Some(Utc::now())
        });

        let catalog = build_catalog(tendril_home, &settings, Some(&vault));
        for item in &catalog.projects {
            let Some((local_name, tracking)) = match_tracking(&settings, Some(&vault), &item.name)
            else {
                continue;
            };
            pending_imports.push((
                vault.id.clone(),
                VaultImportRequest {
                    project_name: item.name.clone(),
                    target_local_project_name: Some(local_name),
                    local_repo_mappings: tracking.local_repo_paths.clone(),
                    source_vault_id: Some(vault.id.clone()),
                    ..Default::default()
                },
            ));
        }
    }

    // Persist the pull timestamps *before* re-importing: each import re-reads `config.yaml`, so an
    // unsaved timestamp here would be overwritten and lost.
    persist(tendril_home, &mut settings, &state)?;

    let mut updated = 0;
    for (vault_id, request) in pending_imports {
        let result = import_project_with(tendril_home, &request, Some(&vault_id), gh).await?;
        if result.success {
            updated += 1;
        } else if let Some(error) = result.error_message {
            first_error.get_or_insert(error);
        }
    }

    if updated == 0 {
        if let Some(error) = first_error {
            return Ok(VaultSyncResult {
                success: false,
                message: "Failed to pull latest vault changes".to_string(),
                error_message: Some(error),
                ..Default::default()
            });
        }
    }

    Ok(VaultSyncResult {
        success: true,
        updated_projects_count: updated,
        message: "Vaults synchronized successfully".to_string(),
        error_message: None,
    })
}
