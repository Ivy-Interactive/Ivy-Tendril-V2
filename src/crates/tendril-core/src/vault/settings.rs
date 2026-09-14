//! Vault configuration, stored inside `TendrilSettings.extra`.
//!
//! The C# app adds `Vault` and `Vaults` properties to its settings class. V2's `TendrilSettings` is
//! shared with the daemon, the app and three round-trip tests that assert unmodelled keys survive, so
//! rather than widening that struct this module reads and writes the two keys through the existing
//! `extra` passthrough map (the `vault-settings-storage` question's recommended `extra-map` option).
//! The on-disk YAML is byte-identical to what the C# app writes either way.
//!
//! `vault:` (singular) is the *primary* vault and is also present in `vaults:`; the two copies are
//! kept in step, because the shipped C# app reads whichever one it happens to reach first.

use crate::config::TendrilSettings;
use crate::vault::compat::{
    deserialize_optional_timestamp, serialize_optional_timestamp,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// The `extra` key holding the primary vault.
pub const VAULT_KEY: &str = "vault";
/// The `extra` key holding every connected vault.
pub const VAULTS_KEY: &str = "vaults";

/// The name the C# app uses before it has resolved a real repository name.
const PLACEHOLDER_VAULT_NAME: &str = "Tendril-Vault";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectVaultTracking {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault_project_name: Option<String>,
    #[serde(default)]
    pub installed_version: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_timestamp",
        serialize_with = "serialize_optional_timestamp"
    )]
    pub installed_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault_repo_url: Option<String>,
    #[serde(default)]
    pub local_repo_paths: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSettings {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub repo_url: String,
    #[serde(default)]
    pub local_path: String,
    #[serde(default)]
    pub always_up_to_date: bool,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_timestamp",
        serialize_with = "serialize_optional_timestamp"
    )]
    pub last_synced_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub tracked_projects: BTreeMap<String, ProjectVaultTracking>,
    /// Anything the C# app stores under a vault that V2 does not model, preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

fn default_true() -> bool {
    true
}

impl Default for VaultSettings {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            enabled: true,
            repo_url: String::new(),
            local_path: String::new(),
            always_up_to_date: false,
            last_synced_at: None,
            tracked_projects: BTreeMap::new(),
            extra: BTreeMap::new(),
        }
    }
}

/// The vault block of `config.yaml`, lifted out of `TendrilSettings.extra`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VaultState {
    /// `vault:` — the primary vault.
    pub primary: Option<VaultSettings>,
    /// `vaults:` — every connected vault.
    pub vaults: Vec<VaultSettings>,
}

/// Reads the vault block. A key that will not deserialize is treated as absent rather than fatal: a
/// hand-edited or newer-schema `vault:` must not stop the rest of Tendril from loading.
pub fn load_vaults(settings: &TendrilSettings) -> VaultState {
    let primary = settings
        .extra
        .get(VAULT_KEY)
        .filter(|value| !value.is_null())
        .and_then(|value| match serde_json::from_value::<VaultSettings>(value.clone()) {
            Ok(vault) => Some(vault),
            Err(e) => {
                tracing::warn!("Ignoring unreadable '{}' in config.yaml: {}", VAULT_KEY, e);
                None
            }
        });

    let vaults = settings
        .extra
        .get(VAULTS_KEY)
        .filter(|value| !value.is_null())
        .and_then(
            |value| match serde_json::from_value::<Vec<VaultSettings>>(value.clone()) {
                Ok(vaults) => Some(vaults),
                Err(e) => {
                    tracing::warn!("Ignoring unreadable '{}' in config.yaml: {}", VAULTS_KEY, e);
                    None
                }
            },
        )
        .unwrap_or_default();

    VaultState { primary, vaults }
}

