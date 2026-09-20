//! `get_catalog` — reading a vault clone into the project list the import dialog shows, and
//! deciding each project's sync status against the local config.// ---------------------------------------------------------------------------------------------

use super::internals::{load_state, read_yaml};
use crate::config::{get_project_memory_dir, get_project_skills_dir, TendrilSettings};
use crate::error::Result;
use crate::vault::assets::{file_names, file_stems};
use crate::vault::models::*;
use crate::vault::settings::{resolve_vault, vault_dir, ProjectVaultTracking, VaultSettings};
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

// Catalog
// ---------------------------------------------------------------------------------------------

/// Reads `vault.yaml` and every `projects/<name>/` directory, deriving each project's sync status
/// against the local config. A malformed `project.yaml` is logged and skipped, never fatal — one bad
/// project must not hide the rest of a teammate's vault.
pub fn get_catalog(tendril_home: &Path, vault_id: Option<&str>) -> Result<VaultCatalog> {
    let (settings, state) = load_state(tendril_home)?;
    let vault = resolve_vault(&state, vault_id);
    Ok(build_catalog(tendril_home, &settings, vault.as_ref()))
}

pub(super) fn build_catalog(
    tendril_home: &Path,
    settings: &TendrilSettings,
    vault: Option<&VaultSettings>,
) -> VaultCatalog {
    let dir = vault_dir(tendril_home, vault);
    let mut catalog = VaultCatalog::default();

    if !dir.exists() {
        return catalog;
    }

    let manifest_path = dir.join("vault.yaml");
    if manifest_path.exists() {
        match read_yaml::<VaultManifest>(&manifest_path) {
            Ok(manifest) => catalog.manifest = Some(manifest),
            Err(e) => tracing::warn!("Failed to read vault.yaml: {}", e),
        }
    }

    catalog.global_skills = file_stems(&dir.join("global").join("skills"), "md");
    catalog.global_mcps = file_stems(&dir.join("global").join("mcps"), "yaml");

    let mut project_dirs: Vec<PathBuf> = std::fs::read_dir(dir.join("projects"))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .collect()
        })
        .unwrap_or_default();
    project_dirs.sort();

    for project_dir in project_dirs {
        let Some(project_name) = project_dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
        else {
            continue;
        };

        let manifest_path = project_dir.join("project.yaml");
        let manifest = if manifest_path.exists() {
            match read_yaml::<VaultProjectManifest>(&manifest_path) {
                Ok(manifest) => Some(manifest),
                Err(e) => {
                    tracing::warn!("Failed to parse project.yaml for {}: {}", project_name, e);
                    None
                }
            }
        } else {
            None
        };

        // Skills live on disk; MCP servers are modelled in the manifest. Union both with anything
        // carried in the untyped passthrough, so a project written by the C# app reports the same
        // counts either way.
        let mut skill_names = union_names(
            manifest
                .as_ref()
                .map(|manifest| extra_names(&manifest.extra, "skills")),
            file_stems(&project_dir.join("skills"), "md"),
        );
        let mut mcp_names = union_names(
            manifest.as_ref().map(|manifest| {
                manifest
                    .mcp_servers
                    .iter()
                    .map(|server| server.name.clone())
                    .collect()
            }),
            file_stems(&project_dir.join("mcps"), "yaml"),
        );
        skill_names.sort_by_key(|name| name.to_lowercase());
        mcp_names.sort_by_key(|name| name.to_lowercase());

        let memory_names = file_names(&project_dir.join("memory"), "md");
        let review_action_names: Vec<String> = manifest
            .as_ref()
            .map(|manifest| {
                manifest
                    .review_actions
                    .iter()
                    .map(|action| action.name.clone())
                    .collect()
            })
            .unwrap_or_default();
        let verification_names: Vec<String> = manifest
            .as_ref()
            .map(|manifest| {
                manifest
                    .verifications
                    .iter()
                    .map(|verification| verification.name.clone())
                    .collect()
            })
            .unwrap_or_default();
        let remote_version = manifest
            .as_ref()
            .map(|manifest| manifest.version.clone())
            .unwrap_or_default();

        let tracked = match_tracking(settings, vault, &project_name);
        let local_version = tracked
            .as_ref()
            .map(|(_, tracking)| tracking.installed_version.clone())
            .filter(|version| !version.is_empty());

        let (sync_status, has_conflict, conflict_reason) = derive_sync_status(
            tendril_home,
            settings,
            &project_name,
            tracked.as_ref().map(|(name, _)| name.as_str()),
            &skill_names,
            &memory_names,
            &review_action_names,
            &verification_names,
            local_version.as_deref(),
            &remote_version,
        );

        catalog.projects.push(VaultCatalogItem {
            name: project_name,
            description: manifest
                .as_ref()
                .map(|manifest| manifest.context.clone())
                .unwrap_or_default(),
            color: manifest
                .as_ref()
                .map(|manifest| manifest.color.clone())
                .unwrap_or_else(default_color),
            stack_hash: manifest
                .as_ref()
                .and_then(|manifest| manifest.stack_hash.clone()),
            local_version,
            remote_version,
            latest_changelog: manifest
                .as_ref()
                .map(|manifest| manifest.changelog.clone())
                .filter(|changelog| !changelog.is_empty()),
            updated_at: manifest
                .as_ref()
                .map(|manifest| manifest.updated_at)
                .unwrap_or_else(Utc::now),
            updated_by: manifest
                .as_ref()
                .and_then(|manifest| manifest.updated_by.clone()),
            repos_count: manifest
                .as_ref()
                .map(|manifest| manifest.repos.len() as i32)
                .unwrap_or(0),
            skills_count: skill_names.len() as i32,
            mcps_count: mcp_names.len() as i32,
            memories_count: memory_names.len() as i32,
            review_actions_count: review_action_names.len() as i32,
            verifications_count: verification_names.len() as i32,
            skill_names,
            mcp_server_names: mcp_names,
            memory_file_names: memory_names,
            review_action_names,
            verification_names,
            sync_status,
            repos: manifest
                .as_ref()
                .map(|manifest| manifest.repos.clone())
                .unwrap_or_default(),
            has_local_conflict: has_conflict,
            conflict_reason,
            linked_vault_id: tracked
                .as_ref()
                .and_then(|(_, tracking)| tracking.vault_id.clone()),
            source_vault_id: vault.map(|vault| vault.id.clone()),
            source_vault_name: vault.map(|vault| vault.name.clone()),
        });
    }

    catalog
}

