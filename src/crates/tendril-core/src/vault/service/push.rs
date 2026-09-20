//! `push_and_create_pr` — writing selected local projects into the vault clone on a new branch and
//! opening the PR.// ---------------------------------------------------------------------------------------------

use super::internals::{
    branch_timestamp, copy_selected, create_vault_pr, ensure_base_branch, filter_by_name,
    generate_version_timestamp, git_commit, git_out, git_run, load_state, persist, production_gh,
    read_yaml, repo_paths_by_folder, update_vault, write_yaml, GhRunner,
};
use crate::config::{get_project_memory_dir, get_project_skills_dir};
use crate::error::Result;
use crate::models::{ProjectMcpServerRef, ProjectVerificationRef, RepoRef, ReviewActionConfig};
use crate::vault::models::*;
use crate::vault::sanitizer::{sanitize_mcp_servers, sanitize_mcp_servers_value};
use crate::vault::settings::{
    resolve_vault, split_owner_and_name, vault_dir, ProjectVaultTracking,
};
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------------------------

/// Writes the selected projects into the vault clone on a new `vault/update-<timestamp>` branch, pushes
/// it, and opens a PR.
///
/// Secrets are stripped from every MCP server before it is written, and unmodelled manifest keys are
/// re-emitted verbatim so a teammate's configuration survives an import → push round trip.
pub async fn push_and_create_pr(
    tendril_home: &Path,
    request: &VaultExportRequest,
    vault_id: Option<&str>,
) -> Result<VaultPrResult> {
    push_and_create_pr_with(tendril_home, request, vault_id, &production_gh).await
}

