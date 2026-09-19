//! What `tendril service status` reports, as data rather than printed lines.
//!
//! The same split the health registry uses: `tendril_core::health` answers the questions and
//! `commands::doctor` prints them, so the app's Service settings pane and the CLI cannot drift into
//! disagreeing about what "installed" means. Everything here is a fact about the machine, and
//! nothing here decides an exit code — that is the caller's job.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::platform::{mechanism, PlatformServiceConfig, ServiceMechanism, SERVICE_NAME};
use crate::config::{inspect_master_file, EnvSource, MasterFileKind, SystemEnv};

/// What the daemon half of the report found at `<home>/.master`.
///
/// Distinct from "is the unit loaded", because the two come apart in both directions and an operator
/// has to be able to tell which: a manually started `tendril serve` is a running daemon with no
/// registration, and a plist whose binary is missing is a registration with no daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "state", content = "detail")]
pub enum DaemonState {
    /// A `.master` claim whose owning process is alive. Carries the base URL it is serving on.
    Running { url: String, pid: u32 },
    /// A `.master` claim whose owner is gone: a daemon that was killed without cleaning up.
    Stale { pid: u32 },
    /// No `.master` file at all.
    NotRunning,
    /// A `.master` that cannot be read as a claim by this build. Reported rather than ignored,
    /// because a daemon started against this home will refuse it (`MasterFileKind::Foreign`) or
    /// discard it (`Garbage`), and either way the operator's next surprise should not be a silent
    /// one.
    Unreadable { reason: String },
}

impl DaemonState {
    pub fn is_running(&self) -> bool {
        matches!(self, DaemonState::Running { .. })
    }
}

/// Everything `tendril service status` knows, in one value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub service_name: String,
    pub mechanism: ServiceMechanism,
    /// The launchd plist or systemd unit this platform would write, or `None` on Windows (the task
    /// lives in the scheduler's store) and on a platform with no mechanism.
    pub unit_path: Option<PathBuf>,
    /// Whether an autostart registration exists.
    pub installed: bool,
    /// Whether the registration on disk matches what an install would write *now*. `false` with
    /// `installed` means an upgrade moved the binary, or the unit was hand-edited: a reinstall is
    /// what fixes it, and status says so rather than leaving the operator to diff XML.
    ///
    /// `None` on Windows, where a scheduled task has no unit text to compare.
    pub unit_current: Option<bool>,
    /// Whether the service manager currently has it loaded and running.
    pub loaded: bool,
    pub tendril_home: PathBuf,
    pub daemon: DaemonState,
}

impl ServiceStatus {
    /// The one-line summary, which is also the first line the CLI prints.
    pub fn headline(&self) -> String {
        if !self.mechanism.is_supported() {
            return format!(
                "Not supported on this platform ({}); there is no service manager to install into",
                std::env::consts::OS
            );
        }
        match (self.installed, self.loaded, self.daemon.is_running()) {
            (false, _, true) => {
                "Not installed, but a daemon is running (started by hand or by the app)".to_string()
            }
            (false, _, false) => "Not installed".to_string(),
            (true, true, true) => "Installed and running".to_string(),
            // Registered and loaded, but nothing claimed `<home>/.master`. Either it is still coming
            // up, or it is crash-looping against a home it cannot write.
            (true, true, false) => {
                "Installed and loaded, but no daemon has claimed this home".to_string()
            }
            (true, false, true) => {
                "Installed but not running; the daemon serving this home is a different process"
                    .to_string()
            }
            (true, false, false) => "Installed but not running".to_string(),
        }
    }
}

