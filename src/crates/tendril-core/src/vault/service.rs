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

use crate::config::{
    get_config_path, get_project_memory_dir, get_project_skills_dir, load_config, save_config,
    TendrilSettings,
};
use crate::error::{Result, TendrilError};
use crate::git::clone::redact_credentials;
use crate::git::coauthor_hooks::trailer_line;
use crate::git::issues::run_gh_command_raw;
use crate::git::service::run_git;
use crate::models::{
    ProjectConfig, ProjectMcpServerRef, ProjectVerificationRef, RepoRef, ReviewActionConfig,
};
use crate::vault::assets::{file_names, file_stems};
use crate::vault::models::*;
use crate::vault::sanitizer::{sanitize_mcp_servers, sanitize_mcp_servers_value};
use crate::vault::settings::{
    ensure_vaults_initialized, extract_repo_name, load_vaults, new_vault_id, normalize_repo_url,
    resolve_vault, save_vaults, split_owner_and_name, vault_dir, vault_index, ProjectVaultTracking,
    VaultSettings, VaultState,
};
use chrono::{DateTime, Utc};
use futures_util::future::BoxFuture;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// A `gh` invocation yielding `(exit_code, stdout, stderr)`.
///
/// `'static` because the arguments are owned: a runner borrows nothing from its caller, which keeps the
/// future's lifetime out of [`GhRunner`] and lets a test pass a stub held in a local variable.
pub type GhFuture = BoxFuture<'static, Result<(i32, String, String)>>;

/// The injectable `gh` seam. Production code passes [`production_gh`]; tests pass a stub, and a
/// *panicking* stub on any path that must not touch `gh` at all.
pub type GhRunner<'a> = &'a (dyn Fn(Vec<String>, Option<PathBuf>) -> GhFuture + Send + Sync);

/// The real `gh` CLI, via the shared [`run_gh_command_raw`] entry point.
pub fn production_gh(argv: Vec<String>, working_dir: Option<PathBuf>) -> GhFuture {
    Box::pin(async move { run_gh_command_raw(&argv, working_dir.as_deref()).await })
}

fn argv(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

/// `yyyy.MM.dd.HHmmss` in UTC, matching the versions already written by the C# app.
pub fn generate_version_timestamp() -> String {
    Utc::now().format("%Y.%m.%d.%H%M%S").to_string()
}

fn branch_timestamp() -> String {
    Utc::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Loads settings plus healed vault state.
pub fn load_state(tendril_home: &Path) -> Result<(TendrilSettings, VaultState)> {
    let settings = load_config(&get_config_path(tendril_home))?;
    let mut state = load_vaults(&settings);
    ensure_vaults_initialized(&mut state);
    Ok((settings, state))
}

/// Writes vault state — and any project or verification edits — back into `config.yaml`.
pub fn persist(
    tendril_home: &Path,
    settings: &mut TendrilSettings,
    state: &VaultState,
) -> Result<()> {
    save_vaults(settings, state);
    save_config(&get_config_path(tendril_home), settings)
}

/// Applies a mutation to the stored vault *and* to the `vault:` primary alias when it points at the
/// same vault, keeping the two copies of a primary vault in step.
fn update_vault(state: &mut VaultState, vault_id: &str, mutate: impl Fn(&mut VaultSettings)) {
    if let Some(index) = vault_index(state, vault_id) {
        mutate(&mut state.vaults[index]);
    }
    if let Some(primary) = state.primary.as_mut() {
        if primary.id.eq_ignore_ascii_case(vault_id) {
            mutate(primary);
        }
    }
}

fn git_out(dir: &Path, args: &[&str]) -> String {
    match run_git(args, dir) {
        Ok((0, stdout, _)) => stdout.trim().to_string(),
        _ => String::new(),
    }
}

fn git_run(dir: &Path, args: &[&str]) -> (i32, String, String) {
    run_git(args, dir).unwrap_or((-1, String::new(), String::new()))
}

/// `git commit` in the vault, carrying the configured `Co-Authored-By` trailer.
///
/// The vault's commits cannot be reached by the hook shim in [`crate::git::coauthor_hooks`]: they run
/// in this daemon process via [`git_run`], not in an agent Tendril spawns, so no `GIT_CONFIG_*`
/// override is in effect. Since these are Rust building an argv rather than an LLM composing a
/// command, `--trailer` is exact and needs no hook at all.
///
/// `--trailer` rather than appending to the `-m` text so that git owns the placement: the trailer
/// lands in the existing trailer block when the message already has one, and the vault's two-`-m`
/// form (subject plus changelog) keeps its blank-line separation.
fn git_commit(
    dir: &Path,
    settings: &TendrilSettings,
    message_args: &[&str],
) -> (i32, String, String) {
    let mut args: Vec<&str> = vec!["commit"];
    args.extend_from_slice(message_args);

    let trailer = settings.co_author_identity().map(trailer_line);
    if let Some(trailer) = trailer.as_deref() {
        args.push("--trailer");
        args.push(trailer);
    }

    git_run(dir, &args)
}

fn write_yaml<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_yaml::to_string(value)?)?;
    Ok(())
}

