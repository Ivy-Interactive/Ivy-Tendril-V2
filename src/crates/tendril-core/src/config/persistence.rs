//! Reading `config.yaml`, writing it back atomically under its lock, and the deep merge behind
//! `PUT /api/config`.

use super::settings::TendrilSettings;
use crate::error::{Result, TendrilError};
use std::path::Path;

pub fn load_config(config_path: &Path) -> Result<TendrilSettings> {
    if !config_path.exists() {
        return Ok(TendrilSettings::default());
    }

    let raw = std::fs::read_to_string(config_path).map_err(|e| {
        TendrilError::Config(format!(
            "Failed to read config file {}: {}",
            config_path.display(),
            e
        ))
    })?;

    let settings: TendrilSettings = serde_yaml::from_str(&raw).map_err(|e| {
        TendrilError::Config(format!("Failed to parse {}: {}", config_path.display(), e))
    })?;

    Ok(settings)
}

/// Replaces `config.yaml` atomically while holding its lock.
///
/// The caller must not already hold that lock — see
/// [`FileLock::acquire`][crate::fs_lock::FileLock::acquire] on nesting.
pub fn save_config(config_path: &Path, settings: &TendrilSettings) -> Result<()> {
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let yaml = serde_yaml::to_string(settings)
        .map_err(|e| TendrilError::Config(format!("Failed to serialize settings: {}", e)))?;

    let _lock = crate::fs_lock::FileLock::acquire(config_path)?;
    crate::fs_lock::write_atomic(config_path, yaml.as_bytes())
}

/// The `name` of a `projects:` entry, if it has one.
fn project_entry_name(entry: &serde_yaml::Value) -> Option<&str> {
    entry.get("name")?.as_str()
}

/// Merges an incoming `projects` sequence into the existing one **by project name**.
///
/// Entries are matched case-insensitively on `name` — the same lookup every `/api/projects` handler
/// uses. A matched pair is merged as a mapping (so a payload naming one key does not clear the
/// project's other keys), an incoming entry matching nothing is appended, and an existing project the
/// payload does not mention is left untouched.
///
/// **Omission is not deletion.** Removing a project goes through `DELETE /api/projects/:name`, never
/// `PUT /api/config`. Do not later "fix" this merge to honour an omitted project as a delete — that
/// would turn every partial config PUT into a mass project wipe.
fn merge_projects_by_name(existing: &mut serde_yaml::Value, incoming: serde_yaml::Value) {
    let incoming_seq = match incoming {
        serde_yaml::Value::Sequence(seq) => seq,
        // Not a sequence: nothing to match on, so fall back to replacement.
        other => {
            *existing = other;
            return;
        }
    };

    let existing_seq = match existing.as_sequence_mut() {
        Some(seq) => seq,
        None => {
            *existing = serde_yaml::Value::Sequence(incoming_seq);
            return;
        }
    };

    for incoming_proj in incoming_seq {
        let matched = project_entry_name(&incoming_proj).and_then(|name| {
            existing_seq.iter().position(|existing_proj| {
                project_entry_name(existing_proj).is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
        });

        match matched {
            Some(idx) => merge_config_value(&mut existing_seq[idx], incoming_proj, false),
            None => existing_seq.push(incoming_proj),
        }
    }
}

/// Deep-merges `incoming` into `existing` for [`update_config_raw`].
///
/// - **Mappings merge recursively**, key by key. A key present only in `existing` is kept.
/// - **Sequences replace.** This must not be generalised: an incoming `filePermissions: []` or
///   `verifications: [...]` means "this is the list now", so merging list elements would make
///   clearing a list impossible.
/// - **The top-level `projects` sequence is the single exception** — see [`merge_projects_by_name`].
///   `at_root` is what keeps that exception to the real `projects` key, so a nested key that happens
///   to be called `projects` inside some project's own data is merged like any other sequence.
/// - Scalars, and any type mismatch between the two sides, replace.
fn merge_config_value(
    existing: &mut serde_yaml::Value,
    incoming: serde_yaml::Value,
    at_root: bool,
) {
    let incoming_map = match incoming {
        serde_yaml::Value::Mapping(map) => map,
        other => {
            *existing = other;
            return;
        }
    };

    let existing_map = match existing.as_mapping_mut() {
        Some(map) => map,
        None => {
            *existing = serde_yaml::Value::Mapping(incoming_map);
            return;
        }
    };

    for (key, value) in incoming_map {
        let is_projects = at_root && key.as_str() == Some("projects");
        match existing_map.get_mut(&key) {
            Some(slot) if is_projects => merge_projects_by_name(slot, value),
            Some(slot) => merge_config_value(slot, value, false),
            None => {
                existing_map.insert(key, value);
            }
        }
    }
}

/// Merges `incoming` into `config.yaml` and writes the result.
///
/// The merge is a **deep** one — see [`merge_config_value`] for the exact rules, and
/// [`merge_projects_by_name`] for why `projects` is special. A shallow top-level `insert` per
/// incoming key was the previous behaviour and meant a payload carrying `projects:` replaced the
/// entire projects array.
///
/// This is a read-modify-write, so the lock is held across **both** halves: releasing it between the
/// read and the write is exactly how two concurrent settings edits drop one another.
pub fn update_config_raw(config_path: &Path, incoming: &serde_json::Value) -> Result<()> {
    let _lock = crate::fs_lock::FileLock::acquire(config_path)?;
    let existing_raw = if config_path.exists() {
        std::fs::read_to_string(config_path).map_err(|e| {
            TendrilError::Config(format!("Failed to read {}: {}", config_path.display(), e))
        })?
    } else {
        String::new()
    };

    let mut existing_val: serde_yaml::Value = if !existing_raw.trim().is_empty() {
        serde_yaml::from_str(&existing_raw)
            .unwrap_or_else(|_| serde_yaml::Value::Mapping(serde_yaml::Mapping::new()))
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    let incoming_yaml: serde_yaml::Value = serde_yaml::to_value(incoming)
        .map_err(|e| TendrilError::Config(format!("Invalid incoming config: {}", e)))?;

    if !incoming_yaml.is_mapping() {
        return Err(TendrilError::Config(
            "Config update payload must be an object".to_string(),
        ));
    }
    merge_config_value(&mut existing_val, incoming_yaml, true);

    let yaml_str = serde_yaml::to_string(&existing_val)
        .map_err(|e| TendrilError::Config(format!("Failed to serialize merged config: {}", e)))?;

    // Verify merged config is valid
    serde_yaml::from_str::<TendrilSettings>(&yaml_str)
        .map_err(|e| TendrilError::Config(format!("Merged config is invalid: {}", e)))?;

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // `write_atomic` rather than `save_config`: the lock is already held here, and re-acquiring it
    // would deadlock.
    crate::fs_lock::write_atomic(config_path, yaml_str.as_bytes())
}