/// Reads the machine's current service state.
///
/// `desired` is the config an install would write right now, and is what [`ServiceStatus::unit_current`]
/// compares against; pass `None` to skip that comparison (the app's settings pane does not need it).
/// `env` supplies `HOME`/`USERPROFILE`, so a test can point the unit lookup at a temp directory
/// instead of the LaunchAgents folder of whoever is running the suite.
pub fn status_with_env(
    tendril_home: &Path,
    desired: Option<&PlatformServiceConfig>,
    env: &impl EnvSource,
) -> ServiceStatus {
    let mechanism = mechanism();
    let unit_path = super::platform::default_unit_path_with_env(env);

    let existing = unit_path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok());

    // On Windows there is no file, so existence is the scheduler's answer; everywhere else it is
    // whether the unit is on disk. Deliberately not "is it loaded": a plist that launchd has not
    // picked up yet is still installed, and telling an operator it is not would send them into a
    // second install that changes nothing.
    let installed = match mechanism {
        ServiceMechanism::ScheduledTask => super::platform::service_is_installed(SERVICE_NAME),
        ServiceMechanism::Unsupported => false,
        _ => existing.is_some(),
    };

    let unit_current = match (mechanism, desired, existing.as_deref()) {
        (ServiceMechanism::ScheduledTask | ServiceMechanism::Unsupported, _, _) => None,
        (_, None, _) => None,
        (_, Some(_), None) => Some(false),
        (_, Some(config), Some(existing)) => Some(!super::provision::unit_needs_write(
            &render_unit(mechanism, config),
            Some(existing),
        )),
    };

    ServiceStatus {
        service_name: SERVICE_NAME.to_string(),
        mechanism,
        unit_path,
        installed,
        unit_current,
        loaded: mechanism.is_supported() && super::platform::service_is_loaded(SERVICE_NAME),
        tendril_home: tendril_home.to_path_buf(),
        daemon: daemon_state(tendril_home),
    }
}

/// [`status_with_env`] against the real environment.
pub fn status(tendril_home: &Path, desired: Option<&PlatformServiceConfig>) -> ServiceStatus {
    status_with_env(tendril_home, desired, &SystemEnv)
}

/// The unit text this platform would write for `config`.
///
/// Every platform's generator is compiled into every build - they are pure string formatting - so
/// this dispatches on [`mechanism`] rather than on `cfg`, which is also what makes the comparison
/// testable from a macOS CI runner.
fn render_unit(mechanism: ServiceMechanism, config: &PlatformServiceConfig) -> String {
    match mechanism {
        ServiceMechanism::Launchd => super::platform::macos::generate_launchd_plist(config),
        ServiceMechanism::Systemd => super::platform::linux::generate_systemd_unit(config),
        ServiceMechanism::ScheduledTask => super::platform::windows::generate_task_xml(config),
        ServiceMechanism::Unsupported => String::new(),
    }
}