fn read_yaml<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    Ok(serde_yaml::from_str(&std::fs::read_to_string(path)?)?)
}

/// A GitHub compare URL, used when `gh pr create` fails — the reference treats that as success with a
/// link the user can click.
fn compare_url(repo_url: &str, base_branch: &str, branch: &str) -> Option<String> {
    let (owner, name) = split_owner_and_name(repo_url)?;
    Some(format!(
        "https://github.com/{}/{}/compare/{}...{}?expand=1",
        owner, name, base_branch, branch
    ))
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

/// Status for each **enabled** vault.
pub fn get_vaults(tendril_home: &Path) -> Result<Vec<VaultStatus>> {
    let (mut settings, mut state) = load_state(tendril_home)?;
    let enabled: Vec<VaultSettings> = state
        .vaults
        .iter()
        .filter(|vault| vault.enabled)
        .cloned()
        .collect();

    let mut statuses = Vec::new();
    let mut backfills = Vec::new();
    for vault in &enabled {
        let (status, backfill) = build_status(tendril_home, Some(vault));
        if let Some(timestamp) = backfill {
            backfills.push((vault.id.clone(), timestamp));
        }
        statuses.push(status);
    }

    apply_backfills(tendril_home, &mut settings, &mut state, backfills)?;
    Ok(statuses)
}

pub fn get_status(tendril_home: &Path, vault_id: Option<&str>) -> Result<VaultStatus> {
    let (mut settings, mut state) = load_state(tendril_home)?;
    let vault = resolve_vault(&state, vault_id);
    let (status, backfill) = build_status(tendril_home, vault.as_ref());

    if let (Some(vault), Some(timestamp)) = (vault.as_ref(), backfill) {
        apply_backfills(
            tendril_home,
            &mut settings,
            &mut state,
            vec![(vault.id.clone(), timestamp)],
        )?;
    }

    Ok(status)
}

/// Persists any `lastSyncedAt` values [`build_status`] derived from git history. Kept out of the
/// status builder so that reading a status stays a pure function of the filesystem.
fn apply_backfills(
    tendril_home: &Path,
    settings: &mut TendrilSettings,
    state: &mut VaultState,
    backfills: Vec<(String, DateTime<Utc>)>,
) -> Result<()> {
    if backfills.is_empty() {
        return Ok(());
    }
    for (vault_id, timestamp) in backfills {
        update_vault(state, &vault_id, |vault| {
            vault.last_synced_at = Some(timestamp)
        });
    }
    persist(tendril_home, settings, state)
}

/// Builds a [`VaultStatus`], plus the `lastSyncedAt` to persist when the stored one is absent — which
/// includes the C# `0001-01-01` sentinel, read as `None` by [`crate::vault::compat`].
fn build_status(
    tendril_home: &Path,
    vault: Option<&VaultSettings>,
) -> (VaultStatus, Option<DateTime<Utc>>) {
    let dir = vault_dir(tendril_home, vault);

    let configured = vault
        .map(|vault| vault.enabled && !vault.repo_url.is_empty() && dir.exists())
        .unwrap_or(false);

    if !configured {
        let status = VaultStatus {
            id: vault.map(|vault| vault.id.clone()).unwrap_or_default(),
            name: vault
                .map(|vault| {
                    if vault.name.is_empty() {
                        extract_repo_name(&vault.repo_url)
                    } else {
                        vault.name.clone()
                    }
                })
                .unwrap_or_default(),
            is_configured: false,
            repo_url: vault
                .map(|vault| vault.repo_url.clone())
                .unwrap_or_default(),
            local_path: dir.to_string_lossy().to_string(),
            always_up_to_date: vault.map(|vault| vault.always_up_to_date).unwrap_or(false),
            last_synced_at: vault.and_then(|vault| vault.last_synced_at),
            ..Default::default()
        };
        return (status, None);
    }

    let vault = vault.expect("a configured vault is present");
    let branch = git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let commit = git_out(&dir, &["rev-parse", "--short", "HEAD"]);

    // `origin/main` may not exist yet, or we may be offline. Neither is an error.
    let mut ahead = 0;
    let mut behind = 0;
    let counts = git_out(
        &dir,
        &["rev-list", "--left-right", "--count", "origin/main...HEAD"],
    );
    let counts: Vec<&str> = counts.split_whitespace().collect();
    if counts.len() == 2 {
        behind = counts[0].parse().unwrap_or(0);
        ahead = counts[1].parse().unwrap_or(0);
    }

    let mut last_synced = vault.last_synced_at;
    let mut backfill = None;
    if last_synced.is_none() && dir.join(".git").exists() {
        let committed = git_out(&dir, &["log", "-1", "--format=%cI"]);
        if let Ok(parsed) = DateTime::parse_from_rfc3339(committed.trim()) {
            let parsed = parsed.with_timezone(&Utc);
            last_synced = Some(parsed);
            backfill = Some(parsed);
        }
    }

    let status = VaultStatus {
        id: vault.id.clone(),
        name: vault.name.clone(),
        is_configured: true,
        repo_url: vault.repo_url.clone(),
        local_path: dir.to_string_lossy().to_string(),
        current_branch: if branch.is_empty() {
            "main".to_string()
        } else {
            branch
        },
        latest_commit: (!commit.is_empty()).then_some(commit),
        commits_ahead: ahead,
        commits_behind: behind,
        last_synced_at: last_synced,
        always_up_to_date: vault.always_up_to_date,
    };

    (status, backfill)
}

// ---------------------------------------------------------------------------------------------
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

fn build_catalog(
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
fn match_tracking(
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

// ---------------------------------------------------------------------------------------------
// GitHub discovery
// ---------------------------------------------------------------------------------------------

/// The signed-in user (as `Personal`) followed by their organizations.
pub async fn list_github_accounts() -> Result<Vec<GitHubAccountOption>> {
    list_github_accounts_with(&production_gh).await
}

pub async fn list_github_accounts_with(gh: GhRunner<'_>) -> Result<Vec<GitHubAccountOption>> {
    let mut accounts = Vec::new();

    let (code, stdout, _) = gh(argv(&["api", "user", "--jq", ".login"]), None).await?;
    let login = stdout.trim().to_string();
    // A `{`-prefixed body is a JSON error payload, not a login.
    if code == 0 && !login.is_empty() && !login.starts_with('{') {
        accounts.push(GitHubAccountOption {
            login,
            account_type: "Personal".to_string(),
        });
    }

    let (code, stdout, _) = gh(argv(&["api", "user/orgs", "--jq", ".[].login"]), None).await?;
    if code == 0 {
        for org in stdout.lines().map(str::trim).filter(|org| !org.is_empty()) {
            accounts.push(GitHubAccountOption {
                login: org.to_string(),
                account_type: "Organization".to_string(),
            });
        }
    }

    Ok(accounts)
}

/// Looks for vault repositories across the user's accounts and organizations: the conventional
/// `Tendril-Vault` first, then any repository whose name contains `vault`. Already-connected repos are
/// filtered out by normalized URL, so the SSH and HTTPS spellings of one repo cannot both show up.
pub async fn discover_existing_vaults(tendril_home: &Path) -> Result<Vec<DiscoveredVaultRepo>> {
    discover_existing_vaults_with(tendril_home, &production_gh).await
}

pub async fn discover_existing_vaults_with(
    tendril_home: &Path,
    gh: GhRunner<'_>,
) -> Result<Vec<DiscoveredVaultRepo>> {
    let (_, state) = load_state(tendril_home)?;
    let mut seen: BTreeSet<String> = state
        .vaults
        .iter()
        .filter(|vault| !vault.repo_url.trim().is_empty())
        .map(|vault| normalize_repo_url(&vault.repo_url))
        .collect();

    let mut discovered = Vec::new();

    for account in list_github_accounts_with(gh).await? {
        let (code, stdout, _) = gh(
            argv(&[
                "api",
                &format!("repos/{}/Tendril-Vault", account.login),
                "--jq",
                "{fullName: .full_name, url: .html_url, isPrivate: .private}",
            ]),
            None,
        )
        .await?;

        if code == 0 && !stdout.trim().is_empty() {
            match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                Ok(value) => {
                    let full_name = value
                        .get("fullName")
                        .and_then(|value| value.as_str())
                        .map(|name| name.to_string())
                        .unwrap_or_else(|| format!("{}/Tendril-Vault", account.login));
                    let url = value
                        .get("url")
                        .and_then(|value| value.as_str())
                        .map(|url| url.to_string())
                        .unwrap_or_else(|| format!("https://github.com/{}.git", full_name));
                    let is_private = value
                        .get("isPrivate")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);

                    if seen.insert(normalize_repo_url(&url)) {
                        discovered.push(DiscoveredVaultRepo {
                            full_name,
                            repo_url: url,
                            owner: account.login.clone(),
                            name: "Tendril-Vault".to_string(),
                            is_private,
                            account_type: account.account_type.clone(),
                        });
                    }
                }
                Err(e) => tracing::debug!(
                    "Failed parsing Tendril-Vault for account {}: {}",
                    account.login,
                    e
                ),
            }
        }

        let (code, stdout, _) = gh(
            argv(&[
                "repo",
                "list",
                &account.login,
                "--limit",
                "30",
                "--json",
                "nameWithOwner,url,isPrivate,name",
            ]),
            None,
        )
        .await?;

        if code != 0 || stdout.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
            Ok(serde_json::Value::Array(items)) => {
                for item in items {
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let full_name = item
                        .get("nameWithOwner")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let url = item.get("url").and_then(|v| v.as_str()).unwrap_or_default();
                    let is_private = item
                        .get("isPrivate")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    if !name.to_lowercase().contains("vault") {
                        continue;
                    }
                    if seen.insert(normalize_repo_url(url)) {
                        discovered.push(DiscoveredVaultRepo {
                            full_name: full_name.to_string(),
                            repo_url: url.to_string(),
                            owner: account.login.clone(),
                            name: name.to_string(),
                            is_private,
                            account_type: account.account_type.clone(),
                        });
                    }
                }
            }
            Ok(_) => {}
            Err(e) => tracing::debug!(
                "Failed parsing repo list for account {}: {}",
                account.login,
                e
            ),
        }
    }

    Ok(discovered)
}

