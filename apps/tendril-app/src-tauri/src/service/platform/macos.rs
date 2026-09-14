use super::PlatformServiceConfig;
use std::path::{Path, PathBuf};

pub fn default_plist_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join("Library")
            .join("LaunchAgents")
            .join("com.spacecorps.tendril.service.plist")
    })
}

pub fn generate_launchd_plist(config: &PlatformServiceConfig) -> String {
    let mut args_xml = String::new();
    args_xml.push_str(&format!(
        "        <string>{}</string>\n",
        config.binary_path.display()
    ));
    for arg in &config.args {
        args_xml.push_str(&format!("        <string>{arg}</string>\n"));
    }

    let mut env_xml = String::new();
    for (k, v) in &config.env_vars {
        env_xml.push_str(&format!(
            "        <key>{k}</key>\n        <string>{v}</string>\n"
        ));
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{}</string>
    <key>ProgramArguments</key>
    <array>
{}    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>WorkingDirectory</key>
    <string>{}</string>
    <key>StandardOutPath</key>
    <string>{}</string>
    <key>StandardErrorPath</key>
    <string>{}</string>
    <key>EnvironmentVariables</key>
    <dict>
{}    </dict>
</dict>
</plist>
"#,
        config.service_name,
        args_xml,
        config.tendril_home.display(),
        config.log_path.display(),
        config.log_path.display(),
        env_xml
    )
}

pub fn install_launchd_service(
    config: &PlatformServiceConfig,
    target_plist: &Path,
) -> Result<(), String> {
    if let Some(parent) = target_plist.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create LaunchAgents directory: {e}"))?;
    }

    let plist_content = generate_launchd_plist(config);
    std::fs::write(target_plist, plist_content)
        .map_err(|e| format!("Failed to write plist file: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        let uid_out = std::process::Command::new("id").arg("-u").output().ok();
        let uid_str = uid_out
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .unwrap_or_else(|| "501\n".to_string());
        let domain = format!("gui/{}", uid_str.trim());
        let _ = std::process::Command::new("launchctl")
            .args(["bootout", &domain, target_plist.to_str().unwrap_or("")])
            .output();
        let status = std::process::Command::new("launchctl")
            .args(["bootstrap", &domain, target_plist.to_str().unwrap_or("")])
            .status()
            .map_err(|e| format!("Failed to execute launchctl bootstrap: {e}"))?;

        if !status.success() {
            return Err("launchctl bootstrap exited with non-zero status".to_string());
        }
    }

    Ok(())
}

pub fn uninstall_launchd_service(target_plist: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let uid_out = std::process::Command::new("id").arg("-u").output().ok();
        let uid_str = uid_out
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .unwrap_or_else(|| "501\n".to_string());
        let domain = format!("gui/{}", uid_str.trim());
        let _ = std::process::Command::new("launchctl")
            .args(["bootout", &domain, target_plist.to_str().unwrap_or("")])
            .output();
    }

    if target_plist.exists() {
        std::fs::remove_file(target_plist).map_err(|e| format!("Failed to remove plist: {e}"))?;
    }
    Ok(())
}
