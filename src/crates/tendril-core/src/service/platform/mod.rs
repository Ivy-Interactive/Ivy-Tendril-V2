//! Per-platform autostart mechanisms: launchd on macOS, a systemd user unit on Linux, a scheduled
//! task on Windows.
//!
//! Ported here from the desktop app (`src-tauri/src/service/platform/`), which was the only caller
//! until `tendril service install` existed. Nothing in this tree may depend on Tauri or on the app's
//! own home resolution: `tendril-cli` and `tendril-app` both drive it now, and the unit a CLI install
//! writes has to be the same unit an app install writes or the two would rewrite each other's work.
//!
//! The home lookup is [`crate::config::dirs_home_with_env`] rather than the `dirs` crate the app used,
//! for two reasons: `tendril-core` does not depend on `dirs`, and an injectable environment is what
//! lets a test point `default_plist_path` at a temp directory instead of the LaunchAgents folder of
//! whoever is running the suite.

use crate::config::{get_default_tendril_home, EnvSource};
use std::path::PathBuf;

pub mod linux;
pub mod macos;
pub mod windows;

/// The one label/unit name Tendril registers under, on every platform.
///
/// A constant rather than a parameter on purpose: there is exactly one Tendril autostart
/// registration per user, and the app and the CLI have to agree on its name or an install from one
/// would leave the other's unit orphaned and running.
pub const SERVICE_NAME: &str = "com.spacecorps.tendril.service";

/// Everything a unit file needs to name: which binary, with which arguments, in which home.
#[derive(Debug, Clone)]
pub struct PlatformServiceConfig {
    pub service_name: String,
    pub binary_path: PathBuf,
    pub args: Vec<String>,
    pub tendril_home: PathBuf,
    pub log_path: PathBuf,
    pub env_vars: Vec<(String, String)>,
}

impl Default for PlatformServiceConfig {
    fn default() -> Self {
        // `get_default_tendril_home` rather than the app's simpler `resolve_tendril_home`: this one
        // honours the `.tendril_location` pointer file, so a relocated home is not silently replaced
        // with `~/.tendril`.
        let home = get_default_tendril_home();
        Self {
            service_name: SERVICE_NAME.to_string(),
            binary_path: home.join("bin").join("tendril"),
            args: vec!["serve".to_string()],
            log_path: home.join("Logs").join("service.log"),
            tendril_home: home,
            env_vars: vec![("TENDRIL_MANAGED_BY".to_string(), "Tendril-App".to_string())],
        }
    }
}

/// Which service manager this build talks to. `Unsupported` is a real answer, not an error: a
/// platform with no mechanism must produce a clear message and a non-zero exit, never a panic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ServiceMechanism {
    Launchd,
    Systemd,
    ScheduledTask,
    Unsupported,
}

impl ServiceMechanism {
    /// The name an operator would recognise, for the one line `tendril service status` prints.
    pub fn label(self) -> &'static str {
        match self {
            ServiceMechanism::Launchd => "launchd user agent",
            ServiceMechanism::Systemd => "systemd user unit",
            ServiceMechanism::ScheduledTask => "Windows scheduled task",
            ServiceMechanism::Unsupported => "none",
        }
    }

    pub fn is_supported(self) -> bool {
        !matches!(self, ServiceMechanism::Unsupported)
    }
}

/// The mechanism this build was compiled for.
pub const fn mechanism() -> ServiceMechanism {
    #[cfg(target_os = "macos")]
    {
        ServiceMechanism::Launchd
    }
    #[cfg(target_os = "linux")]
    {
        ServiceMechanism::Systemd
    }
    #[cfg(target_os = "windows")]
    {
        ServiceMechanism::ScheduledTask
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        ServiceMechanism::Unsupported
    }
}

/// Where this platform's unit file lives, or `None` when the platform has no file to write (Windows
/// keeps the task in the scheduler's own store) or no home directory to write it into.
pub fn default_unit_path_with_env(env: &impl EnvSource) -> Option<PathBuf> {
    match mechanism() {
        ServiceMechanism::Launchd => macos::default_plist_path_with_env(env),
        ServiceMechanism::Systemd => linux::default_systemd_unit_path_with_env(env),
        ServiceMechanism::ScheduledTask | ServiceMechanism::Unsupported => None,
    }
}

/// Whether this platform's service manager has a registration under this name.
///
/// Only Windows needs this: launchd and systemd keep a unit file, so `status` answers the question
/// by looking on disk. The scheduler has no file, so the scheduler itself has to be asked - and
/// asked whether the task *exists*, not whether it is *running*. Every other platform returns
/// `false` here and is expected to consult the unit path instead.
pub fn service_is_installed(service_name: &str) -> bool {
    let _ = service_name;
    #[cfg(target_os = "windows")]
    {
        return windows::scheduled_task_exists(service_name);
    }
    #[allow(unreachable_code)]
    false
}

/// Whether the service manager currently has the service running.
///
/// One answer for every platform, so a caller does not have to `cfg` its way around three module
/// paths. A platform with no mechanism, and a machine where the service manager cannot be reached at
/// all, both read as "not running" - which is the honest answer, and the one that lets
/// `tendril service status` distinguish "the unit is on disk but nothing is running it" from
/// "installed and up".
pub fn service_is_loaded(service_name: &str) -> bool {
    let _ = service_name;
    #[cfg(target_os = "macos")]
    {
        return macos::service_is_loaded(service_name);
    }
    #[cfg(target_os = "linux")]
    {
        return linux::service_is_loaded(service_name);
    }
    #[cfg(target_os = "windows")]
    {
        return windows::scheduled_task_is_running(service_name);
    }
    #[allow(unreachable_code)]
    false
}