// ---------------------------------------------------------------------------------------------
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

fn repo_paths_by_folder(repos: &[RepoRef]) -> BTreeMap<String, String> {
    repos
        .iter()
        .filter_map(|repo| {
            PathBuf::from(&repo.path)
                .file_name()
                .map(|name| (name.to_string_lossy().to_string(), repo.path.clone()))
        })
        .collect()
}

/// Opens the PR, falling back to a compare URL when `gh pr create` fails — the branch is already
/// pushed, so handing the user a link is more useful than reporting a failure.
#[allow(clippy::too_many_arguments)]
async fn create_vault_pr(
    gh: GhRunner<'_>,
    dir: &Path,
    title: &str,
    body: &str,
    base_branch: &str,
    branch: &str,
    reviewers: &[String],
    repo_url: &str,
) -> Result<Option<String>> {
    let mut args = argv(&[
        "pr",
        "create",
        "--title",
        title,
        "--body",
        body,
        "--base",
        base_branch,
        "--head",
        branch,
    ]);
    if !reviewers.is_empty() {
        args.push("--reviewer".to_string());
        args.push(reviewers.join(","));
    }

    let (code, stdout, stderr) = gh(args, Some(dir.to_path_buf())).await?;
    if code != 0 {
        tracing::warn!("gh pr create error in vault: {}", stderr.trim());
    }

    let url = stdout.trim().to_string();
    if url.to_lowercase().starts_with("http") {
        return Ok(Some(url));
    }

    Ok(compare_url(repo_url, base_branch, branch))
}

