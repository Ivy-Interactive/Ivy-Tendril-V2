//! `tendril service install|uninstall|status` — the daemon's autostart registration.
//!
//! The platform work is not here. It lives in [`tendril_core::service`], which the desktop app also
//! calls: both register the same launchd label, the same systemd unit name and the same scheduled
//! task, so a second copy of that logic would be two programs silently overwriting each other's
//! registration. This module is the CLI's share of it — argument surface, printing, exit codes —
//! exactly as `commands::doctor` is a printer over `tendril_core::health`.
//!
//! The one thing the CLI does differently from the app: the app provisions a machine that has
//! nothing on it, copying its bundled `tendril` sidecar into `<home>/bin` and registering against
//! that copy. The CLI *is* the binary, so `install` registers against [`std::env::current_exe`] and
//! copies nothing.
//!
//! Exit codes, because a wrapper script's `$?` is the point of having a CLI at all:
//!
//! | situation                              | code | why                                            |
//! |----------------------------------------|------|------------------------------------------------|
//! | installed, or already installed        | 0    | idempotent: asking for a state you are in is ok |
//! | uninstalled, or was not installed      | 0    | same, in reverse                                |
//! | `status` on any state it can describe  | 0    | status reports; it does not judge               |
//! | permission denied, `launchctl` refused | 1    | the operator's request did not happen           |
//! | platform with no service manager       | 1    | the request cannot ever happen here             |

use clap::Subcommand;
use std::path::Path;

use tendril_core::service::{
    self, provision, status, AutostartOutcome, DaemonState, PlatformServiceConfig,
    ServiceMechanism, ServiceStatus, SERVICE_NAME,
};

#[derive(Subcommand)]
pub enum ServiceCommands {
    #[command(about = "Register the Tendril daemon to start with your session")]
    Install {
        /// Write the unit but do not hand it to the service manager. The registration takes effect
        /// at the next login, and whatever daemon is serving right now is left alone.
        #[arg(
            long,
            help = "Write the autostart unit without starting the service now"
        )]
        no_start: bool,

        /// Reinstall even when the unit already matches. A unit whose text is unchanged can still be
        /// stale: after an upgrade, launchd goes on running the previous binary until the agent is
        /// booted out and back in.
        #[arg(long, help = "Reinstall even if the service is already registered")]
        force: bool,
    },

    #[command(about = "Remove the Tendril daemon's autostart registration")]
    Uninstall {
        /// Also delete the `tendril` and `opencode` binaries a desktop-app install copied into
        /// `<home>/bin`. Off by default: uninstalling autostart should not remove the daemon an
        /// operator may still run by hand.
        #[arg(
            long,
            help = "Also remove the binaries the desktop app installed into <home>/bin"
        )]
        purge_binaries: bool,

        /// Remove the registration even when it is not the one this executable would write. Without
        /// it, `uninstall` refuses rather than deleting a unit that belongs to another Tendril.
        #[arg(
            long,
            help = "Remove the registration even if it belongs to another Tendril"
        )]
        force: bool,
    },

    #[command(about = "Show whether the service is registered and running")]
    Status {
        #[arg(long, help = "Print the status as JSON")]
        json: bool,
    },
}

pub fn handle_service_command(
    cmd: ServiceCommands,
    tendril_home: &Path,
    home_was_explicit: bool,
) -> anyhow::Result<()> {
    match cmd {
        ServiceCommands::Install { no_start, force } => {
            handle_install(tendril_home, home_was_explicit, no_start, force)
        }
        ServiceCommands::Uninstall {
            purge_binaries,
            force,
        } => handle_uninstall(tendril_home, home_was_explicit, purge_binaries, force),
        ServiceCommands::Status { json } => handle_status(tendril_home, home_was_explicit, json),
    }
}