/// Writes the vault block back into `extra`, ready for `save_config`.
///
/// An empty state removes both keys instead of writing `vault: null`, so disconnecting the last vault
/// leaves `config.yaml` as it was before any vault existed.
pub fn save_vaults(settings: &mut TendrilSettings, state: &VaultState) {
    match &state.primary {
        Some(primary) => {
            if let Ok(value) = serde_json::to_value(primary) {
                settings.extra.insert(VAULT_KEY.to_string(), value);
            }
        }
        None => {
            settings.extra.remove(VAULT_KEY);
        }
    }

    if state.vaults.is_empty() {
        settings.extra.remove(VAULTS_KEY);
    } else if let Ok(value) = serde_json::to_value(&state.vaults) {
        settings.extra.insert(VAULTS_KEY.to_string(), value);
    }
}

/// Port of `EnsureVaultsInitialized`. Heals configurations written by older or crashed runs:
///
/// * a `repoUrl` that starts with `{` is a JSON error payload the C# app once saved by mistake, and
///   is rebuilt from the vault name;
/// * a lone `vault:` with no `vaults:` list is migrated into the list;
/// * missing ids get an 8-hex id, and the `Tendril-Vault` placeholder name is replaced with the real
///   `owner/name` from the repository URL;
/// * a missing or disabled primary is re-elected from the list.
pub fn ensure_vaults_initialized(state: &mut VaultState) {
    for vault in &mut state.vaults {
        heal_repo_url(vault);
    }

    if state.vaults.is_empty() {
        if let Some(primary) = state.primary.as_mut().filter(|p| !p.repo_url.is_empty()) {
            heal_repo_url(primary);
            if primary.id.is_empty() {
                primary.id = new_vault_id();
            }
            if primary.name.is_empty() {
                primary.name = extract_repo_name(&primary.repo_url);
            }
            let migrated = primary.clone();
            state.vaults.push(migrated);
        }
    }

    if state.vaults.is_empty() {
        return;
    }

    for vault in &mut state.vaults {
        if vault.id.is_empty() {
            vault.id = new_vault_id();
        }
        if vault.name.is_empty() || vault.name.eq_ignore_ascii_case(PLACEHOLDER_VAULT_NAME) {
            let extracted = extract_repo_name(&vault.repo_url);
            if !extracted.is_empty() {
                vault.name = extracted;
            }
        }
    }

    if state.primary.as_ref().map(|p| !p.enabled).unwrap_or(true) {
        state.primary = Some(
            state
                .vaults
                .iter()
                .find(|v| v.enabled)
                .unwrap_or(&state.vaults[0])
                .clone(),
        );
    }
}

fn heal_repo_url(vault: &mut VaultSettings) {
    if !vault.repo_url.trim().is_empty() && vault.repo_url.trim().starts_with('{') {
        vault.repo_url = format!("https://github.com/{}.git", vault.name);
    }
}

/// An 8-hex-character vault id, matching the C# `Guid.NewGuid().ToString("N")[..8]`.
pub fn new_vault_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..8].to_string()
}

/// Resolves a vault by id, repository URL or name (all case-insensitive), falling back to the first
/// enabled vault and then to the primary.
///
/// The literal `default` is the route contract's way of saying "whichever vault is primary", so it
/// skips the lookup rather than matching a vault that happens to be *named* `default`.
pub fn resolve_vault(state: &VaultState, vault_id: Option<&str>) -> Option<VaultSettings> {
    if let Some(found) = vault_id
        .map(str::trim)
        .filter(|id| !id.is_empty() && !id.eq_ignore_ascii_case("default"))
        .and_then(|id| find_vault(state, id))
    {
        return Some(found);
    }

    state
        .vaults
        .iter()
        .find(|v| v.enabled)
        .cloned()
        .or_else(|| state.primary.clone())
}

