//! Creating a vault repository, connecting an existing one, disconnecting, and the
//! always-up-to-date toggle.// ---------------------------------------------------------------------------------------------

use super::internals::{
    argv, ensure_base_branch, generate_version_timestamp, git_commit, git_run, load_state, persist,
    production_gh, read_yaml, update_vault, write_yaml, GhRunner,
};
use crate::error::Result;
use crate::vault::models::*;
use crate::vault::settings::{
    extract_repo_name, new_vault_id, normalize_repo_url, resolve_vault, VaultSettings,
};
use chrono::Utc;
use std::path::Path;

// Create / connect / disconnect
// ---------------------------------------------------------------------------------------------

/// Creates the vault repository on GitHub, initializes the local clone with `vault.yaml`, `projects/`
/// and `global/skills/`, pushes `main`, and connects it as the primary vault.
///
/// A repository that already exists is *connected* rather than reported as an error, so re-running the
/// command after a partial failure converges instead of leaving the user stuck.
pub async fn create_vault_repo(
    tendril_home: &Path,
    repo_name: &str,
    is_private: bool,
    org: Option<&str>,
) -> Result<VaultResult> {
    create_vault_repo_with(tendril_home, repo_name, is_private, org, &production_gh).await
}

pub async fn create_vault_repo_with(
    tendril_home: &Path,
    repo_name: &str,
    is_private: bool,
    org: Option<&str>,
    gh: GhRunner<'_>,
) -> Result<VaultResult> {
    let repo_name = repo_name.trim();

    // The UI offers organizations as `login (Organization)`; keep only the login.
    let org =
        org.map(str::trim)
            .filter(|org| !org.is_empty())
            .map(|org| match org.split_once(' ') {
                Some((login, _)) if !login.is_empty() => login,
                _ => org,
            });

    let target_repo = match org {
        Some(org) => format!("{}/{}", org, repo_name),
        None => repo_name.to_string(),
    };

    if let Some(url) = probe_repo_url(gh, &target_repo).await? {
        return connect_vault_with(tendril_home, &url, Some(repo_name), gh).await;
    }

    let visibility = if is_private { "--private" } else { "--public" };
    let (code, create_stdout, create_stderr) =
        gh(argv(&["repo", "create", &target_repo, visibility]), None).await?;

    if code != 0 {
        // A race, or a repository `gh api` could not see a moment ago. Try connecting before failing.
        if let Some(url) = probe_repo_url(gh, &target_repo).await? {
            return connect_vault_with(tendril_home, &url, Some(repo_name), gh).await;
        }
        return Ok(VaultResult::failure_with_message(
            "Failed to create GitHub repository",
            create_stderr.trim(),
        ));
    }

    let repo_url = match probe_repo_url(gh, &target_repo).await? {
        Some(url) => url,
        None if create_stdout.trim().to_lowercase().starts_with("http") => {
            create_stdout.trim().to_string()
        }
        None => format!("https://github.com/{}.git", target_repo),
    };

    let (mut settings, mut state) = load_state(tendril_home)?;
    let vault_id = new_vault_id();
    let dir = tendril_home.join("Vaults").join(&vault_id);

    tracing::info!(
        "[Vault] Initializing local git repo in '{}' for '{}'",
        dir.display(),
        repo_url
    );

    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;

    git_run(&dir, &["init", "-b", "main"]);
    git_run(&dir, &["remote", "add", "origin", &repo_url]);

    write_yaml(
        &dir.join("vault.yaml"),
        &VaultManifest {
            name: repo_name.to_string(),
            version: generate_version_timestamp(),
            updated_at: Utc::now(),
            ..Default::default()
        },
    )?;
    std::fs::write(dir.join(".gitignore"), ".DS_Store\n*.local.yaml\n")?;
    std::fs::write(
        dir.join("README.md"),
        format!("# {}\n\nTendril Team Configuration Vault.\n", repo_name),
    )?;
    std::fs::create_dir_all(dir.join("projects"))?;
    std::fs::create_dir_all(dir.join("global").join("skills"))?;

    git_run(&dir, &["add", "-A"]);
    git_commit(&dir, &settings, &["-m", "Initial Tendril Vault setup"]);
    git_run(&dir, &["push", "-u", "origin", "main"]);

    let created = VaultSettings {
        id: vault_id,
        name: repo_name.to_string(),
        enabled: true,
        repo_url,
        local_path: dir.to_string_lossy().to_string(),
        always_up_to_date: false,
        last_synced_at: Some(Utc::now()),
        ..Default::default()
    };

    state.vaults.push(created.clone());
    state.primary = Some(created);
    persist(tendril_home, &mut settings, &state)?;

    Ok(VaultResult::ok(format!(
        "Created and connected vault repository '{}'",
        target_repo
    )))
}

