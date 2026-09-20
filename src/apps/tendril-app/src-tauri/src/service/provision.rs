//! The app's share of installing the background service.
//!
//! A Tendril installer drops one thing on the machine: the app. Everything the app is for — plans,
//! jobs, chat — is served by the `tendril` daemon, and until this existed the only ways to get one
//! were to install the CLI separately or to let the app spawn a managed child that dies with it.
//! Neither is what "install Tendril" should mean. So on first run the app copies its bundled
//! `tendril` and `opencode` sidecars into `<home>/bin` and registers an autostart unit against them.
//!
//! All of that now lives in [`tendril_core::service::provision`], because `tendril service install`
//! registers the *same* launchd label, the *same* systemd unit name and the *same* scheduled task.
//! Two copies would be two programs overwriting each other's registration, and the difference would
//! only show up on a user's machine.
//!
//! What is left here is the part that is genuinely the app's, and would be wrong in a shared crate:
//!
//!   * [`sidecar_dir`], which knows how `tauri-build` stages the bundled binaries;
//!   * [`should_provision_on_startup`], whose `debug_assertions` check has to be the *app's* build
//!     profile, not `tendril-core`'s;
//!   * [`provision`], whose `env!("CARGO_PKG_VERSION")` has to be the *app's* version — in
//!     `tendril-core` it would silently become the core crate's, and the version stamp is what
//!     decides whether a launch re-copies 250 MB.

use std::path::{Path, PathBuf};

pub use tendril_core::service::provision::{
    autostart_config, binary_needs_install, provision_with, purge_binaries, register_autostart,
    register_autostart_with, service_config, should_register_autostart, unit_needs_write,
    unregister_autostart, unregister_autostart_with, AutostartOutcome, ProvisionReport,
    ProvisionStamp, CLI_BINARY, OPENCODE_BINARY, STAMP_FILE,
};

/// The directory the bundled sidecars live in: the one holding the running executable.
///
/// `tauri-build` strips the target triple from `binaries/<name>-<triple>` and copies the result next
/// to the app executable, in both `cargo build` output and a packaged bundle, so this one probe
/// covers dev and release.
pub fn sidecar_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(Path::to_path_buf)
}

/// Whether startup provisioning should run at all.
///
/// Off in debug builds unless asked for: `cargo run` and `pnpm dev:desktop` stage debug sidecars
/// next to the executable, and copying those over a developer's real `~/.tendril/bin/tendril` —
/// then registering launchd against it — is not something a dev build should do to a machine.
///
/// The `debug_assertions` check is why this cannot move into `tendril-core`: it has to be the app's
/// build profile, and a shared crate compiled into a release CLI would answer for that build
/// instead.
pub fn should_provision_on_startup() -> bool {
    if tendril_core::service::provision::env_flag("TENDRIL_SKIP_SERVICE_PROVISION") {
        return false;
    }
    if cfg!(debug_assertions) {
        return tendril_core::service::provision::env_flag("TENDRIL_PROVISION_SERVICE");
    }
    true
}

/// The startup entry point: provision against the real app version, sidecar directory and home.
pub fn provision(home: &Path) -> ProvisionReport {
    provision_with(
        // The app's version, not `tendril-core`'s. This is the line the move had to leave behind:
        // `env!` expands against the crate being compiled, so the same call inside `tendril-core`
        // would stamp `<home>/bin/.provisioned` with the core crate's version and every app upgrade
        // would look like a no-op.
        env!("CARGO_PKG_VERSION"),
        sidecar_dir().as_deref(),
        home,
        should_register_autostart(),
    )
}