/// The unit an install would write from this executable.
///
/// `home_was_explicit` decides whether `--home` is baked into the command line. Passing it
/// unconditionally would be wrong: the daemon's own resolution honours the `.tendril_location`
/// pointer file, so a hard-coded `~/.tendril` in the unit would quietly override a home the operator
/// later relocates. Only a home they actually named is worth pinning.
fn desired_config(
    tendril_home: &Path,
    home_was_explicit: bool,
) -> anyhow::Result<PlatformServiceConfig> {
    let binary = std::env::current_exe().map_err(|e| {
        anyhow::anyhow!(
            "could not locate the running tendril executable, so there is nothing to register: {e}"
        )
    })?;

    Ok(provision::service_config(
        tendril_home,
        &binary,
        home_was_explicit.then_some(tendril_home),
        "Tendril-CLI",
    ))
}

/// Refuses on a platform with no service manager, with the message and the non-zero exit the harness
/// asks for rather than a panic or a silent success.
fn require_supported(mechanism: ServiceMechanism) -> anyhow::Result<()> {
    if mechanism.is_supported() {
        return Ok(());
    }
    anyhow::bail!(
        "Tendril has no autostart mechanism for {}. Supported: macOS (launchd), Linux (systemd \
         user units) and Windows (Task Scheduler). Run `tendril serve` yourself, or start it from \
         whatever supervisor this platform provides.",
        std::env::consts::OS
    )
}

fn handle_install(
    tendril_home: &Path,
    home_was_explicit: bool,
    no_start: bool,
    force: bool,
) -> anyhow::Result<()> {
    require_supported(service::mechanism())?;

    let config = desired_config(tendril_home, home_was_explicit)?;
    // The log directory is named by the unit; launchd will not create it, and a plist whose
    // StandardOutPath cannot be opened fails to start with nothing written anywhere to say why.
    if let Some(parent) = config.log_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            anyhow::anyhow!(
                "could not create the log directory {}: {e}",
                parent.display()
            )
        })?;
    }

    // Refuse to silently repoint someone else's registration. `unit_current` is `Some(false)` when
    // a unit exists whose text is not what we would write - which is the upgrade case (same install,
    // moved binary) *and* the case that matters here: a second Tendril, or the desktop app's copy,
    // already owns this label. The two are indistinguishable from the unit text alone, so this does
    // not guess between them; it prints the unit it found and stops, and `--force` is the operator
    // saying they meant it. Without this, `install` exits 0 having taken the registration away from
    // whatever wrote it, and nothing anywhere says so.
    //
    // `None` (Windows, where a scheduled task has no unit text to diff) falls through unchanged -
    // there is nothing to compare, so there is no conflict to report.
    if !force {
        let existing = status(tendril_home, Some(&config));
        if existing.installed && existing.unit_current == Some(false) {
            let where_ = existing
                .unit_path
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| SERVICE_NAME.to_string());
            anyhow::bail!(
                "{SERVICE_NAME} is already registered at {where_}, and that registration is not \
                 the one this executable would write - it names a different binary or a different \
                 Tendril home.\nThis is what an upgrade looks like, and it is also what a second \
                 Tendril installation looks like. Run `tendril service status` to see which, then \
                 `tendril service install --force` to take it over."
            );
        }
    }

    println!(
        "Installing the Tendril service ({}).",
        service::mechanism().label()
    );
    println!("  Binary:       {}", config.binary_path.display());
    println!("  Tendril home: {}", tendril_home.display());

    match provision::register_autostart_with(&config, force, !no_start) {
        AutostartOutcome::Registered(where_) => {
            println!("Registered {SERVICE_NAME} at {where_}.");
            if no_start {
                println!(
                    "Not started, as asked. It will come up at your next login, or run `tendril \
                     service install` without --no-start to start it now."
                );
            }
            Ok(())
        }
        // Not an error: `install` is a statement of the state you want, and you are in it.
        AutostartOutcome::AlreadyRegistered(where_) => {
            println!("Already registered at {where_}; nothing to do.");
            println!("Use `tendril service install --force` to reinstall it anyway.");
            Ok(())
        }
        AutostartOutcome::Skipped(reason) => anyhow::bail!("Service install skipped: {reason}"),
        AutostartOutcome::Failed(reason) => anyhow::bail!(
            "Could not register {SERVICE_NAME}: {reason}\nThis is usually a permissions problem \
             with the directory the unit is written into — check that you own it and that it is \
             writable."
        ),
    }
}

