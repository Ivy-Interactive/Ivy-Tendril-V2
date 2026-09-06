use super::PlatformServiceConfig;
use std::path::{Path, PathBuf};

pub fn default_systemd_unit_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join(".config")
            .join("systemd")
            .join("user")
            .join("tendril-service.service")
    })
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

pub fn install_systemd_service(
    config: &PlatformServiceConfig,
    target_unit: &Path,
) -> Result<(), String> {
    if let Some(parent) = target_unit.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create systemd user directory: {e}"))?;
    }

    let content = generate_systemd_unit(config);
    std::fs::write(target_unit, content)
        .map_err(|e| format!("Failed to write systemd unit: {e}"))?;

    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .output();
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "enable", "--now", "tendril-service"])
            .output();
    }

    Ok(())
}

pub fn uninstall_systemd_service(target_unit: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "stop", "tendril-service"])
            .output();
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "disable", "tendril-service"])
            .output();
    }

    if target_unit.exists() {
        std::fs::remove_file(target_unit)
            .map_err(|e| format!("Failed to remove systemd unit: {e}"))?;
    }
    Ok(())
}
