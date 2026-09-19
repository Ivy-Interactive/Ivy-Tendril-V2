//! Installing and inspecting the Tendril background service.
//!
//! This is the one implementation. It was the desktop app's (`src-tauri/src/service/`) until
//! `tendril service install` existed, and it moved here rather than being copied because the app and
//! the CLI register the *same* launchd label, the *same* systemd unit name and the *same* scheduled
//! task. Two copies would be two programs overwriting each other's registration, and the difference
//! would only show up on a user's machine.
//!
//! What stayed behind in the app is the part that is genuinely the app's: locating its bundled
//! sidecars, and the debug-build gate on whether to provision at startup at all.
//!
//!   * [`platform`] writes and loads the per-OS unit: launchd, systemd, Windows Task Scheduler.
//!   * [`provision`] is the policy on top - what to install, whether it needs installing, and the
//!     autostart registration.
//!   * [`status`] is the read-only half, which `tendril service status` prints.

pub mod platform;
pub mod provision;
pub mod status;

pub use platform::{mechanism, PlatformServiceConfig, ServiceMechanism, SERVICE_NAME};
pub use provision::{
    autostart_config, provision_with, purge_binaries, register_autostart, register_autostart_with,
    service_config, unregister_autostart, unregister_autostart_with, AutostartOutcome,
    ProvisionReport, CLI_BINARY, OPENCODE_BINARY,
};
pub use status::{daemon_state, status, status_with_env, DaemonState, ServiceStatus};
