use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use crate::error::{Result, TendrilError};
use crate::models::{LevelConfig, ProjectConfig, VerificationConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TendrilSettings {
    #[serde(rename = "codingAgent", default = "default_coding_agent")]
    pub coding_agent: String,

    #[serde(rename = "jobTimeout", default = "default_job_timeout")]
    pub job_timeout: i32,

    #[serde(rename = "staleOutputTimeout", default = "default_stale_output_timeout")]
    pub stale_output_timeout: i32,

    #[serde(rename = "gitTimeout", default = "default_git_timeout")]
    pub git_timeout: i32,

    #[serde(rename = "maxConcurrentJobs", default = "default_max_concurrent_jobs")]
    pub max_concurrent_jobs: i32,

    #[serde(default)]
    pub projects: Vec<ProjectConfig>,

    #[serde(default)]
    pub verifications: Vec<VerificationConfig>,

    #[serde(rename = "planTemplate", default)]
    pub plan_template: String,

    #[serde(default = "default_levels")]
    pub levels: Vec<LevelConfig>,

    #[serde(default = "default_true")]
    pub telemetry: bool,

    #[serde(default = "default_theme")]
    pub theme: String,

    #[serde(default)]
    pub beta: bool,
}

fn default_coding_agent() -> String { "claude".to_string() }
fn default_job_timeout() -> i32 { 30 }
fn default_stale_output_timeout() -> i32 { 10 }
fn default_git_timeout() -> i32 { 10 }
fn default_max_concurrent_jobs() -> i32 { 20 }
fn default_true() -> bool { true }
fn default_theme() -> String { "default".to_string() }

fn default_levels() -> Vec<LevelConfig> {
    vec![
        LevelConfig { name: "Bug".to_string(), color: "Red".to_string(), badge: None },
        LevelConfig { name: "Feature".to_string(), color: "Blue".to_string(), badge: None },
        LevelConfig { name: "Epic".to_string(), color: "Purple".to_string(), badge: None },
        LevelConfig { name: "Chore".to_string(), color: "Slate".to_string(), badge: None },
        LevelConfig { name: "Nitpick".to_string(), color: "Gray".to_string(), badge: None },
    ]
}

impl Default for TendrilSettings {
    fn default() -> Self {
        Self {
            coding_agent: default_coding_agent(),
            job_timeout: default_job_timeout(),
            stale_output_timeout: default_stale_output_timeout(),
            git_timeout: default_git_timeout(),
            max_concurrent_jobs: default_max_concurrent_jobs(),
            projects: Vec::new(),
            verifications: Vec::new(),
            plan_template: String::new(),
            levels: default_levels(),
            telemetry: true,
            theme: default_theme(),
            beta: false,
        }
    }
}

pub fn get_default_tendril_home() -> PathBuf {
    if let Ok(val) = std::env::var("TENDRIL_HOME") {
        if !val.trim().is_empty() {
            return PathBuf::from(val.trim());
        }
    }

    // Windows D:/.tendril default check
    let d_tendril = PathBuf::from(r"D:\.tendril");
    if d_tendril.exists() {
        return d_tendril;
    }

    if let Some(home) = dirs_home() {
        let user_tendril = home.join(".tendril");
        if user_tendril.exists() {
            return user_tendril;
        }
    }

    PathBuf::from(r"D:\.tendril")
}

fn dirs_home() -> Option<PathBuf> {
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        return Some(PathBuf::from(userprofile));
    }
    if let Ok(home) = std::env::var("HOME") {
        return Some(PathBuf::from(home));
    }
    None
}

pub fn get_config_path(tendril_home: &Path) -> PathBuf {
    if let Ok(val) = std::env::var("TENDRIL_CONFIG") {
        if !val.trim().is_empty() {
            return PathBuf::from(val.trim());
        }
    }
    tendril_home.join("config.yaml")
}

pub fn get_plans_dir(tendril_home: &Path) -> PathBuf {
    if let Ok(val) = std::env::var("TENDRIL_PLANS") {
        if !val.trim().is_empty() {
            return PathBuf::from(val.trim());
        }
    }
    tendril_home.join("Plans")
}

pub fn get_database_path(tendril_home: &Path) -> PathBuf {
    tendril_home.join("tendril.db")
}

pub fn load_config(config_path: &Path) -> Result<TendrilSettings> {
    if !config_path.exists() {
        return Ok(TendrilSettings::default());
    }

    let raw = std::fs::read_to_string(config_path)
        .map_err(|e| TendrilError::Config(format!("Failed to read config file {}: {}", config_path.display(), e)))?;

    let settings: TendrilSettings = serde_yaml::from_str(&raw)
        .map_err(|e| TendrilError::Config(format!("Failed to parse {}: {}", config_path.display(), e)))?;

    Ok(settings)
}

pub fn save_config(config_path: &Path, settings: &TendrilSettings) -> Result<()> {
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let yaml = serde_yaml::to_string(settings)
        .map_err(|e| TendrilError::Config(format!("Failed to serialize settings: {}", e)))?;

    std::fs::write(config_path, yaml)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterInfo {
    pub port: u16,
    pub pid: u32,
    #[serde(default)]
    pub secret: String,
    #[serde(rename = "startedAt", default)]
    pub started_at: String,
}

pub fn read_master(tendril_home: &Path) -> Option<MasterInfo> {
    let master_file = tendril_home.join(".master");
    if !master_file.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&master_file).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn write_master(tendril_home: &Path, port: u16, secret: &str) -> Result<()> {
    let master_file = tendril_home.join(".master");
    let info = MasterInfo {
        port,
        pid: std::process::id(),
        secret: secret.to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_string_pretty(&info)?;
    std::fs::write(master_file, json)?;
    Ok(())
}

pub fn delete_master(tendril_home: &Path) {
    let master_file = tendril_home.join(".master");
    if master_file.exists() {
        let _ = std::fs::remove_file(master_file);
    }
}
