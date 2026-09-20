//! Where everything lives under the Tendril home: `config.yaml`, the plans folder, the database,
//! `Hooks/`, and each project's `Repos`/`Skills`/`MCP`/`Memory` directories.

use super::env::{EnvSource, SystemEnv};
use super::expansion::expand_variables;
use super::persistence::load_config;
use super::settings::TendrilSettings;
use crate::error::Result;
use std::path::{Path, PathBuf};

pub fn normalize_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn get_config_path_with_env(tendril_home: &Path, env: &impl EnvSource) -> PathBuf {
    if let Some(val) = env.get_var("TENDRIL_CONFIG") {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    tendril_home.join("config.yaml")
}

pub fn get_config_path(tendril_home: &Path) -> PathBuf {
    get_config_path_with_env(tendril_home, &SystemEnv)
}

pub fn get_plans_dir_with_env(
    tendril_home: &Path,
    settings: Option<&TendrilSettings>,
    env: &impl EnvSource,
) -> PathBuf {
    if let Some(val) = env.get_var("TENDRIL_PLANS") {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let loaded;
    let effective_settings = match settings {
        Some(s) => Some(s),
        None => {
            let config_path = get_config_path_with_env(tendril_home, env);
            if let Ok(s) = load_config(&config_path) {
                loaded = s;
                Some(&loaded)
            } else {
                None
            }
        }
    };

    if let Some(s) = effective_settings {
        if let Some(ref folder) = s.plan_folder {
            let trimmed = folder.trim();
            if !trimmed.is_empty() {
                let expanded = expand_variables(trimmed, &tendril_home.to_string_lossy());
                let p = PathBuf::from(&expanded);
                return if p.is_absolute()
                    || trimmed.contains("%TENDRIL_HOME%")
                    || trimmed.contains("${TENDRIL_HOME}")
                    || trimmed.contains("$TENDRIL_HOME")
                    || trimmed.starts_with('~')
                {
                    p
                } else {
                    tendril_home.join(p)
                };
            }
        }
    }

    tendril_home.join("Plans")
}

pub fn get_plans_dir_with_settings(
    tendril_home: &Path,
    settings: Option<&TendrilSettings>,
) -> PathBuf {
    get_plans_dir_with_env(tendril_home, settings, &SystemEnv)
}

pub fn get_plans_dir(tendril_home: &Path) -> PathBuf {
    get_plans_dir_with_settings(tendril_home, None)
}

pub fn get_database_path(tendril_home: &Path) -> PathBuf {
    tendril_home.join("tendril.db")
}

/// Where `config.yaml` hook actions keep their scripts, e.g.
/// `pwsh -NoProfile -File %TENDRIL_HOME%/Hooks/NotifySlack.ps1`.
pub fn get_hooks_dir(tendril_home: &Path) -> PathBuf {
    tendril_home.join("Hooks")
}

/// Creates the home directories that nothing else owns. Idempotent: `create_dir_all` on an existing
/// directory is a no-op, so it is safe on every daemon start, not just the first.
///
/// Deliberately only `Hooks` (plus the home itself): `Plans`, `Logs/Jobs`, `Attachments` and
/// `Promptwares` are each created on demand by their owner, and duplicating that here would give two
/// owners for one directory.
pub fn ensure_home_directories(tendril_home: &Path) -> Result<()> {
    std::fs::create_dir_all(tendril_home)?;
    std::fs::create_dir_all(get_hooks_dir(tendril_home))?;
    Ok(())
}

/// Strip everything outside `[A-Za-z0-9._-]`, matching the C# `InputSanitizer.SanitizeProjectName`
/// so the directory layout stays byte-identical between the two implementations.
pub fn sanitize_project_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
        .collect()
}

pub fn get_project_root_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    let projects = tendril_home.join("Projects");
    if project_name.trim().is_empty() {
        return projects;
    }
    projects.join(sanitize_project_name(project_name))
}

pub fn get_project_repos_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    get_project_root_dir(tendril_home, project_name).join("Repos")
}

pub fn get_project_skills_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    get_project_root_dir(tendril_home, project_name).join("Skills")
}

pub fn get_project_mcp_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    get_project_root_dir(tendril_home, project_name).join("MCP")
}

pub fn get_project_memory_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    get_project_root_dir(tendril_home, project_name).join("Memory")
}
