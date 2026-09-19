//! The unit text every platform writes.
//!
//! Moved here with the platform layer itself (it was `src-tauri/tests/platform_service_tests.rs`),
//! because the generators are now shared: `tendril service install` and the desktop app both write
//! *these* strings, and a change to one of them changes what both install.
//!
//! Every generator is pure string formatting and is compiled into every build, so all three are
//! asserted on whatever platform runs the suite — a Linux CI runner still catches a broken plist.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tendril_core::service::platform::linux::{generate_systemd_unit, SYSTEMD_UNIT_NAME};
use tendril_core::service::platform::macos::{
    default_plist_path_with_env, generate_launchd_plist, install_launchd_service,
    uninstall_launchd_service,
};
use tendril_core::service::platform::windows::{
    generate_schtasks_create_command, generate_schtasks_delete_command,
    generate_schtasks_query_command, generate_schtasks_status_command, generate_task_xml,
};
use tendril_core::service::platform::{
    default_unit_path_with_env, mechanism, PlatformServiceConfig, ServiceMechanism, SERVICE_NAME,
};

/// A fixture directory that removes itself. `tempfile` is not a dependency of this crate, so the
/// fixture is built the way `attachment_staging_test` builds its own.
struct Scratch(PathBuf);

impl Scratch {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tendril-service-platform-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    /// An environment whose home is this directory. Both names, because `dirs_home_with_env` prefers
    /// `USERPROFILE`: leaving it to the ambient environment on a Windows runner would point the
    /// lookup at the real profile directory, which is exactly the "a test that depends on the
    /// machine it runs on" failure this fixture exists to avoid.
    fn env(&self) -> HashMap<String, String> {
        HashMap::from([
            ("HOME".to_string(), self.0.display().to_string()),
            ("USERPROFILE".to_string(), self.0.display().to_string()),
        ])
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn sample_config() -> PlatformServiceConfig {
    PlatformServiceConfig {
        service_name: SERVICE_NAME.to_string(),
        binary_path: PathBuf::from("/usr/local/bin/tendril"),
        args: vec![
            "serve".to_string(),
            "--port".to_string(),
            "5010".to_string(),
        ],
        tendril_home: PathBuf::from("/Users/test/.tendril"),
        log_path: PathBuf::from("/Users/test/.tendril/Logs/service.log"),
        env_vars: vec![
            (
                "TENDRIL_HOME".to_string(),
                "/Users/test/.tendril".to_string(),
            ),
            ("TENDRIL_MANAGED_BY".to_string(), "Tendril-App".to_string()),
        ],
    }
}

#[test]
fn test_macos_launchd_plist_generation() {
    let cfg = sample_config();
    let plist = generate_launchd_plist(&cfg);

    assert!(plist.contains("<key>Label</key>"));
    assert!(plist.contains("<string>com.spacecorps.tendril.service</string>"));
    assert!(plist.contains("<string>/usr/local/bin/tendril</string>"));
    assert!(plist.contains("<string>serve</string>"));
    assert!(plist.contains("<key>RunAtLoad</key>"));
    assert!(plist.contains("<true/>"));
    assert!(plist.contains("<key>StandardOutPath</key>"));
    assert!(plist.contains("/Users/test/.tendril/Logs/service.log"));
    assert!(plist.contains("<key>TENDRIL_MANAGED_BY</key>"));
}

#[test]
fn test_linux_systemd_unit_generation() {
    let cfg = sample_config();
    let unit = generate_systemd_unit(&cfg);

    assert!(unit.contains("[Unit]"));
    assert!(unit.contains("Description=Tendril Background Service Daemon"));
    assert!(unit.contains("ExecStart=/usr/local/bin/tendril serve --port 5010"));
    assert!(unit.contains("WorkingDirectory=/Users/test/.tendril"));
    assert!(unit.contains("StandardOutput=append:/Users/test/.tendril/Logs/service.log"));
    assert!(unit.contains("Environment=\"TENDRIL_HOME=/Users/test/.tendril\""));
    assert!(unit.contains("Environment=\"TENDRIL_MANAGED_BY=Tendril-App\""));
    assert!(unit.contains("WantedBy=default.target"));
}

#[test]
fn test_windows_task_xml_and_schtasks_generation() {
    let cfg = sample_config();
    let xml = generate_task_xml(&cfg);

    assert!(xml.contains("<Task version=\"1.2\""));
    assert!(xml.contains("<Description>Tendril Background Service</Description>"));
    assert!(xml.contains("<LogonTrigger>"));
    assert!(xml.contains("<Command>/usr/local/bin/tendril</Command>"));
    assert!(xml.contains("<Arguments>serve --port 5010</Arguments>"));
    assert!(xml.contains("<WorkingDirectory>/Users/test/.tendril</WorkingDirectory>"));

    let schtasks_cmd = generate_schtasks_create_command(&cfg);
    assert_eq!(schtasks_cmd[0], "schtasks.exe");
    assert_eq!(schtasks_cmd[1], "/Create");
    assert_eq!(schtasks_cmd[3], "com.spacecorps.tendril.service");
    assert_eq!(schtasks_cmd[7], "ONLOGON");
}

/// The query and delete argv, which the app's copy could not assert: they were inlined behind
/// `cfg(windows)`, so no macOS or Linux CI run ever saw them. They are functions here for that
/// reason — a scheduled task is registered and removed by name, and getting the name wrong on either
/// side leaves an orphaned task that starts a daemon nothing can uninstall.
#[test]
fn the_windows_query_and_delete_commands_name_the_same_task() {
    let query = generate_schtasks_query_command(SERVICE_NAME);
    assert_eq!(query[0], "schtasks.exe");
    assert_eq!(query[1], "/Query");
    assert_eq!(query[2], "/TN");
    assert_eq!(query[3], SERVICE_NAME);

    let delete = generate_schtasks_delete_command(SERVICE_NAME);
    assert_eq!(delete[0], "schtasks.exe");
    assert_eq!(delete[1], "/Delete");
    assert_eq!(delete[3], SERVICE_NAME);
    // Without /F the scheduler prompts, and a CLI uninstall would hang on a confirmation nobody can
    // see.
    assert!(delete.contains(&"/F".to_string()));

    let create = generate_schtasks_create_command(&sample_config());
    assert!(create.contains(&"/F".to_string()));
}

/// The existence probe and the running probe are different questions, and the argv is where the
/// difference lives.
///
/// `ServiceStatus` reports `installed` and `loaded` separately, and on Windows both answers come out
/// of `schtasks /Query` — the only thing telling them apart is `/FO LIST`, which is what makes the
/// scheduler print the `Status:` line a running check parses. Reading `installed` off the running
/// probe once reported a registered-but-idle task as not installed, so the split is pinned here
/// rather than left to the one platform that cannot run this suite.
#[test]
fn the_windows_existence_probe_is_not_the_running_probe() {
    let exists = generate_schtasks_query_command(SERVICE_NAME);
    let running = generate_schtasks_status_command(SERVICE_NAME);

    // Same task, same verb: the question is only ever about output format.
    assert_eq!(exists[..4], running[..4]);
    assert!(!exists.contains(&"/FO".to_string()));
    assert_eq!(running[4..], ["/FO".to_string(), "LIST".to_string()]);
}

/// The label and unit name are what the app and the CLI both register under. If they ever disagree,
/// an install from one leaves the other's registration orphaned and running — so both are pinned
/// here rather than left to two `to_string()` calls in two crates.
#[test]
fn the_registered_names_are_fixed() {
    assert_eq!(SERVICE_NAME, "com.spacecorps.tendril.service");
    assert_eq!(SYSTEMD_UNIT_NAME, "tendril-service");
    assert_eq!(PlatformServiceConfig::default().service_name, SERVICE_NAME);
}

/// The unit path has to come out of the *supplied* environment, not the ambient one. This is the
/// property that lets every other test here write into a temp directory instead of the LaunchAgents
/// folder of whoever is running the suite.
#[test]
fn the_unit_path_follows_the_supplied_home() {
    let scratch = Scratch::new("unit-path");
    let env = scratch.env();

    match mechanism() {
        ServiceMechanism::Launchd => {
            let path = default_unit_path_with_env(&env).expect("launchd has a plist path");
            assert_eq!(
                path,
                scratch
                    .path()
                    .join("Library")
                    .join("LaunchAgents")
                    .join(format!("{SERVICE_NAME}.plist"))
            );
        }
        ServiceMechanism::Systemd => {
            let path = default_unit_path_with_env(&env).expect("systemd has a unit path");
            assert_eq!(
                path,
                scratch
                    .path()
                    .join(".config")
                    .join("systemd")
                    .join("user")
                    .join(format!("{SYSTEMD_UNIT_NAME}.service"))
            );
        }
        // The definition lives in the scheduler's own store, so there is no path to resolve.
        ServiceMechanism::ScheduledTask | ServiceMechanism::Unsupported => {
            assert!(default_unit_path_with_env(&env).is_none());
        }
    }

    // A machine with no home at all is a `None`, not a panic and not a path relative to the cwd.
    let empty: HashMap<String, String> = HashMap::new();
    if matches!(
        mechanism(),
        ServiceMechanism::Launchd | ServiceMechanism::Systemd
    ) {
        assert!(default_unit_path_with_env(&empty).is_none());
    }
}

/// The launchd plist path is derived from `HOME`, so the macOS generator is exercisable without
/// touching the real LaunchAgents folder — the same isolation the CLI's fixtures rely on.
#[test]
fn the_plist_path_is_derived_from_the_supplied_home() {
    let scratch = Scratch::new("plist-path");
    let path = default_plist_path_with_env(&scratch.env()).expect("a home was supplied");

    assert!(path.starts_with(scratch.path()));
    assert!(path.ends_with(format!("{SERVICE_NAME}.plist")));
}

/// Writing the unit and handing it to the service manager are separate steps, and only the first one
/// may run in a test. `start: false` must produce the file and shell out to nothing.
#[test]
fn a_unit_can_be_written_without_registering_it_with_the_service_manager() {
    let scratch = Scratch::new("no-start");
    let plist = scratch
        .path()
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{SERVICE_NAME}.plist"));
    let cfg = sample_config();

    install_launchd_service(&cfg, &plist, false).expect("write the plist");

    let written = std::fs::read_to_string(&plist).expect("the plist landed");
    assert_eq!(written, generate_launchd_plist(&cfg));

    uninstall_launchd_service(&plist, false).expect("remove the plist");
    assert!(!plist.exists());

    // Removing a unit that is not there is not an error: `service uninstall` is idempotent, and it
    // runs this path when the registration was already gone.
    uninstall_launchd_service(&plist, false).expect("removing a missing plist is a no-op");
}
