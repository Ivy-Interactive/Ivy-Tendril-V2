//! Installing the background service when the app is installed.
//!
//! A Tendril installer drops one thing on the machine: the app. Everything the app is for — plans,
//! jobs, chat — is served by the `tendril` daemon, and until now the only ways to get one were to
//! install the CLI separately or to let the app spawn a managed child that dies with it. Neither is
//! what "install Tendril" should mean.
//!
//! So on first run the app provisions itself:
//!
//! 1. The bundled sidecars (`tendril`, `opencode`) are copied out of the app next to each other in
//!    `<tendril home>/bin`. That directory is not an arbitrary choice - it is the `binary_path` in
//!    [`PlatformServiceConfig::default`], the directory `tendril-core`'s `agent_path` puts on an
//!    agent's `PATH`, and the third probe in `resolve_opencode_binary`. Putting both binaries there
//!    is what makes a daemon started by launchd, with none of the app's environment, still find the
//!    agent it has to run.
//! 2. An autostart unit (launchd agent / systemd user unit / scheduled task) is registered against
//!    that copy, so the daemon comes back after a reboot without the app being open.
//!
//! Every step is idempotent and every step is allowed to fail. A machine where the LaunchAgents
//! directory is not writable still gets a working app - it just gets the managed child it always
//! had. Nothing here is on the path to showing a window.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::platform::PlatformServiceConfig;

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
const STAMP_FILE: &str = ".provisioned";

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
        !self.installed.is_empty()
            || matches!(self.autostart, AutostartOutcome::Registered(_))
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
    fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
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

    fs::create_dir_all(dir)
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;

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

/// The service definition the autostart unit is written from.
///
/// Deliberately not [`PlatformServiceConfig::default`]: the daemon launchd or systemd starts has
/// none of the app's environment, so anything the app knows and the daemon would otherwise have to
/// guess belongs on the command line.
///
/// `--home` is passed only when the app itself was told one through `TENDRIL_HOME`. Left alone, the
/// daemon resolves its own home, which also honours the `.tendril_location` pointer file that the
/// app's simpler `resolve_tendril_home` does not - so an unconditional `--home` would quietly
/// override a relocated home with `~/.tendril`.
pub fn autostart_config(home: &Path) -> PlatformServiceConfig {
    let mut args = Vec::new();
    if let Ok(explicit) = std::env::var("TENDRIL_HOME") {
        if !explicit.trim().is_empty() {
            args.push("--home".to_string());
            args.push(explicit.trim().to_string());
        }
    }
    args.push("serve".to_string());

    PlatformServiceConfig {
        service_name: "com.spacecorps.tendril.service".to_string(),
        binary_path: home.join("bin").join(CLI_BINARY),
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
            ("TENDRIL_MANAGED_BY".to_string(), "Tendril-App".to_string()),
        ],
    }
}

#[cfg(target_os = "windows")]
fn scheduled_task_exists(service_name: &str) -> bool {
    std::process::Command::new("schtasks.exe")
        .args(["/Query", "/TN", service_name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Registers the daemon to start with the user's session.
///
/// `force` bypasses the "is it already there?" check on platforms that cannot compare a unit file's
/// contents; the callers set it when a binary was replaced, since the task then points at something
/// new even though its definition is textually the same.
pub fn register_autostart(config: &PlatformServiceConfig, force: bool) -> AutostartOutcome {
    let _ = force;

    #[cfg(target_os = "macos")]
    {
        let Some(plist) = super::platform::macos::default_plist_path() else {
            return AutostartOutcome::Failed(
                "no home directory to write a LaunchAgent into".to_string(),
            );
        };
        let desired = super::platform::macos::generate_launchd_plist(config);
        let existing = fs::read_to_string(&plist).ok();
        if !unit_needs_write(&desired, existing.as_deref()) {
            return AutostartOutcome::AlreadyRegistered(plist.display().to_string());
        }
        return match super::platform::macos::install_launchd_service(config, &plist) {
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
        if !unit_needs_write(&desired, existing.as_deref()) {
            return AutostartOutcome::AlreadyRegistered(unit.display().to_string());
        }
        return match super::platform::linux::install_systemd_service(config, &unit) {
            Ok(()) => AutostartOutcome::Registered(unit.display().to_string()),
            Err(e) => AutostartOutcome::Failed(e),
        };
    }

    #[cfg(target_os = "windows")]
    {
        // A scheduled task has no file to diff, so existence plus `force` is the whole test.
        if !force && scheduled_task_exists(&config.service_name) {
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
    let _ = service_name;

    #[cfg(target_os = "macos")]
    {
        let Some(plist) = super::platform::macos::default_plist_path() else {
            return Err("no home directory to look for a LaunchAgent in".to_string());
        };
        super::platform::macos::uninstall_launchd_service(&plist)?;
        return Ok(format!("Removed the LaunchAgent at {}.", plist.display()));
    }

    #[cfg(target_os = "linux")]
    {
        let Some(unit) = super::platform::linux::default_systemd_unit_path() else {
            return Err("no home directory to look for a systemd user unit in".to_string());
        };
        super::platform::linux::uninstall_systemd_service(&unit)?;
        return Ok(format!("Removed the systemd user unit at {}.", unit.display()));
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
/// `sidecar_dir` is where the bundled copies are; `None` means the app could not locate its own
/// executable, which is reported rather than guessed around. Errors are collected, never raised:
/// this runs on a background thread at startup, and a machine that refuses one step still has an
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
        report
            .errors
            .push("could not locate the running executable, so no bundled sidecar was found".into());
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
            report.autostart = register_autostart(
                &autostart_config(home),
                !report.installed.is_empty(),
            );
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

/// Whether startup provisioning should run at all.
///
/// Off in debug builds unless asked for: `cargo run` and `pnpm dev:desktop` stage debug sidecars
/// next to the executable, and copying those over a developer's real `~/.tendril/bin/tendril` -
/// then registering launchd against it - is not something a dev build should do to a machine.
pub fn should_provision_on_startup() -> bool {
    if env_flag("TENDRIL_SKIP_SERVICE_PROVISION") {
        return false;
    }
    if cfg!(debug_assertions) {
        return env_flag("TENDRIL_PROVISION_SERVICE");
    }
    true
}

pub fn should_register_autostart() -> bool {
    !env_flag("TENDRIL_SKIP_SERVICE_AUTOSTART")
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|v| {
            let v = v.trim();
            !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false")
        })
        .unwrap_or(false)
}

/// The startup entry point: provision against the real app version, sidecar directory and home.
pub fn provision(home: &Path) -> ProvisionReport {
    provision_with(
        env!("CARGO_PKG_VERSION"),
        sidecar_dir().as_deref(),
        home,
        should_register_autostart(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_bundled_binary_is_not_an_install() {
        assert!(!binary_needs_install(None, None, None, "1.0.0"));
        assert!(!binary_needs_install(None, Some(10), Some("0.9.0"), "1.0.0"));
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

    #[test]
    fn the_autostart_command_names_the_installed_cli_and_not_the_bundled_one() {
        let home = PathBuf::from("/tmp/tendril-home");
        let cfg = autostart_config(&home);
        assert_eq!(cfg.binary_path, home.join("bin").join(CLI_BINARY));
        assert_eq!(cfg.args.last().map(String::as_str), Some("serve"));
        assert!(cfg
            .env_vars
            .iter()
            .any(|(k, v)| k == "TENDRIL_HOME" && v == "/tmp/tendril-home"));
    }
}
