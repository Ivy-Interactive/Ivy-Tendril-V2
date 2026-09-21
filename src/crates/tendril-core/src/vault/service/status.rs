//! `get_status` — the per-vault clone/branch/dirty summary the Settings UI polls.// ---------------------------------------------------------------------------------------------

use super::internals::{git_out, load_state, persist, update_vault};
use crate::config::TendrilSettings;
use crate::error::Result;
use crate::vault::models::*;
use crate::vault::settings::{
    extract_repo_name, resolve_vault, vault_dir, VaultSettings, VaultState,
};
use chrono::{DateTime, Utc};
use std::path::Path;

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