/// `gh api repos/<target> --jq .html_url`, returning the URL only when the repository really resolves.
async fn probe_repo_url(gh: GhRunner<'_>, target_repo: &str) -> Result<Option<String>> {
    let (code, stdout, _) = gh(
        argv(&[
            "api",
            &format!("repos/{}", target_repo),
            "--jq",
            ".html_url",
        ]),
        None,
    )
    .await?;

    let url = stdout.trim().to_string();
    if code == 0 && url.to_lowercase().starts_with("http") {
        Ok(Some(url))
    } else {
        Ok(None)
    }
}

/// Clones an existing vault repository and records it. The vault name is the caller's custom name, else
/// the cloned `vault.yaml`'s name, else the `owner/name` of the URL.
pub async fn connect_vault(
    tendril_home: &Path,
    repo_url: &str,
    custom_name: Option<&str>,
) -> Result<VaultResult> {
    connect_vault_with(tendril_home, repo_url, custom_name, &production_gh).await
}

pub async fn connect_vault_with(
    tendril_home: &Path,
    repo_url: &str,
    custom_name: Option<&str>,
    gh: GhRunner<'_>,
) -> Result<VaultResult> {
    if repo_url.trim().is_empty() {
        return Ok(VaultResult::failure_with_message(
            "Repository URL cannot be empty",
            "Empty URL",
        ));
    }

    let (mut settings, mut state) = load_state(tendril_home)?;

    let normalized = normalize_repo_url(repo_url);
    if let Some(existing) = state
        .vaults
        .iter()
        .find(|vault| normalize_repo_url(&vault.repo_url) == normalized)
    {
        return Ok(VaultResult::failure_with_message(
            format!(
                "This repository is already connected as '{}'.",
                existing.name
            ),
            "Duplicate vault connection",
        ));
    }

    let vault_id = new_vault_id();
    let dir = tendril_home.join("Vaults").join(&vault_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    let parent = dir.parent().unwrap_or(tendril_home).to_path_buf();
    std::fs::create_dir_all(&parent)?;

    let (_, _, clone_stderr) = git_run(
        &parent,
        &["clone", repo_url, dir.to_string_lossy().as_ref()],
    );
    if !dir.join(".git").exists() {
        return Ok(VaultResult::failure_with_message(
            "Failed to clone vault repository",
            clone_stderr.trim(),
        ));
    }

    let mut vault_name = match custom_name.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => name.to_string(),
        None => extract_repo_name(repo_url),
    };
    let manifest_path = dir.join("vault.yaml");
    if manifest_path.exists() {
        if let Ok(manifest) = read_yaml::<VaultManifest>(&manifest_path) {
            if !manifest.name.trim().is_empty() {
                vault_name = manifest.name;
            }
        }
    }

    let mut connected = VaultSettings {
        id: vault_id,
        name: vault_name.clone(),
        enabled: true,
        repo_url: repo_url.to_string(),
        local_path: dir.to_string_lossy().to_string(),
        always_up_to_date: false,
        last_synced_at: Some(Utc::now()),
        ..Default::default()
    };

    ensure_base_branch(&dir, &mut connected, gh).await?;

    state.vaults.push(connected.clone());
    if state.primary.is_none() {
        state.primary = Some(connected);
    }
    persist(tendril_home, &mut settings, &state)?;

    Ok(VaultResult::ok(format!(
        "Successfully connected vault '{}'",
        vault_name
    )))
}

/// Forgets a vault. The clone and any imported local projects are deliberately left on disk — a
/// disconnect must never destroy work.
pub fn disconnect_vault(tendril_home: &Path, vault_id: Option<&str>) -> Result<VaultResult> {
    let (mut settings, mut state) = load_state(tendril_home)?;

    if let Some(target) = resolve_vault(&state, vault_id) {
        state
            .vaults
            .retain(|vault| !vault.id.eq_ignore_ascii_case(&target.id));
        if state
            .primary
            .as_ref()
            .map(|primary| primary.id.eq_ignore_ascii_case(&target.id))
            .unwrap_or(false)
        {
            state.primary = state.vaults.iter().find(|vault| vault.enabled).cloned();
        }
        persist(tendril_home, &mut settings, &state)?;
    }

    Ok(VaultResult::ok("Disconnected from vault"))
}

pub fn set_always_up_to_date(
    tendril_home: &Path,
    always_up_to_date: bool,
    vault_id: Option<&str>,
) -> Result<VaultResult> {
    let (mut settings, mut state) = load_state(tendril_home)?;

    if let Some(target) = resolve_vault(&state, vault_id) {
        update_vault(&mut state, &target.id, |vault| {
            vault.always_up_to_date = always_up_to_date
        });
        persist(tendril_home, &mut settings, &state)?;
    }

    Ok(VaultResult::ok(format!(
        "Auto-sync is now {}",
        if always_up_to_date {
            "enabled"
        } else {
            "disabled"
        }
    )))
}