/// `None` means "everything"; otherwise keep the entries whose name is selected.
fn filter_by_name<T: Clone>(
    items: &[T],
    selected: Option<&Vec<String>>,
    name_of: impl Fn(&T) -> String,
) -> Vec<T> {
    match selected {
        None => items.to_vec(),
        Some(selected) => {
            let allowed: BTreeSet<String> =
                selected.iter().map(|name| name.to_lowercase()).collect();
            items
                .iter()
                .filter(|item| allowed.contains(&name_of(item).to_lowercase()))
                .cloned()
                .collect()
        }
    }
}

/// Copies `*.<extension>` between directories, honouring a selection. `by_stem` selects on the name
/// without its extension (skills) rather than the full file name (memories).
fn copy_selected(
    from: &Path,
    to: &Path,
    extension: &str,
    selected: Option<&Vec<String>>,
    by_stem: bool,
) -> Result<()> {
    if !from.exists() {
        return Ok(());
    }

    let allowed: Option<BTreeSet<String>> =
        selected.map(|names| names.iter().map(|name| name.to_lowercase()).collect());

    let names = if by_stem {
        file_stems(from, extension)
    } else {
        file_names(from, extension)
    };
    if names.is_empty() {
        return Ok(());
    }

    std::fs::create_dir_all(to)?;
    for name in names {
        if let Some(allowed) = &allowed {
            if !allowed.contains(&name.to_lowercase()) {
                continue;
            }
        }
        let file_name = if by_stem {
            format!("{}.{}", name, extension)
        } else {
            name
        };
        std::fs::copy(from.join(&file_name), to.join(&file_name))?;
    }

    Ok(())
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

// ---------------------------------------------------------------------------------------------
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

/// Resolves the vault's base branch, bootstrapping `main` when the remote has neither `main` nor
/// `master` yet — a freshly created repository has no branches at all, and every other operation here
/// needs something to branch from.
async fn ensure_base_branch(
    dir: &Path,
    vault: &mut VaultSettings,
    _gh: GhRunner<'_>,
) -> Result<String> {
    if !git_out(dir, &["ls-remote", "--heads", "origin", "main"]).is_empty() {
        git_run(dir, &["fetch", "origin", "main"]);
        return Ok("main".to_string());
    }

    if !git_out(dir, &["ls-remote", "--heads", "origin", "master"]).is_empty() {
        git_run(dir, &["fetch", "origin", "master"]);
        return Ok("master".to_string());
    }

    let (code, head, _) = git_run(dir, &["rev-parse", "--verify", "HEAD"]);
    if code != 0 || head.trim().is_empty() {
        std::fs::create_dir_all(dir.join("projects"))?;
        std::fs::create_dir_all(dir.join("global").join("skills"))?;
        write_yaml(
            &dir.join("vault.yaml"),
            &VaultManifest {
                name: vault.name.clone(),
                version: generate_version_timestamp(),
                updated_at: Utc::now(),
                ..Default::default()
            },
        )?;
        std::fs::write(
            dir.join("README.md"),
            format!("# {}\n\nTendril Team Configuration Vault.\n", vault.name),
        )?;
        std::fs::write(dir.join(".gitignore"), ".DS_Store\n*.local.yaml\n")?;

        git_run(dir, &["checkout", "-B", "main"]);
        git_run(dir, &["add", "-A"]);
        git_run(dir, &["commit", "-m", "Initial Tendril Vault setup"]);
    } else {
        git_run(dir, &["checkout", "-B", "main"]);
    }
    git_run(dir, &["push", "-u", "origin", "main"]);

    Ok("main".to_string())
}

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
