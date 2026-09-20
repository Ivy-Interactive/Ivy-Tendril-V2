//! Importing a vault project into the local config, in both flavours: `import_project` replaces the
//! local project outright, `merge_project` folds the vault's entries into it.// ---------------------------------------------------------------------------------------------

use super::internals::{
    argv, copy_selected, filter_by_name, git_run, load_state, persist, production_gh, read_yaml,
    repo_paths_by_folder, update_vault, GhRunner,
};
use crate::config::{get_project_memory_dir, get_project_skills_dir, TendrilSettings};
use crate::error::Result;
use crate::git::clone::redact_credentials;
use crate::models::{
    ProjectConfig, ProjectMcpServerRef, ProjectVerificationRef, RepoRef, ReviewActionConfig,
};
use crate::vault::models::*;
use crate::vault::settings::{resolve_vault, vault_dir, ProjectVaultTracking, VaultSettings};
use chrono::Utc;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

// Import / merge
// ---------------------------------------------------------------------------------------------

/// Imports a vault project into the local config, **replacing** any local project of the same name.
/// Use [`merge_project`] to combine instead of replace.
pub async fn import_project(
    tendril_home: &Path,
    request: &VaultImportRequest,
    vault_id: Option<&str>,
) -> Result<VaultResult> {
    import_project_with(tendril_home, request, vault_id, &production_gh).await
}

/// The `ImportProjectAsync(projectName, localRepoMappings, vaultId)` overload.
pub async fn import_project_with_mappings(
    tendril_home: &Path,
    project_name: &str,
    local_repo_mappings: BTreeMap<String, String>,
    vault_id: Option<&str>,
) -> Result<VaultResult> {
    let request = VaultImportRequest {
        project_name: project_name.to_string(),
        local_repo_mappings,
        source_vault_id: vault_id.map(|id| id.to_string()),
        ..Default::default()
    };
    import_project(tendril_home, &request, vault_id).await
}

pub async fn import_project_with(
    tendril_home: &Path,
    request: &VaultImportRequest,
    vault_id: Option<&str>,
    gh: GhRunner<'_>,
) -> Result<VaultResult> {
    let (mut settings, mut state) = load_state(tendril_home)?;
    let Some(vault) = resolve_vault(&state, request.source_vault_id.as_deref().or(vault_id)) else {
        return Ok(VaultResult::failure_with_message(
            "No vault configured for import.",
            "Vault not found",
        ));
    };

    let manifest = match read_project_manifest(tendril_home, &vault, &request.project_name) {
        Ok(manifest) => manifest,
        Err(result) => return Ok(result),
    };

    let final_name = resolve_import_target_name(&settings, &vault, request, &manifest);

    append_verification_definitions(&mut settings, &manifest);

    let mut repos = Vec::new();
    for repo in &manifest.repos {
        let path = resolve_repo_path(request, repo);
        clone_repo_if_missing(&path, repo, gh).await;
        repos.push(RepoRef {
            path: path.to_string_lossy().to_string(),
            base_branch: repo.base_branch.clone(),
            extra: Default::default(),
        });
    }

    let imported = ProjectConfig {
        name: final_name.clone(),
        color: manifest.color.clone(),
        repos,
        verifications: filter_by_name(
            &manifest.verifications,
            request.selected_verifications.as_ref(),
            |verification: &ProjectVerificationRef| verification.name.clone(),
        ),
        context: manifest.context.clone(),
        stack_hash: manifest.stack_hash.clone(),
        review_actions: filter_by_name(
            &manifest.review_actions,
            request.selected_review_actions.as_ref(),
            |action: &ReviewActionConfig| action.name.clone(),
        ),
        build_dependencies: manifest.build_dependencies.clone(),
        mcp_servers: filter_by_name(
            &manifest.mcp_servers,
            request.selected_mcps.as_ref(),
            |server: &ProjectMcpServerRef| server.name.clone(),
        ),
        ..Default::default()
    };

    match settings
        .projects
        .iter()
        .position(|project| project.name.eq_ignore_ascii_case(&final_name))
    {
        Some(index) => settings.projects[index] = imported,
        None => settings.projects.push(imported),
    }

    let project_dir = vault_project_dir(tendril_home, &vault, &request.project_name);
    copy_selected(
        &project_dir.join("skills"),
        &get_project_skills_dir(tendril_home, &final_name),
        "md",
        request.selected_skills.as_ref(),
        true,
    )?;
    copy_selected(
        &project_dir.join("memory"),
        &get_project_memory_dir(tendril_home, &final_name),
        "md",
        request.selected_memories.as_ref(),
        false,
    )?;
    copy_permissions(&project_dir, tendril_home, &final_name, request)?;

    let tracking = ProjectVaultTracking {
        vault_project_name: Some(request.project_name.clone()),
        installed_version: manifest.version.clone(),
        installed_at: Some(Utc::now()),
        vault_id: Some(vault.id.clone()),
        vault_repo_url: Some(vault.repo_url.clone()),
        local_repo_paths: request.local_repo_mappings.clone(),
    };
    let key = final_name.clone();
    update_vault(&mut state, &vault.id, |vault| {
        vault.tracked_projects.insert(key.clone(), tracking.clone());
    });

    persist(tendril_home, &mut settings, &state)?;

    Ok(VaultResult::ok(format!(
        "Successfully imported project '{}' (v{})",
        final_name, manifest.version
    )))
}