fn handle_uninstall(
    tendril_home: &Path,
    home_was_explicit: bool,
    purge: bool,
    force: bool,
) -> anyhow::Result<()> {
    require_supported(service::mechanism())?;

    // `Some(desired)` rather than `None`: passing `None` leaves `unit_current` unset, and without it
    // this command cannot tell its own registration from one another Tendril wrote. `unregister`
    // removes by service name, so that difference is the difference between removing what you
    // installed and removing what someone else did - and then reporting success either way.
    let desired = desired_config(tendril_home, home_was_explicit).ok();
    let before = status(tendril_home, desired.as_ref());
    if !before.installed {
        // Idempotent in the other direction: asking for a state you are already in is success.
        println!("The Tendril service is not registered; nothing to remove.");
        if purge {
            purge_and_report(tendril_home)?;
        }
        return Ok(());
    }

    if !force && before.unit_current == Some(false) {
        let where_ = before
            .unit_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| SERVICE_NAME.to_string());
        anyhow::bail!(
            "The registration at {where_} is not the one this executable would write - it names a \
             different binary or a different Tendril home, so removing it would uninstall another \
             Tendril's service.\nRun `tendril service status` to see what is registered, then \
             `tendril service uninstall --force` if you meant this one."
        );
    }

    match provision::unregister_autostart(SERVICE_NAME) {
        Ok(message) => println!("{message}"),
        Err(reason) => anyhow::bail!(
            "Could not remove {SERVICE_NAME}: {reason}\nThis is usually a permissions problem with \
             the unit file — check that you own it and that its directory is writable."
        ),
    }

    if purge {
        purge_and_report(tendril_home)?;
    } else {
        println!(
            "Left {} alone. Pass --purge-binaries to remove the binaries the desktop app \
             installed there.",
            tendril_home.join("bin").display()
        );
    }

    // An uninstall removes the registration, not the running daemon's data - and on macOS
    // `launchctl bootout` has already stopped it, while a daemon somebody started by hand keeps
    // going. Saying which is the difference between a clean exit and a confused operator.
    if let DaemonState::Running { url, pid } = daemon_of(tendril_home) {
        println!(
            "Note: a daemon is still serving {url} (pid {pid}). It was not started by this \
             registration, so it is left running."
        );
    }

    Ok(())
}

fn purge_and_report(tendril_home: &Path) -> anyhow::Result<()> {
    let removed = provision::purge_binaries(tendril_home)
        .map_err(|e| anyhow::anyhow!("Could not remove the installed binaries: {e}"))?;
    if removed.is_empty() {
        println!(
            "No installed binaries to remove from {}.",
            tendril_home.join("bin").display()
        );
    } else {
        for path in removed {
            println!("Removed {path}.");
        }
    }
    Ok(())
}

/// The daemon half of the status, re-read after an uninstall so the note above reflects the world as
/// it is now rather than as it was before `launchctl bootout` ran.
fn daemon_of(tendril_home: &Path) -> DaemonState {
    service::daemon_state(tendril_home)
}

fn handle_status(tendril_home: &Path, home_was_explicit: bool, json: bool) -> anyhow::Result<()> {
    // `desired_config` can only fail when the running executable cannot be located, which would make
    // the "is the unit current?" comparison meaningless rather than wrong. Status still has an answer
    // for everything else, so it degrades instead of bailing.
    let desired = desired_config(tendril_home, home_was_explicit).ok();
    let report = status(tendril_home, desired.as_ref());

    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }

    print_status(&report);
    // Deliberately `Ok` for every state it can describe, including "not installed". Status is a
    // report, and a wrapper that wants a verdict should read `installed`/`loaded` out of --json
    // rather than have this command invent a failure out of a fact.
    Ok(())
}