pub async fn push_and_create_pr_with(
    tendril_home: &Path,
    request: &VaultExportRequest,
    vault_id: Option<&str>,
    gh: GhRunner<'_>,
) -> Result<VaultPrResult> {
    let (mut settings, mut state) = load_state(tendril_home)?;
    let Some(mut target) = resolve_vault(&state, request.target_vault_id.as_deref().or(vault_id))
    else {
        return Ok(VaultPrResult::failure(
            "No vault configured to push updates.",
        ));
    };

    let dir = vault_dir(tendril_home, Some(&target));
    if !dir.join(".git").exists() {
        return Ok(VaultPrResult::failure(
            "Vault repository is not initialized locally.",
        ));
    }

    let version = if request.version.trim().is_empty() {
        generate_version_timestamp()
    } else {
        request.version.clone()
    };
    let branch = format!("vault/update-{}", branch_timestamp());

    let base_branch = ensure_base_branch(&dir, &mut target, gh).await?;
    git_run(&dir, &["checkout", &base_branch]);
    git_run(&dir, &["pull", "origin", &base_branch]);
    git_run(&dir, &["checkout", "-B", &branch]);

    let mut exported = Vec::new();

    for project_name in &request.project_names {
        let Some(project) = settings
            .projects
            .iter()
            .find(|project| project.name.eq_ignore_ascii_case(project_name))
            .cloned()
        else {
            continue;
        };

        let project_dir = dir.join("projects").join(&project.name);
        std::fs::create_dir_all(&project_dir)?;

        let selected_skills = request.selected_skills.get(&project.name);
        let selected_mcps = request.selected_mcps.get(&project.name);
        let selected_memories = request.selected_memories.get(&project.name);
        let selected_actions = request.selected_review_actions.get(&project.name);
        let selected_verifications = request.selected_verifications.get(&project.name);

        let repos = collect_repo_refs(&project.repos);

        let verifications: Vec<ProjectVerificationRef> = filter_by_name(
            &project.verifications,
            selected_verifications,
            |verification: &ProjectVerificationRef| verification.name.clone(),
        );
        let review_actions: Vec<ReviewActionConfig> = filter_by_name(
            &project.review_actions,
            selected_actions,
            |action: &ReviewActionConfig| action.name.clone(),
        );

        // Secrets never leave the machine: the selection is filtered first, then sanitized.
        let mcp_servers = sanitize_mcp_servers(&filter_by_name(
            &project.mcp_servers,
            selected_mcps,
            |server: &ProjectMcpServerRef| server.name.clone(),
        ));

        // A vault must be self-contained: carry the definition of every verification it references.
        let referenced: BTreeSet<String> = verifications
            .iter()
            .map(|verification| verification.name.to_lowercase())
            .collect();
        let verification_definitions = settings
            .verifications
            .iter()
            .filter(|definition| referenced.contains(&definition.name.to_lowercase()))
            .cloned()
            .collect();

        // Re-emit everything V2 does not model, sanitizing any MCP servers carried through it too.
        let mut extra = load_existing_extra(&project_dir.join("project.yaml"));
        if let Some(carried) = extra.get("mcpServers").cloned() {
            extra.insert(
                "mcpServers".to_string(),
                sanitize_mcp_servers_value(&carried),
            );
        }

        write_yaml(
            &project_dir.join("project.yaml"),
            &VaultProjectManifest {
                name: project.name.clone(),
                version: version.clone(),
                updated_at: Utc::now(),
                changelog: request.changelog.clone(),
                color: project.color.clone(),
                context: project.context.clone(),
                stack_hash: project.stack_hash.clone(),
                repos,
                verifications,
                verification_definitions,
                review_actions,
                build_dependencies: project.build_dependencies.clone(),
                mcp_servers,
                extra,
                ..Default::default()
            },
        )?;

        copy_selected(
            &get_project_skills_dir(tendril_home, &project.name),
            &project_dir.join("skills"),
            "md",
            selected_skills,
            true,
        )?;
        copy_selected(
            &get_project_memory_dir(tendril_home, &project.name),
            &project_dir.join("memory"),
            "md",
            selected_memories,
            false,
        )?;

        let tracking = ProjectVaultTracking {
            vault_project_name: Some(project.name.clone()),
            installed_version: version.clone(),
            installed_at: Some(Utc::now()),
            vault_id: Some(target.id.clone()),
            vault_repo_url: Some(target.repo_url.clone()),
            local_repo_paths: repo_paths_by_folder(&project.repos),
        };
        let key = project.name.clone();
        update_vault(&mut state, &target.id, |vault| {
            vault.tracked_projects.insert(key.clone(), tracking.clone());
        });

        exported.push(project.name.clone());
    }

    write_yaml(
        &dir.join("vault.yaml"),
        &VaultManifest {
            name: target.name.clone(),
            version: version.clone(),
            updated_at: Utc::now(),
            ..Default::default()
        },
    )?;

    git_run(&dir, &["add", "-A"]);
    let subject = format!("feat(vault): update {} (v{})", exported.join(", "), version);
    if request.changelog.trim().is_empty() {
        git_commit(&dir, &settings, &["-m", &subject]);
    } else {
        git_commit(&dir, &settings, &["-m", &subject, "-m", &request.changelog]);
    }
    git_run(&dir, &["push", "-u", "origin", &branch]);

    let title = if request.pr_title.trim().is_empty() {
        format!("Update {} to v{}", exported.join(", "), version)
    } else {
        request.pr_title.clone()
    };
    let body = if request.pr_body.trim().is_empty() {
        format!(
            "### Vault Version Update: v{}\n\n**Changelog:**\n{}\n\n**Projects:**\n{}",
            version,
            request.changelog,
            exported
                .iter()
                .map(|project| format!("- {}", project))
                .collect::<Vec<_>>()
                .join("\n")
        )
    } else {
        request.pr_body.clone()
    };

    let pr_url = create_vault_pr(
        gh,
        &dir,
        &title,
        &body,
        &base_branch,
        &branch,
        &request.reviewers,
        &target.repo_url,
    )
    .await?;

    git_run(&dir, &["checkout", &base_branch]);
    git_run(&dir, &["pull", "origin", &base_branch]);

    update_vault(&mut state, &target.id, |vault| {
        vault.last_synced_at = Some(Utc::now())
    });
    persist(tendril_home, &mut settings, &state)?;

    Ok(VaultPrResult {
        success: true,
        pr_url,
        branch_name: Some(branch),
        error_message: None,
    })
}

/// Describes each local repository as `owner/name` plus its remote, so an importing teammate can find
/// the same repositories under their own checkout layout.
fn collect_repo_refs(repos: &[RepoRef]) -> Vec<VaultRepoRef> {
    repos
        .iter()
        .map(|repo| {
            let path = PathBuf::from(&repo.path);
            let mut owner = "default".to_string();
            let mut name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            let mut remote_url = String::new();

            if path.exists() {
                let found = git_out(&path, &["config", "--get", "remote.origin.url"]);
                if !found.is_empty() {
                    remote_url = found;
                    if let Some((parsed_owner, parsed_name)) = split_owner_and_name(&remote_url) {
                        owner = parsed_owner;
                        name = parsed_name;
                    }
                }
            }

            VaultRepoRef {
                owner,
                name,
                base_branch: repo.base_branch.clone(),
                remote_url: (!remote_url.is_empty()).then_some(remote_url),
            }
        })
        .collect()
}

/// Reads the unmodelled keys of an existing `project.yaml` so a push preserves them.
fn load_existing_extra(path: &Path) -> BTreeMap<String, serde_json::Value> {
    if !path.exists() {
        return BTreeMap::new();
    }
    read_yaml::<VaultProjectManifest>(path)
        .map(|manifest| manifest.extra)
        .unwrap_or_default()
}