/// Merges a vault project into an existing local project.
///
/// The conflict rules are the point of this function: verifications are appended only when absent
/// (local wins, because a local verification may have been tuned deliberately), while review actions
/// and MCP servers are overwritten by name (vault wins, because those are the shared team definition).
/// Existing `repos` are preserved untouched.
pub fn merge_project(
    tendril_home: &Path,
    request: &VaultImportRequest,
    vault_id: Option<&str>,
) -> Result<VaultResult> {
    let (mut settings, mut state) = load_state(tendril_home)?;
    let Some(vault) = resolve_vault(&state, request.source_vault_id.as_deref().or(vault_id)) else {
        return Ok(VaultResult::failure_with_message(
            "No vault configured for import.",
            "Vault not found",
        ));
    };

    let manifest = match read_project_manifest(tendril_home, &vault, &request.project_name) {
        Ok(manifest) => manifest,
        Err(result) => return Ok(result),
    };

    let target_name = match request
        .target_local_project_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        Some(name) => name.to_string(),
        None => request.project_name.clone(),
    };

    let Some(index) = settings
        .projects
        .iter()
        .position(|project| project.name.eq_ignore_ascii_case(&target_name))
    else {
        return Ok(VaultResult::failure_with_message(
            format!(
                "Local project '{}' was not found to merge with.",
                target_name
            ),
            "Project not found",
        ));
    };

    let final_name = settings.projects[index].name.clone();
    append_verification_definitions(&mut settings, &manifest);

    let verifications = filter_by_name(
        &manifest.verifications,
        request.selected_verifications.as_ref(),
        |verification: &ProjectVerificationRef| verification.name.clone(),
    );
    let review_actions = filter_by_name(
        &manifest.review_actions,
        request.selected_review_actions.as_ref(),
        |action: &ReviewActionConfig| action.name.clone(),
    );
    let mcp_servers = filter_by_name(
        &manifest.mcp_servers,
        request.selected_mcps.as_ref(),
        |server: &ProjectMcpServerRef| server.name.clone(),
    );

    {
        let project = &mut settings.projects[index];

        for verification in verifications {
            if !project
                .verifications
                .iter()
                .any(|existing| existing.name.eq_ignore_ascii_case(&verification.name))
            {
                project.verifications.push(verification);
            }
        }

        for action in review_actions {
            match project
                .review_actions
                .iter()
                .position(|existing| existing.name.eq_ignore_ascii_case(&action.name))
            {
                Some(existing) => project.review_actions[existing] = action,
                None => project.review_actions.push(action),
            }
        }

        for server in mcp_servers {
            match project
                .mcp_servers
                .iter()
                .position(|existing| existing.name.eq_ignore_ascii_case(&server.name))
            {
                Some(existing) => project.mcp_servers[existing] = server,
                None => project.mcp_servers.push(server),
            }
        }
    }

    let project_dir = vault_project_dir(tendril_home, &vault, &request.project_name);
    copy_selected(
        &project_dir.join("skills"),
        &get_project_skills_dir(tendril_home, &final_name),
        "md",
        request.selected_skills.as_ref(),
        true,
    )?;
    copy_selected(
        &project_dir.join("memory"),
        &get_project_memory_dir(tendril_home, &final_name),
        "md",
        request.selected_memories.as_ref(),
        false,
    )?;
    copy_permissions(&project_dir, tendril_home, &final_name, request)?;

    // Request mappings first, then every existing repository keyed by folder name, so a merge does not
    // forget where the user already has things checked out.
    let mut local_repo_paths = request.local_repo_mappings.clone();
    for (folder, path) in repo_paths_by_folder(&settings.projects[index].repos) {
        local_repo_paths.entry(folder).or_insert(path);
    }

    let tracking = ProjectVaultTracking {
        vault_project_name: Some(request.project_name.clone()),
        installed_version: manifest.version.clone(),
        installed_at: Some(Utc::now()),
        vault_id: Some(vault.id.clone()),
        vault_repo_url: Some(vault.repo_url.clone()),
        local_repo_paths,
    };
    let key = final_name.clone();
    update_vault(&mut state, &vault.id, |vault| {
        vault.tracked_projects.insert(key.clone(), tracking.clone());
    });

    persist(tendril_home, &mut settings, &state)?;

    Ok(VaultResult::ok(format!(
        "Successfully merged project '{}' (v{})",
        final_name, manifest.version
    )))
}

/// Copies `permissions.yaml` verbatim. It is never parsed: an agent permission policy the local build
/// does not understand must not be silently rewritten into something narrower or wider.
fn copy_permissions(
    project_dir: &Path,
    tendril_home: &Path,
    project_name: &str,
    request: &VaultImportRequest,
) -> Result<()> {
    if !request.import_permissions {
        return Ok(());
    }

    let source = project_dir.join("permissions.yaml");
    if !source.exists() {
        return Ok(());
    }

    let target_dir = crate::config::get_project_root_dir(tendril_home, project_name);
    std::fs::create_dir_all(&target_dir)?;
    std::fs::copy(source, target_dir.join("permissions.yaml"))?;
    Ok(())
}

