//! Installing the background service, and the autostart registration that makes it survive a reboot.
//!
//! Ported out of the desktop app (`src-tauri/src/service/provision.rs`), which owned all of this
//! until `tendril service install` existed. It lives in `tendril-core` now because there must be
//! exactly one implementation: the app and the CLI both register the same launchd label, the same
//! systemd unit name and the same scheduled task, so two copies of this logic would be two programs
//! quietly overwriting each other's unit file.
//!
//! The two callers want different halves of it:
//!
//!   * The **app** provisions a machine that has nothing on it. A Tendril installer drops the app and
//!     nothing else, so on first run it copies its bundled `tendril` and `opencode` sidecars into
//!     `<home>/bin` — the `binary_path` in [`PlatformServiceConfig::default`], the directory
//!     `agent_path` puts on an agent's `PATH`, and the third probe in `resolve_opencode_binary` — and
//!     registers autostart against that copy. That is [`provision_with`].
//!   * The **CLI** has no sidecars to copy: it *is* the binary. `tendril service install` registers
//!     autostart against the running executable and nothing else. That is [`register_autostart`] on
//!     its own.
//!
//! Every step is idempotent and every step is allowed to fail. A machine where the LaunchAgents
//! directory is not writable still gets a working app — it just gets the managed child it always had.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::platform::{PlatformServiceConfig, SERVICE_NAME};

/// The companion daemon, as Tauri stages it: `binaries/tendril-<triple>` in the repo becomes plain
/// `tendril` next to the app executable.
pub const CLI_BINARY: &str = if cfg!(windows) {
    "tendril.exe"
} else {
    "tendril"
};

/// The bundled agent. Same staging rule; see `resolve_opencode_binary` in `tendril-core` for where
/// it is looked for at run time.
pub const OPENCODE_BINARY: &str = if cfg!(windows) {
    "opencode.exe"
} else {
    "opencode"
};

/// Written into `<home>/bin` after a successful run so the next launch is a stat and not a 250 MB
/// copy.
pub const STAMP_FILE: &str = ".provisioned";

/// What the last successful provisioning installed.
///
/// The app version is the trigger: two builds of the same version are assumed identical, and a
/// version bump re-copies unconditionally. Sizes are recorded as a cheap second opinion, so a
/// half-written or hand-replaced binary is noticed without hashing 250 MB on every launch.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionStamp {
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub binaries: BTreeMap<String, u64>,
}

/// What happened to the autostart registration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "detail")]
pub enum AutostartOutcome {
    /// The unit was written (and loaded, where the platform loads it).
    Registered(String),
    /// An identical unit was already in place, so it was left alone.
    AlreadyRegistered(String),
    /// Deliberately not attempted - an env override, or a platform with no supported mechanism.
    Skipped(String),
    Failed(String),
}

impl Default for AutostartOutcome {
    fn default() -> Self {
        AutostartOutcome::Skipped("not attempted".to_string())
    }
}

/// The result of one provisioning run, in the shape the Service settings pane renders.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionReport {
    /// Binaries copied into `<home>/bin` this run.
    pub installed: Vec<String>,
    /// Binaries that were already current.
    pub up_to_date: Vec<String>,
    /// Binaries the app does not carry. A dev build run from `cargo run` with no staged sidecars is
    /// the ordinary case; it is reported rather than hidden because in a bundle it would mean the
    /// installer shipped incomplete.
    pub missing: Vec<String>,
    pub bin_dir: String,
    pub autostart: AutostartOutcome,
    /// Non-fatal failures. A run can install one binary, fail the other and still register
    /// autostart, and the operator has to be able to see all three.
    pub errors: Vec<String>,
}

impl ProvisionReport {
    pub fn changed(&self) -> bool {
        !self.installed.is_empty() || matches!(self.autostart, AutostartOutcome::Registered(_))
    }
}

/// Whether `<home>/bin/<name>` has to be written from the bundled copy.
///
/// Split out from the IO so the decision is testable: it is the part that decides whether an app
/// launch costs a stat or a quarter of a gigabyte.
pub fn binary_needs_install(
    source_len: Option<u64>,
    dest_len: Option<u64>,
    stamped_version: Option<&str>,
    app_version: &str,
) -> bool {
    // Nothing bundled to install. Not an error here - the caller reports it.
    let Some(source_len) = source_len else {
        return false;
    };
    match dest_len {
        None => true,
        Some(dest_len) if dest_len != source_len => true,
        // Same size, which for two builds of different versions is possible but unlikely; the stamp
        // is what actually decides. An absent or older stamp re-copies.
        Some(_) => stamped_version != Some(app_version),
    }
}

