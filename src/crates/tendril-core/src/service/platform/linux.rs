//! The systemd user unit.
//!
//! Ported from the app's `src-tauri/src/service/platform/linux.rs`; the unit text is unchanged, so a
//! home already provisioned by the app compares equal and is not rewritten.

use super::PlatformServiceConfig;
use crate::config::{dirs_home_with_env, EnvSource, SystemEnv};
use std::path::{Path, PathBuf};

/// The unit's name without the `.service` suffix — what `systemctl --user` takes as its argument.
pub const SYSTEMD_UNIT_NAME: &str = "tendril-service";

/// `~/.config/systemd/user/tendril-service.service`, resolved through `env` so a test can point it
/// at a temp directory rather than the real systemd user directory.
pub fn default_systemd_unit_path_with_env(env: &impl EnvSource) -> Option<PathBuf> {
    dirs_home_with_env(env).map(|h| {
        h.join(".config")
            .join("systemd")
            .join("user")
            .join(format!("{SYSTEMD_UNIT_NAME}.service"))
    })
}

pub fn default_systemd_unit_path() -> Option<PathBuf> {
    default_systemd_unit_path_with_env(&SystemEnv)
}

pub fn generate_systemd_unit(config: &PlatformServiceConfig) -> String {
    let mut exec_start = config.binary_path.display().to_string();
    for arg in &config.args {
        exec_start.push(' ');
        exec_start.push_str(arg);
    }

    let mut env_lines = String::new();
    for (k, v) in &config.env_vars {
        env_lines.push_str(&format!("Environment=\"{}={}\"\n", k, v));
    }

    format!(
        r#"[Unit]
Description=Tendril Background Service Daemon
After=network.target

[Service]
Type=simple
ExecStart={}
WorkingDirectory={}
Restart=always
RestartSec=3
StandardOutput=append:{}
StandardError=append:{}
Environment="TENDRIL_HOME={}"
{}
[Install]
WantedBy=default.target
"#,
        exec_start,
        config.tendril_home.display(),
        config.log_path.display(),
        config.log_path.display(),
        config.tendril_home.display(),
        env_lines
    )
}

/// Writes the unit and, when `start`, enables and starts it.
///
/// See [`super::macos::install_launchd_service`] for why the two halves are separable: writing a
/// file is local and reversible, `systemctl --user enable --now` is not, and a test must be able to
/// do the first without the second.
pub fn install_systemd_service(
    config: &PlatformServiceConfig,
    target_unit: &Path,
    start: bool,
) -> Result<(), String> {
    if let Some(parent) = target_unit.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create systemd user directory: {e}"))?;
    }

    let content = generate_systemd_unit(config);
    std::fs::write(target_unit, content)
        .map_err(|e| format!("Failed to write systemd unit: {e}"))?;

    #[cfg(target_os = "linux")]
    if start {
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .output();
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "enable", "--now", SYSTEMD_UNIT_NAME])
            .output();
    }
    #[cfg(not(target_os = "linux"))]
    let _ = start;

    Ok(())
}

/// Removes the unit and, when `stop`, stops and disables it first.
pub fn uninstall_systemd_service(target_unit: &Path, stop: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if stop {
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "stop", SYSTEMD_UNIT_NAME])
            .output();
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "disable", SYSTEMD_UNIT_NAME])
            .output();
    }
    #[cfg(not(target_os = "linux"))]
    let _ = stop;

    if target_unit.exists() {
        std::fs::remove_file(target_unit)
            .map_err(|e| format!("Failed to remove systemd unit: {e}"))?;
    }
    Ok(())
}

/// Whether systemd reports the unit as active.
///
/// `systemctl --user is-active` exits 0 only for `active`; every other state (inactive, failed,
/// unknown unit) is non-zero, which is the whole test. A machine with no user bus — a container, an
/// SSH session with no lingering — reads as "not running", which is the honest answer.
#[cfg(target_os = "linux")]
pub fn service_is_loaded(_service_name: &str) -> bool {
    std::process::Command::new("systemctl")
        .args(["--user", "is-active", "--quiet", SYSTEMD_UNIT_NAME])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