/// Where a project lives inside a vault clone. Public so a route handler can answer 404 for a project
/// the vault does not contain, instead of reporting the service's generic failure.
pub fn vault_project_dir(
    tendril_home: &Path,
    vault: &VaultSettings,
    project_name: &str,
) -> PathBuf {
    vault_dir(tendril_home, Some(vault))
        .join("projects")
        .join(project_name)
}

fn read_project_manifest(
    tendril_home: &Path,
    vault: &VaultSettings,
    project_name: &str,
) -> std::result::Result<VaultProjectManifest, VaultResult> {
    let project_dir = vault_project_dir(tendril_home, vault, project_name);
    if !project_dir.exists() {
        return Err(VaultResult::failure_with_message(
            format!(
                "Project '{}' was not found in vault '{}'.",
                project_name, vault.name
            ),
            "Directory not found",
        ));
    }

    let manifest_path = project_dir.join("project.yaml");
    if !manifest_path.exists() {
        return Err(VaultResult::failure_with_message(
            format!("Project manifest for '{}' missing.", project_name),
            "project.yaml missing",
        ));
    }

    read_yaml::<VaultProjectManifest>(&manifest_path).map_err(|e| {
        VaultResult::failure_with_message(
            format!(
                "Project manifest for '{}' could not be parsed.",
                project_name
            ),
            e.to_string(),
        )
    })
}

/// An explicit target name, else an existing tracking key that still resolves to a local project (so a
/// re-import updates what the user already has rather than creating a duplicate), else the manifest's
/// own name.
fn resolve_import_target_name(
    settings: &TendrilSettings,
    vault: &VaultSettings,
    request: &VaultImportRequest,
    manifest: &VaultProjectManifest,
) -> String {
    if let Some(name) = request
        .target_local_project_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return name.to_string();
    }

    let tracked = vault.tracked_projects.iter().find(|(key, tracking)| {
        tracking
            .vault_project_name
            .as_deref()
            .map(|name| !name.is_empty() && name.eq_ignore_ascii_case(&request.project_name))
            .unwrap_or(false)
            || key.eq_ignore_ascii_case(&request.project_name)
    });

    if let Some((key, _)) = tracked {
        if settings
            .projects
            .iter()
            .any(|project| project.name.eq_ignore_ascii_case(key))
        {
            return key.clone();
        }
    }

    manifest.name.clone()
}

/// Appends any verification definition the local config does not already have, by name.
fn append_verification_definitions(
    settings: &mut TendrilSettings,
    manifest: &VaultProjectManifest,
) {
    for definition in &manifest.verification_definitions {
        if !settings
            .verifications
            .iter()
            .any(|existing| existing.name.eq_ignore_ascii_case(&definition.name))
        {
            settings.verifications.push(definition.clone());
        }
    }
}

/// An `<owner>/<name>` mapping, then a bare `<name>` mapping, then `~/git/<name>`.
fn resolve_repo_path(request: &VaultImportRequest, repo: &VaultRepoRef) -> PathBuf {
    let qualified = format!("{}/{}", repo.owner, repo.name);
    if let Some(path) = request
        .local_repo_mappings
        .get(&qualified)
        .or_else(|| request.local_repo_mappings.get(&repo.name))
    {
        return PathBuf::from(path);
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join("git").join(&repo.name)
}

/// Best-effort clone when the resolved path does not exist: `git clone`, then `gh repo clone`. A
/// failure is logged and skipped — the import still records the path, so the user can clone it later.
async fn clone_repo_if_missing(path: &Path, repo: &VaultRepoRef, gh: GhRunner<'_>) {
    let Some(remote_url) = repo
        .remote_url
        .as_deref()
        .filter(|url| !url.trim().is_empty())
    else {
        return;
    };
    if path.exists() {
        return;
    }

    let Some(parent) = path.parent() else { return };
    if let Err(e) = std::fs::create_dir_all(parent) {
        tracing::warn!("Failed to create {} for clone: {}", parent.display(), e);
        return;
    }

    // A vault's `remoteUrl` is whatever the team wrote into it, credentials included.
    let safe_url = redact_credentials(remote_url);
    tracing::info!("Cloning repository {} into {}...", safe_url, path.display());
    git_run(
        parent,
        &["clone", remote_url, path.to_string_lossy().as_ref()],
    );

    if path.join(".git").exists() {
        return;
    }

    let result = gh(
        argv(&[
            "repo",
            "clone",
            &format!("{}/{}", repo.owner, repo.name),
            path.to_string_lossy().as_ref(),
        ]),
        None,
    )
    .await;
    if let Err(e) = result {
        tracing::warn!(
            "Failed to auto-clone {}: {}",
            safe_url,
            redact_credentials(&e.to_string())
        );
    }
}