/// Names carried in a manifest's untyped passthrough, accepting both `["a"]` and `[{name: a}]`.
fn extra_names(extra: &BTreeMap<String, serde_json::Value>, key: &str) -> Vec<String> {
    let Some(serde_json::Value::Array(items)) = extra.get(key) else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| match item {
            serde_json::Value::String(name) => Some(name.clone()),
            serde_json::Value::Object(fields) => fields
                .get("name")
                .and_then(|name| name.as_str())
                .map(|name| name.to_string()),
            _ => None,
        })
        .filter(|name| !name.trim().is_empty())
        .collect()
}

fn union_names(from_manifest: Option<Vec<String>>, from_disk: Vec<String>) -> Vec<String> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    from_manifest
        .unwrap_or_default()
        .into_iter()
        .chain(from_disk)
        .filter(|name| seen.insert(name.to_lowercase()))
        .collect()
}

/// Finds the local project a vault project is tracked as: an exact key, then `vaultProjectName`, then
/// a `name-` / `name_` prefixed key — and only when a local project by that key actually exists, so a
/// stale tracking entry cannot make an uninstalled project look installed.
pub(super) fn match_tracking(
    settings: &TendrilSettings,
    vault: Option<&VaultSettings>,
    project_name: &str,
) -> Option<(String, ProjectVaultTracking)> {
    let vault = vault?;
    let prefix_dash = format!("{}-", project_name).to_lowercase();
    let prefix_underscore = format!("{}_", project_name).to_lowercase();

    for (key, tracking) in &vault.tracked_projects {
        let vault_project_name = tracking
            .vault_project_name
            .clone()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| key.clone());

        let matches = vault_project_name.eq_ignore_ascii_case(project_name)
            || key.eq_ignore_ascii_case(project_name)
            || key.to_lowercase().starts_with(&prefix_dash)
            || key.to_lowercase().starts_with(&prefix_underscore);

        if matches
            && settings
                .projects
                .iter()
                .any(|project| project.name.eq_ignore_ascii_case(key))
        {
            let mut tracking = tracking.clone();
            if tracking
                .vault_project_name
                .as_deref()
                .unwrap_or_default()
                .is_empty()
            {
                tracking.vault_project_name = Some(project_name.to_string());
            }
            return Some((key.clone(), tracking));
        }
    }

    None
}