/// The daemon half, read from `<home>/.master`.
///
/// [`inspect_master_file`] rather than an HTTP probe: status must answer on a machine with no daemon
/// and no network, and `MasterClaim::owner_is_running` already distinguishes a live owner from a
/// recycled pid through the process start token.
pub fn daemon_state(tendril_home: &Path) -> DaemonState {
    match inspect_master_file(tendril_home) {
        MasterFileKind::Missing => DaemonState::NotRunning,
        MasterFileKind::Garbage => DaemonState::Unreadable {
            reason: format!("{}/.master is not a JSON document", tendril_home.display()),
        },
        MasterFileKind::Foreign { schema_version } => DaemonState::Unreadable {
            reason: format!(
                "{}/.master was written to schema version {}, which this build does not understand",
                tendril_home.display(),
                schema_version
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "unmarked".to_string())
            ),
        },
        MasterFileKind::Claim(claim) => {
            if claim.owner_is_running() {
                DaemonState::Running {
                    url: claim.info.base_url(),
                    pid: claim.info.pid,
                }
            } else {
                DaemonState::Stale {
                    pid: claim.info.pid,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tendril-service-status-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn env_home(home: &Path) -> HashMap<String, String> {
        // Both, because `dirs_home_with_env` prefers `USERPROFILE`; leaving it to the ambient
        // environment on a Windows runner would send the lookup at the real profile directory.
        HashMap::from([
            ("HOME".to_string(), home.display().to_string()),
            ("USERPROFILE".to_string(), home.display().to_string()),
        ])
    }

    #[test]
    fn a_home_with_no_unit_reports_not_installed() {
        let fake_home = scratch("no-unit");
        let tendril_home = scratch("no-unit-th");

        let status = status_with_env(&tendril_home, None, &env_home(&fake_home));

        if status.mechanism == ServiceMechanism::ScheduledTask {
            // Windows has no file to look for; the scheduler is the only source, and this test
            // cannot isolate it.
            return;
        }
        assert!(!status.installed, "{status:?}");
        assert_eq!(status.daemon, DaemonState::NotRunning);
        assert_eq!(status.headline(), "Not installed");
    }

    #[test]
    fn a_unit_that_matches_the_desired_config_is_current() {
        let fake_home = scratch("current");
        let tendril_home = scratch("current-th");
        let env = env_home(&fake_home);
        let Some(unit_path) = super::super::platform::default_unit_path_with_env(&env) else {
            return; // Windows or an unsupported platform: nothing to write.
        };

        let config = super::super::provision::service_config(
            &tendril_home,
            Path::new("/opt/tendril/bin/tendril"),
            None,
            "Tendril-CLI",
        );
        std::fs::create_dir_all(unit_path.parent().unwrap()).unwrap();
        std::fs::write(&unit_path, render_unit(mechanism(), &config)).unwrap();

        let status = status_with_env(&tendril_home, Some(&config), &env);
        assert!(status.installed);
        assert_eq!(status.unit_current, Some(true), "{status:?}");
    }

    /// The case an upgrade produces: the unit is there, but it names the binary of a previous
    /// install. `status` has to say so, because the fix is a reinstall and nothing else reports it.
    #[test]
    fn a_unit_written_for_a_different_binary_is_stale() {
        let fake_home = scratch("stale");
        let tendril_home = scratch("stale-th");
        let env = env_home(&fake_home);
        let Some(unit_path) = super::super::platform::default_unit_path_with_env(&env) else {
            return;
        };

        let old = super::super::provision::service_config(
            &tendril_home,
            Path::new("/old/location/tendril"),
            None,
            "Tendril-CLI",
        );
        let new = super::super::provision::service_config(
            &tendril_home,
            Path::new("/new/location/tendril"),
            None,
            "Tendril-CLI",
        );
        std::fs::create_dir_all(unit_path.parent().unwrap()).unwrap();
        std::fs::write(&unit_path, render_unit(mechanism(), &old)).unwrap();

        let status = status_with_env(&tendril_home, Some(&new), &env);
        assert!(status.installed);
        assert_eq!(status.unit_current, Some(false), "{status:?}");
    }

    #[test]
    fn a_master_file_naming_a_dead_process_is_stale_not_running() {
        let tendril_home = scratch("stale-master");
        // Pid 0 is never a user process, and `owner_is_running` starts with a plain liveness check.
        std::fs::write(
            tendril_home.join(".master"),
            r#"{"scheme":"http","host":"127.0.0.1","port":5010,"pid":0,"secret":"x"}"#,
        )
        .unwrap();

        assert_eq!(daemon_state(&tendril_home), DaemonState::Stale { pid: 0 });
    }

    #[test]
    fn an_unparseable_master_file_is_reported_rather_than_ignored() {
        let tendril_home = scratch("garbage-master");
        std::fs::write(tendril_home.join(".master"), "not json at all").unwrap();

        match daemon_state(&tendril_home) {
            DaemonState::Unreadable { reason } => {
                assert!(reason.contains(".master"), "{reason}")
            }
            other => panic!("garbage must not read as a state: {other:?}"),
        }
    }

    /// The three-way distinction the headline exists to draw. A registration that is not running and
    /// a daemon that is running without one are different problems with different fixes, and the
    /// summary line has to be able to say which.
    #[test]
    fn the_headline_separates_registration_from_execution() {
        let base = ServiceStatus {
            service_name: SERVICE_NAME.to_string(),
            mechanism: ServiceMechanism::Launchd,
            unit_path: None,
            installed: true,
            unit_current: Some(true),
            loaded: false,
            tendril_home: PathBuf::from("/tmp/x"),
            daemon: DaemonState::NotRunning,
        };

        assert_eq!(base.headline(), "Installed but not running");
        assert_eq!(
            ServiceStatus {
                loaded: true,
                daemon: DaemonState::Running {
                    url: "http://127.0.0.1:5010".to_string(),
                    pid: 1
                },
                ..base.clone()
            }
            .headline(),
            "Installed and running"
        );
        assert_eq!(
            ServiceStatus {
                installed: false,
                daemon: DaemonState::Running {
                    url: "http://127.0.0.1:5010".to_string(),
                    pid: 1
                },
                ..base.clone()
            }
            .headline(),
            "Not installed, but a daemon is running (started by hand or by the app)"
        );
        assert!(ServiceStatus {
            mechanism: ServiceMechanism::Unsupported,
            ..base
        }
        .headline()
        .starts_with("Not supported on this platform"));
    }
}