/// Looks up a vault by id, repository URL or name, *without* [`resolve_vault`]'s fallback.
///
/// Route handlers need the distinction: `GET /api/vaults/nope` must answer 404 rather than quietly
/// reporting on the primary vault instead.
pub fn find_vault(state: &VaultState, vault_id: &str) -> Option<VaultSettings> {
    let vault_id = vault_id.trim();
    state
        .vaults
        .iter()
        .find(|v| {
            v.id.eq_ignore_ascii_case(vault_id)
                || v.repo_url.eq_ignore_ascii_case(vault_id)
                || v.name.eq_ignore_ascii_case(vault_id)
        })
        .cloned()
}

/// The index of a vault in `vaults:`, by id.
pub fn vault_index(state: &VaultState, vault_id: &str) -> Option<usize> {
    state
        .vaults
        .iter()
        .position(|v| v.id.eq_ignore_ascii_case(vault_id))
}

/// Where a vault is cloned: its explicit `localPath`, else `<home>/Vaults/<id>`, else `<home>/Vault`
/// for a vault so old it has no id.
pub fn vault_dir(tendril_home: &Path, vault: Option<&VaultSettings>) -> PathBuf {
    match vault {
        Some(vault) if !vault.local_path.is_empty() => PathBuf::from(&vault.local_path),
        Some(vault) if !vault.id.is_empty() => tendril_home.join("Vaults").join(&vault.id),
        _ => tendril_home.join("Vault"),
    }
}

/// A comparable form of a repository URL: lower-cased, no trailing `/`, no `.git`, and `git@host:path`
/// rewritten as `https://host/path` so the SSH and HTTPS remotes of one repository compare equal.
pub fn normalize_repo_url(url: &str) -> String {
    let trimmed = strip_git_suffix(url.trim().trim_end_matches('/'));

    if let Some(rest) = trimmed.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            if !host.is_empty() && !path.is_empty() {
                return format!("https://{}/{}", host, path).to_lowercase();
            }
        }
    }

    trimmed.to_lowercase()
}

/// The `owner/name` of a repository URL, or the bare last segment when there is no owner.
///
/// Returns the `Tendril-Vault` placeholder for a blank or unparseable URL, matching the C#
/// `ExtractRepoName` — [`ensure_vaults_initialized`] relies on that placeholder being recognisable.
pub fn extract_repo_name(url: &str) -> String {
    if url.trim().is_empty() {
        return PLACEHOLDER_VAULT_NAME.to_string();
    }

    let trimmed = strip_git_suffix(url.trim().trim_end_matches('/'));

    // `user@host:owner/name`
    if let Some((prefix, path)) = trimmed.rsplit_once(':') {
        if prefix.contains('@') && !prefix.contains('/') && path.matches('/').count() == 1 {
            return path.to_string();
        }
    }

    let parts: Vec<&str> = trimmed
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .collect();

    // `https://host/owner/name`
    if let Some(scheme_end) = trimmed.find("://") {
        let after_scheme = &trimmed[scheme_end + 3..];
        let segments: Vec<&str> = after_scheme
            .split('/')
            .filter(|part| !part.is_empty())
            .collect();
        if segments.len() >= 3 {
            return format!(
                "{}/{}",
                segments[segments.len() - 2],
                segments[segments.len() - 1]
            );
        }
    }

    if parts.len() >= 2 && !parts[parts.len() - 2].contains(':') {
        return format!(
            "{}/{}",
            parts[parts.len() - 2],
            parts[parts.len() - 1]
        );
    }
    if let Some(last) = parts.last() {
        return last.to_string();
    }

    PLACEHOLDER_VAULT_NAME.to_string()
}

/// Drops a case-insensitive trailing `.git`.
pub fn strip_git_suffix(url: &str) -> &str {
    if url.len() >= 4 && url[url.len() - 4..].eq_ignore_ascii_case(".git") {
        &url[..url.len() - 4]
    } else {
        url
    }
}

/// Splits a remote URL into `(owner, name)`, for building a `VaultRepoRef` or a compare URL.
pub fn split_owner_and_name(remote_url: &str) -> Option<(String, String)> {
    let name = extract_repo_name(remote_url);
    let (owner, repo) = name.split_once('/')?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}