#[allow(clippy::too_many_arguments)]
fn derive_sync_status(
    tendril_home: &Path,
    settings: &TendrilSettings,
    project_name: &str,
    local_project_name: Option<&str>,
    skill_names: &[String],
    memory_names: &[String],
    review_action_names: &[String],
    verification_names: &[String],
    local_version: Option<&str>,
    remote_version: &str,
) -> (VaultItemSyncStatus, bool, Option<String>) {
    let Some(local_name) = local_project_name else {
        // Not tracked to this vault. An unassociated local project of the same name is a conflict:
        // importing would overwrite work the user did not get from here.
        let clash = settings
            .projects
            .iter()
            .any(|project| project.name.eq_ignore_ascii_case(project_name));
        return if clash {
            (
                VaultItemSyncStatus::Conflict,
                true,
                Some(
                    "A local project with this name already exists (created locally or imported from another vault)."
                        .to_string(),
                ),
            )
        } else {
            (VaultItemSyncStatus::NotImported, false, None)
        };
    };

    let local_memories: BTreeSet<String> =
        file_names(&get_project_memory_dir(tendril_home, local_name), "md")
            .into_iter()
            .map(|name| name.to_lowercase())
            .collect();
    let local_skills: BTreeSet<String> =
        file_stems(&get_project_skills_dir(tendril_home, local_name), "md")
            .into_iter()
            .map(|name| name.to_lowercase())
            .collect();

    let vault_memories: BTreeSet<String> = memory_names
        .iter()
        .map(|name| name.to_lowercase())
        .collect();
    let vault_skills: BTreeSet<String> =
        skill_names.iter().map(|name| name.to_lowercase()).collect();

    let missing_memories = vault_memories.difference(&local_memories).next().is_some();
    let missing_skills = vault_skills.difference(&local_skills).next().is_some();
    let extra_local_skills = local_skills.difference(&vault_skills).next().is_some();
    let extra_local_memories = local_memories.difference(&vault_memories).next().is_some();

    let mut local_config_changes = false;
    if let Some(project) = settings
        .projects
        .iter()
        .find(|project| project.name.eq_ignore_ascii_case(local_name))
    {
        let vault_actions: BTreeSet<String> = review_action_names
            .iter()
            .map(|name| name.to_lowercase())
            .collect();
        let vault_verifications: BTreeSet<String> = verification_names
            .iter()
            .map(|name| name.to_lowercase())
            .collect();

        local_config_changes = project
            .review_actions
            .iter()
            .any(|action| !vault_actions.contains(&action.name.to_lowercase()))
            || project.verifications.iter().any(|verification| {
                !vault_verifications.contains(&verification.name.to_lowercase())
            });
    }

    let version_differs = match (local_version, remote_version) {
        (Some(local), remote) if !local.is_empty() && !remote.is_empty() => {
            !local.eq_ignore_ascii_case(remote)
        }
        _ => false,
    };

    // A vault-side addition outranks a local-side one: the user is told to pull first.
    let status = if missing_memories || missing_skills || version_differs {
        VaultItemSyncStatus::UpdateAvailable
    } else if extra_local_skills || extra_local_memories || local_config_changes {
        VaultItemSyncStatus::Modified
    } else {
        VaultItemSyncStatus::UpToDate
    };

    (status, false, None)
}