fn print_status(report: &ServiceStatus) {
    println!("{}", report.headline());
    println!("  Mechanism:    {}", report.mechanism.label());
    println!("  Service name: {}", report.service_name);
    println!("  Tendril home: {}", report.tendril_home.display());

    match &report.unit_path {
        Some(path) if report.installed => println!("  Unit:         {}", path.display()),
        Some(path) => println!("  Unit:         {} (not present)", path.display()),
        // Windows: the definition lives in the scheduler's own store, so there is no path to print.
        None if report.mechanism == ServiceMechanism::ScheduledTask => {
            println!("  Unit:         registered with Task Scheduler (no unit file)")
        }
        None => {}
    }

    // Only worth saying when something *is* registered. With nothing installed `unit_current` is
    // honestly `false` — no unit matches what an install would write — but telling an operator their
    // absent registration is "out of date" and pointing them at `--force` is nonsense; the headline
    // has already told them to run a plain `install`.
    if report.installed && report.unit_current == Some(false) {
        println!(
            "  Unit:         out of date — it does not match what an install would write now. \
             Run `tendril service install --force`."
        );
    }

    match &report.daemon {
        DaemonState::Running { url, pid } => println!("  Daemon:       serving {url} (pid {pid})"),
        DaemonState::NotRunning => println!("  Daemon:       not running"),
        DaemonState::Stale { pid } => {
            println!("  Daemon:       not running (a stale .master names pid {pid}, which is gone)")
        }
        DaemonState::Unreadable { reason } => println!("  Daemon:       unknown — {reason}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tendril-cli-service-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The CLI registers the executable the operator ran, not a copy in `<home>/bin` — that is the
    /// app's job, and pointing a CLI install at a path the CLI never writes would register a unit
    /// for a binary that is not there.
    #[test]
    fn install_registers_the_running_executable() {
        let home = scratch("current-exe");
        let config = desired_config(&home, false).expect("current_exe");

        assert_eq!(
            config.binary_path,
            std::env::current_exe().unwrap(),
            "the CLI must register itself, not a provisioned copy"
        );
        assert_eq!(config.args, vec!["serve".to_string()]);
    }

    /// A `--home` the operator named is pinned into the unit; a default one is not, because the
    /// daemon's own resolution honours `.tendril_location` and a baked-in `~/.tendril` would override
    /// a later relocation.
    #[test]
    fn only_an_explicit_home_is_baked_into_the_unit() {
        let home = scratch("explicit-home");

        let implicit = desired_config(&home, false).expect("current_exe");
        assert_eq!(implicit.args, vec!["serve".to_string()]);

        let explicit = desired_config(&home, true).expect("current_exe");
        assert_eq!(
            explicit.args,
            vec![
                "--home".to_string(),
                home.display().to_string(),
                "serve".to_string()
            ]
        );
    }

    /// An unsupported platform must produce a message naming the platform and a non-zero exit, not a
    /// panic and not a silent success.
    #[test]
    fn an_unsupported_platform_refuses_with_an_explanation() {
        let err = require_supported(ServiceMechanism::Unsupported)
            .expect_err("an unsupported platform cannot install");
        let message = err.to_string();
        assert!(message.contains(std::env::consts::OS), "{message}");
        assert!(message.contains("launchd"), "{message}");

        assert!(require_supported(ServiceMechanism::Launchd).is_ok());
        assert!(require_supported(ServiceMechanism::Systemd).is_ok());
        assert!(require_supported(ServiceMechanism::ScheduledTask).is_ok());
    }
}
