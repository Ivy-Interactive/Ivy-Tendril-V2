//! The launchd user agent.
//!
//! Ported from the app's `src-tauri/src/service/platform/macos.rs`; the plist text is unchanged, so a
//! home already provisioned by the app compares equal and is not rewritten (see
//! [`super::super::unit_needs_write`] for why that matters).

use super::{PlatformServiceConfig, SERVICE_NAME};
use crate::config::{dirs_home_with_env, EnvSource, SystemEnv};
use std::path::{Path, PathBuf};

/// `~/Library/LaunchAgents/<label>.plist`, resolved through `env` so a test can point it at a temp
/// directory rather than the LaunchAgents folder of whoever is running the suite.
pub fn default_plist_path_with_env(env: &impl EnvSource) -> Option<PathBuf> {
    dirs_home_with_env(env).map(|h| {
        h.join("Library")
            .join("LaunchAgents")
            .join(format!("{SERVICE_NAME}.plist"))
    })
}

pub fn default_plist_path() -> Option<PathBuf> {
    default_plist_path_with_env(&SystemEnv)
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

/// Writes the plist and, when `start`, hands it to launchd.
///
/// `start` is separable from writing because the two have very different consequences. Writing a
/// file into a directory is reversible and local; `launchctl bootstrap` registers a service with the
/// running system. `tendril service install --no-start` is the operator-facing reason for the split
/// (stage the unit now, let it come up at the next login), and it is also what lets this crate's
/// tests point `HOME` at a temp directory and assert on the plist that lands there without
/// registering a daemon on whatever machine is running the suite.
pub fn install_launchd_service(
    config: &PlatformServiceConfig,
    target_plist: &Path,
    start: bool,
) -> Result<(), String> {
    if let Some(parent) = target_plist.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create LaunchAgents directory: {e}"))?;
    }

    let plist_content = generate_launchd_plist(config);
    std::fs::write(target_plist, plist_content)
        .map_err(|e| format!("Failed to write plist file: {e}"))?;

    #[cfg(target_os = "macos")]
    if start {
        let domain = gui_domain();
        // Booting out first is what makes a reinstall pick up the new plist: `bootstrap` over a
        // label launchd already holds is an error, not a reload.
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
    #[cfg(not(target_os = "macos"))]
    let _ = start;

    Ok(())
}

/// Removes the plist and, when `stop`, boots the agent out first.
///
/// Same split as [`install_launchd_service`], for the same reason: `stop == false` touches nothing
/// but the filesystem.
pub fn uninstall_launchd_service(target_plist: &Path, stop: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if stop {
        let domain = gui_domain();
        let _ = std::process::Command::new("launchctl")
            .args(["bootout", &domain, target_plist.to_str().unwrap_or("")])
            .output();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = stop;

    if target_plist.exists() {
        std::fs::remove_file(target_plist).map_err(|e| format!("Failed to remove plist: {e}"))?;
    }
    Ok(())
}

/// The `gui/<uid>` domain a user agent is bootstrapped into.
#[cfg(target_os = "macos")]
fn gui_domain() -> String {
    let uid_out = std::process::Command::new("id").arg("-u").output().ok();
    let uid_str = uid_out
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_else(|| "501\n".to_string());
    format!("gui/{}", uid_str.trim())
}

/// Whether launchd currently has the agent loaded.
///
/// `launchctl print gui/<uid>/<label>` exits non-zero when the label is unknown, which is the whole
/// test — the output is not parsed, because its format is not a stable interface. A `launchctl` that
/// cannot be run at all reads as "not loaded" rather than an error: a plist on disk with no live
/// agent is exactly the "installed but not running" state `tendril service status` exists to report.
#[cfg(target_os = "macos")]
pub fn service_is_loaded(service_name: &str) -> bool {
    std::process::Command::new("launchctl")
        .args(["print", &format!("{}/{}", gui_domain(), service_name)])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