/// Whether an autostart unit file has to be rewritten.
///
/// Comparing content rather than always writing matters most on macOS, where installing means
/// `launchctl bootout` followed by `bootstrap` - the running daemon is killed and restarted. Doing
/// that on every app launch would be a restart loop with a daemon in the middle of it.
pub fn unit_needs_write(desired: &str, existing: Option<&str>) -> bool {
    existing != Some(desired)
}

/// The directory the bundled sidecars live in: the one holding the running executable.
///
/// `tauri-build` strips the target triple from `binaries/<name>-<triple>` and copies the result next
/// to the app binary, in both `cargo build` output and a packaged bundle, so this one probe covers
/// dev and release.
pub fn sidecar_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(Path::to_path_buf)
}

fn file_len(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .filter(|m| m.is_file())
        .map(|m| m.len())
}

fn read_stamp(bin_dir: &Path) -> Option<ProvisionStamp> {
    let raw = fs::read_to_string(bin_dir.join(STAMP_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_stamp(bin_dir: &Path, stamp: &ProvisionStamp) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(stamp)
        .map_err(|e| format!("failed to serialize the provisioning stamp: {e}"))?;
    fs::write(bin_dir.join(STAMP_FILE), raw)
        .map_err(|e| format!("failed to write the provisioning stamp: {e}"))
}

/// Copies `source` over `dest` without disturbing a copy that is currently executing.
///
/// The daemon may be running from `dest` right now - the app is provisioning over a service it
/// started itself, or one launchd started at boot. Writing into the file in place is what breaks
/// that: on Linux it is refused outright (`ETXTBSY`), and on macOS it is allowed and corrupts the
/// running image. A rename is atomic and leaves the old inode alive for the process still using it,
/// which keeps running its old code until it is next restarted - exactly the intent.
///
/// Windows cannot rename over a locked executable at all, so the old file is moved aside first and
/// swept up on a later run.
fn replace_binary(source: &Path, dest: &Path) -> Result<(), String> {
    let dir = dest
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", dest.display()))?;
    let name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} has no file name", dest.display()))?;

    fs::create_dir_all(dir).map_err(|e| format!("failed to create {}: {e}", dir.display()))?;

    let staged = dir.join(format!(".{name}.new"));
    let _ = fs::remove_file(&staged);
    fs::copy(source, &staged).map_err(|e| {
        format!(
            "failed to copy {} to {}: {e}",
            source.display(),
            staged.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Copied permissions should already carry the executable bit, but a sidecar that arrived
        // without one fails at spawn time with a message that names the daemon, not the bit.
        if let Err(e) = fs::set_permissions(&staged, fs::Permissions::from_mode(0o755)) {
            let _ = fs::remove_file(&staged);
            return Err(format!(
                "failed to mark {} executable: {e}",
                staged.display()
            ));
        }
    }

    #[cfg(windows)]
    if dest.exists() {
        let stale = dir.join(format!(".{name}.old"));
        let _ = fs::remove_file(&stale);
        if let Err(e) = fs::rename(dest, &stale) {
            let _ = fs::remove_file(&staged);
            return Err(format!(
                "failed to move the running {} aside: {e}",
                dest.display()
            ));
        }
    }

    fs::rename(&staged, dest).map_err(|e| {
        let _ = fs::remove_file(&staged);
        format!("failed to move {} into place: {e}", dest.display())
    })
}

/// Best-effort removal of the `.tendril.exe.old` files [`replace_binary`] leaves on Windows when it
/// has to displace a locked executable. They can only be deleted once nothing holds them open, which
/// is generally the next launch.
fn sweep_displaced(bin_dir: &Path) {
    let Ok(entries) = fs::read_dir(bin_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with('.') && name.ends_with(".old") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// The service definition an autostart unit is written from.
///
/// Deliberately not [`PlatformServiceConfig::default`]: the daemon launchd or systemd starts has
/// none of its parent's environment, so anything the installer knows and the daemon would otherwise
/// have to guess belongs on the command line.
///
/// `explicit_home` is the home to bake into the command line as `--home`, or `None` to let the daemon
/// resolve its own. Passing it unconditionally would be wrong: the daemon's own resolution honours
/// the `.tendril_location` pointer file, so a hard-coded `~/.tendril` would quietly override a
/// relocated home. Both callers therefore pass `Some` only when an operator named a home —
/// `TENDRIL_HOME` for the app, a non-default `--home` for `tendril service install`.
///
/// `binary` is what the unit will execute. The app points it at its provisioned `<home>/bin/tendril`;
/// the CLI points it at the executable the operator just ran, because that is the install they asked
/// for.
pub fn service_config(
    home: &Path,
    binary: &Path,
    explicit_home: Option<&Path>,
    managed_by: &str,
) -> PlatformServiceConfig {
    let mut args = Vec::new();
    if let Some(explicit) = explicit_home {
        args.push("--home".to_string());
        args.push(explicit.to_string_lossy().to_string());
    }
    args.push("serve".to_string());

    PlatformServiceConfig {
        service_name: SERVICE_NAME.to_string(),
        binary_path: binary.to_path_buf(),
        args,
        log_path: home.join("Logs").join("service.log"),
        tendril_home: home.to_path_buf(),
        env_vars: vec![
            // The launchd plist has no other way to name the home: unlike the systemd unit, it does
            // not write a TENDRIL_HOME line of its own.
            (
                "TENDRIL_HOME".to_string(),
                home.to_string_lossy().to_string(),
            ),
            ("TENDRIL_MANAGED_BY".to_string(), managed_by.to_string()),
        ],
    }
}

/// [`service_config`] as the app calls it: against the provisioned `<home>/bin/tendril`, with
/// `--home` baked in only when the app itself was told one through `TENDRIL_HOME`.
pub fn autostart_config(home: &Path) -> PlatformServiceConfig {
    let explicit = std::env::var("TENDRIL_HOME")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(PathBuf::from);

    service_config(
        home,
        &home.join("bin").join(CLI_BINARY),
        explicit.as_deref(),
        "Tendril-App",
    )
}

/// Registers the daemon to start with the user's session.
///
/// `force` reinstalls even when the registration already matches. It exists because a unit that is
/// textually unchanged can still be wrong: a version bump replaces `<home>/bin/tendril` with a new
/// inode, and launchd goes on running the old one until the agent is booted out and back in. The
/// callers therefore set it exactly when a binary was replaced — and `tendril service install
/// --force` exposes it for the same repair by hand.
pub fn register_autostart(config: &PlatformServiceConfig, force: bool) -> AutostartOutcome {
    register_autostart_with(config, force, true)
}

/// [`register_autostart`], with the option not to hand the unit to the service manager.
///
/// `start == false` writes (or rewrites) the unit and stops there: `tendril service install
/// --no-start` stages a registration that takes effect at the next login without disturbing whatever
/// daemon is serving right now. It is also the only form a test may call, since the alternative is
/// registering a real service on the machine running the suite.
pub fn register_autostart_with(
    config: &PlatformServiceConfig,
    force: bool,
    start: bool,
) -> AutostartOutcome {
    let _ = (force, start);

    #[cfg(target_os = "macos")]
    {
        let Some(plist) = super::platform::macos::default_plist_path() else {
            return AutostartOutcome::Failed(
                "no home directory to write a LaunchAgent into".to_string(),
            );
        };
        let desired = super::platform::macos::generate_launchd_plist(config);
        let existing = fs::read_to_string(&plist).ok();
        if !force && !unit_needs_write(&desired, existing.as_deref()) {
            return AutostartOutcome::AlreadyRegistered(plist.display().to_string());
        }
        return match super::platform::macos::install_launchd_service(config, &plist, start) {
            Ok(()) => AutostartOutcome::Registered(plist.display().to_string()),
            Err(e) => AutostartOutcome::Failed(e),
        };
    }

    #[cfg(target_os = "linux")]
    {
        let Some(unit) = super::platform::linux::default_systemd_unit_path() else {
            return AutostartOutcome::Failed(
                "no home directory to write a systemd user unit into".to_string(),
            );
        };
        let desired = super::platform::linux::generate_systemd_unit(config);
        let existing = fs::read_to_string(&unit).ok();
        if !force && !unit_needs_write(&desired, existing.as_deref()) {
            return AutostartOutcome::AlreadyRegistered(unit.display().to_string());
        }
        return match super::platform::linux::install_systemd_service(config, &unit, start) {
            Ok(()) => AutostartOutcome::Registered(unit.display().to_string()),
            Err(e) => AutostartOutcome::Failed(e),
        };
    }

    #[cfg(target_os = "windows")]
    {
        // A scheduled task has no file to diff, so existence plus `force` is the whole test.
        if !force && super::platform::windows::scheduled_task_exists(&config.service_name) {
            return AutostartOutcome::AlreadyRegistered(config.service_name.clone());
        }
        let argv = super::platform::windows::generate_schtasks_create_command(config);
        let (program, rest) = argv.split_first().expect("schtasks argv is never empty");
        return match std::process::Command::new(program).args(rest).output() {
            Ok(out) if out.status.success() => {
                AutostartOutcome::Registered(config.service_name.clone())
            }
            Ok(out) => AutostartOutcome::Failed(format!(
                "schtasks /Create exited with {}: {}",
                out.status,
                String::from_utf8_lossy(&out.stderr).trim()
            )),
            Err(e) => AutostartOutcome::Failed(format!("failed to run schtasks.exe: {e}")),
        };
    }

    #[allow(unreachable_code)]
    AutostartOutcome::Skipped("no autostart mechanism for this platform".to_string())
}

/// Removes the autostart registration, leaving `<home>/bin` and every byte of user data alone.
pub fn unregister_autostart(service_name: &str) -> Result<String, String> {
    unregister_autostart_with(service_name, true)
}

/// [`unregister_autostart`], with the option to remove the unit without stopping what it started.
///
/// `stop == false` is what a test uses: it deletes a file out of a temp `HOME` and shells out to
/// nothing.
pub fn unregister_autostart_with(service_name: &str, stop: bool) -> Result<String, String> {
    let _ = (service_name, stop);

    #[cfg(target_os = "macos")]
    {
        let Some(plist) = super::platform::macos::default_plist_path() else {
            return Err("no home directory to look for a LaunchAgent in".to_string());
        };
        super::platform::macos::uninstall_launchd_service(&plist, stop)?;
        return Ok(format!("Removed the LaunchAgent at {}.", plist.display()));
    }

    #[cfg(target_os = "linux")]
    {
        let Some(unit) = super::platform::linux::default_systemd_unit_path() else {
            return Err("no home directory to look for a systemd user unit in".to_string());
        };
        super::platform::linux::uninstall_systemd_service(&unit, stop)?;
        return Ok(format!(
            "Removed the systemd user unit at {}.",
            unit.display()
        ));
    }

    #[cfg(target_os = "windows")]
    {
        let argv = super::platform::windows::generate_schtasks_delete_command(service_name);
        let (program, rest) = argv.split_first().expect("schtasks argv is never empty");
        return match std::process::Command::new(program).args(rest).output() {
            Ok(out) if out.status.success() => {
                Ok(format!("Removed the scheduled task {service_name}."))
            }
            Ok(out) => Err(format!(
                "schtasks /Delete exited with {}: {}",
                out.status,
                String::from_utf8_lossy(&out.stderr).trim()
            )),
            Err(e) => Err(format!("failed to run schtasks.exe: {e}")),
        };
    }

    #[allow(unreachable_code)]
    Err("no autostart mechanism for this platform".to_string())
}

/// Installs the bundled sidecars into `<home>/bin` and registers autostart.
///
/// `sidecar_dir` is where the bundled copies are; `None` means the caller could not locate its own
/// executable, which is reported rather than guessed around. Errors are collected, never raised:
/// this runs on a background thread at app startup, and a machine that refuses one step still has an
/// app.
pub fn provision_with(
    app_version: &str,
    sidecar_dir: Option<&Path>,
    home: &Path,
    register: bool,
) -> ProvisionReport {
    let bin_dir = home.join("bin");
    let mut report = ProvisionReport {
        bin_dir: bin_dir.display().to_string(),
        ..Default::default()
    };

    let Some(sidecar_dir) = sidecar_dir else {
        report.errors.push(
            "could not locate the running executable, so no bundled sidecar was found".into(),
        );
        return report;
    };

    if let Err(e) = fs::create_dir_all(&bin_dir) {
        report
            .errors
            .push(format!("failed to create {}: {e}", bin_dir.display()));
        return report;
    }
    sweep_displaced(&bin_dir);

    let (stamped_version, stamped_binaries) = match read_stamp(&bin_dir) {
        Some(stamp) => (Some(stamp.app_version), stamp.binaries),
        None => (None, BTreeMap::new()),
    };
    let stamped_version = stamped_version.as_deref();
    let mut next = ProvisionStamp {
        app_version: app_version.to_string(),
        binaries: stamped_binaries,
    };

    for name in [CLI_BINARY, OPENCODE_BINARY] {
        let source = sidecar_dir.join(name);
        let dest = bin_dir.join(name);
        let source_len = file_len(&source);

        if source_len.is_none() {
            report.missing.push(name.to_string());
            continue;
        }

        if !binary_needs_install(source_len, file_len(&dest), stamped_version, app_version) {
            report.up_to_date.push(name.to_string());
            continue;
        }

        match replace_binary(&source, &dest) {
            Ok(()) => {
                next.binaries
                    .insert(name.to_string(), source_len.unwrap_or_default());
                report.installed.push(name.to_string());
            }
            Err(e) => report.errors.push(e),
        }
    }

    if register {
        // Registering against a daemon that is not there yet would be a unit pointing at nothing, so
        // the CLI has to have landed - either this run or an earlier one.
        let cli = bin_dir.join(CLI_BINARY);
        if cli.is_file() {
            report.autostart =
                register_autostart(&autostart_config(home), !report.installed.is_empty());
        } else {
            report.autostart = AutostartOutcome::Skipped(format!(
                "{} is not installed, so there is nothing to start",
                cli.display()
            ));
        }
    } else {
        report.autostart =
            AutostartOutcome::Skipped("disabled by TENDRIL_SKIP_SERVICE_AUTOSTART".to_string());
    }

    // Only after the copies succeeded. A stamp written over a failed install is how the next launch
    // decides there is nothing to do and the failure becomes permanent.
    if report.errors.is_empty() {
        if let Err(e) = write_stamp(&bin_dir, &next) {
            report.errors.push(e);
        }
    }

    report
}

/// Deletes the binaries a provisioning run put in `<home>/bin`, and the stamp that records them.
///
/// Only the names this module writes, never the directory: `<home>/bin` is on a coding agent's
/// `PATH`, so an operator may well have dropped their own tools in there and `service uninstall
/// --purge-binaries` is not an invitation to delete them. Returns what was actually removed, so the
/// caller can say "nothing to remove" rather than claim a deletion that did not happen.
pub fn purge_binaries(home: &Path) -> Result<Vec<String>, String> {
    let bin_dir = home.join("bin");
    let mut removed = Vec::new();

    for name in [CLI_BINARY, OPENCODE_BINARY, STAMP_FILE] {
        let path = bin_dir.join(name);
        match fs::remove_file(&path) {
            Ok(()) => removed.push(path.display().to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("failed to remove {}: {e}", path.display())),
        }
    }

    Ok(removed)
}

pub fn should_register_autostart() -> bool {
    !env_flag("TENDRIL_SKIP_SERVICE_AUTOSTART")
}

pub fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|v| {
            let v = v.trim();
            !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false")
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_bundled_binary_is_not_an_install() {
        assert!(!binary_needs_install(None, None, None, "1.0.0"));
        assert!(!binary_needs_install(
            None,
            Some(10),
            Some("0.9.0"),
            "1.0.0"
        ));
    }

    #[test]
    fn an_absent_or_differing_destination_installs() {
        assert!(binary_needs_install(Some(10), None, Some("1.0.0"), "1.0.0"));
        assert!(binary_needs_install(
            Some(10),
            Some(11),
            Some("1.0.0"),
            "1.0.0"
        ));
    }

    #[test]
    fn a_matching_destination_installs_only_when_the_app_moved_on() {
        assert!(!binary_needs_install(
            Some(10),
            Some(10),
            Some("1.0.0"),
            "1.0.0"
        ));
        assert!(binary_needs_install(
            Some(10),
            Some(10),
            Some("0.9.0"),
            "1.0.0"
        ));
        // No stamp at all: an install that predates this mechanism, or a hand-populated bin dir.
        assert!(binary_needs_install(Some(10), Some(10), None, "1.0.0"));
    }

    #[test]
    fn a_unit_is_rewritten_only_when_its_text_changed() {
        assert!(unit_needs_write("a", None));
        assert!(unit_needs_write("a", Some("b")));
        assert!(!unit_needs_write("a", Some("a")));
    }
}
