//! Installing the daemon: copying the binaries and registering autostart.
//!
//! Moved here with the implementation (it was `src-tauri/tests/service_provision_tests.rs`). The app
//! still calls `provision_with` through its thin `service::provision` wrapper, and
//! `tendril service install` calls `register_autostart` directly, so these pin what both do.
//!
//! These run against a temp home with fake sidecars, and never register autostart for real: writing
//! a live LaunchAgent or systemd unit from a test would install a service on the machine running it.

use std::fs;
use std::path::{Path, PathBuf};

use tendril_core::service::provision::{
    autostart_config, provision_with, purge_binaries, service_config, unit_needs_write,
    AutostartOutcome, CLI_BINARY, OPENCODE_BINARY, STAMP_FILE,
};

/// A fixture directory that removes itself, standing in for `tempfile::tempdir` — `tempfile` is not
/// a dependency of this crate, so the fixture is built the way `attachment_staging_test` builds its
/// own.
struct Scratch(PathBuf);

impl Scratch {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tendril-service-provision-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A stand-in bundle directory holding both sidecars.
fn staged_sidecars(dir: &Path, cli_body: &str, opencode_body: &str) {
    fs::create_dir_all(dir).expect("create the sidecar dir");
    fs::write(dir.join(CLI_BINARY), cli_body).expect("write the cli sidecar");
    fs::write(dir.join(OPENCODE_BINARY), opencode_body).expect("write the opencode sidecar");
}

#[test]
fn a_first_run_installs_both_sidecars_into_the_home_bin() {
    let tmp = Scratch::new("a-first-run-installs-both-sidecars-into-");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    staged_sidecars(&bundle, "cli v1", "opencode v1");

    let report = provision_with("1.0.0", Some(&bundle), &home, false);

    assert!(
        report.errors.is_empty(),
        "unexpected errors: {:?}",
        report.errors
    );
    assert_eq!(
        report.installed.len(),
        2,
        "both sidecars install: {report:?}"
    );
    assert!(report.up_to_date.is_empty());
    assert!(report.missing.is_empty());

    let bin = home.join("bin");
    assert_eq!(
        fs::read_to_string(bin.join(CLI_BINARY)).expect("cli landed"),
        "cli v1"
    );
    assert_eq!(
        fs::read_to_string(bin.join(OPENCODE_BINARY)).expect("opencode landed"),
        "opencode v1"
    );

    // `<home>/bin` is what `PlatformServiceConfig::default`, `agent_path` and
    // `resolve_opencode_binary` all name, so a daemon started by launchd with none of the app's
    // environment still finds the agent.
    assert_eq!(report.bin_dir, bin.display().to_string());
}

#[cfg(unix)]
#[test]
fn an_installed_sidecar_is_executable() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = Scratch::new("an-installed-sidecar-is-executable");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    staged_sidecars(&bundle, "cli", "opencode");
    // Deliberately not executable in the bundle: a sidecar that lost its bit somewhere in packaging
    // must still be spawnable once installed, or it fails at run time with a message naming the
    // daemon rather than the permission.
    fs::set_permissions(bundle.join(CLI_BINARY), fs::Permissions::from_mode(0o644))
        .expect("clear the executable bit");

    provision_with("1.0.0", Some(&bundle), &home, false);

    let mode = fs::metadata(home.join("bin").join(CLI_BINARY))
        .expect("cli landed")
        .permissions()
        .mode();
    assert_eq!(mode & 0o111, 0o111, "installed binary must be executable");
}

#[test]
fn a_second_run_of_the_same_version_copies_nothing() {
    let tmp = Scratch::new("a-second-run-of-the-same-version-copies-");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    staged_sidecars(&bundle, "cli v1", "opencode v1");

    provision_with("1.0.0", Some(&bundle), &home, false);
    let second = provision_with("1.0.0", Some(&bundle), &home, false);

    assert!(
        second.installed.is_empty(),
        "nothing to reinstall: {second:?}"
    );
    assert_eq!(second.up_to_date.len(), 2);
    assert!(!second.changed());
}

#[test]
fn a_version_bump_reinstalls_even_when_the_size_is_unchanged() {
    let tmp = Scratch::new("a-version-bump-reinstalls-even-when-the-");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    staged_sidecars(&bundle, "cli v1", "opencode v1");
    provision_with("1.0.0", Some(&bundle), &home, false);

    // Same length on purpose - the stamp, not the file size, is what has to catch this.
    staged_sidecars(&bundle, "cli v2", "opencode v2");
    let upgraded = provision_with("1.1.0", Some(&bundle), &home, false);

    assert_eq!(upgraded.installed.len(), 2, "{upgraded:?}");
    assert_eq!(
        fs::read_to_string(home.join("bin").join(CLI_BINARY)).expect("cli landed"),
        "cli v2"
    );
}

#[test]
fn a_replaced_binary_does_not_truncate_the_one_already_there() {
    let tmp = Scratch::new("a-replaced-binary-does-not-truncate-the-");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    staged_sidecars(&bundle, "cli v1", "opencode v1");
    provision_with("1.0.0", Some(&bundle), &home, false);

    let installed = home.join("bin").join(CLI_BINARY);
    let before = fs::metadata(&installed).expect("installed cli");

    staged_sidecars(&bundle, "cli version two", "opencode v1");
    provision_with("1.1.0", Some(&bundle), &home, false);

    let after = fs::metadata(&installed).expect("replaced cli");
    // A rename, not a write into the existing file: the daemon may be executing that inode right
    // now, and writing into it is refused on Linux and corrupts the running image on macOS.
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_ne!(
            before.ino(),
            after.ino(),
            "the new binary must be a new inode, not an overwrite of the running one"
        );
    }
    #[cfg(not(unix))]
    let _ = before;
    assert_eq!(after.len(), "cli version two".len() as u64);
}

#[test]
fn no_temporary_files_are_left_behind() {
    let tmp = Scratch::new("no-temporary-files-are-left-behind");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    staged_sidecars(&bundle, "cli v1", "opencode v1");
    provision_with("1.0.0", Some(&bundle), &home, false);

    let leftovers: Vec<String> = fs::read_dir(home.join("bin"))
        .expect("bin dir")
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| n.ends_with(".new") || n.ends_with(".old"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "staging files left behind: {leftovers:?}"
    );
}

#[test]
fn a_bundle_missing_a_sidecar_is_reported_and_not_fatal() {
    let tmp = Scratch::new("a-bundle-missing-a-sidecar-is-reported-a");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    fs::create_dir_all(&bundle).expect("bundle dir");
    fs::write(bundle.join(CLI_BINARY), "cli only").expect("cli sidecar");

    let report = provision_with("1.0.0", Some(&bundle), &home, false);

    assert_eq!(report.installed, vec![CLI_BINARY.to_string()]);
    assert_eq!(report.missing, vec![OPENCODE_BINARY.to_string()]);
    assert!(
        report.errors.is_empty(),
        "a missing sidecar is not an error: {report:?}"
    );
}

#[test]
fn an_unlocatable_executable_reports_instead_of_guessing() {
    let tmp = Scratch::new("an-unlocatable-executable-reports-instea");
    let report = provision_with("1.0.0", None, &tmp.path().join("home"), false);

    assert!(report.installed.is_empty());
    assert_eq!(report.errors.len(), 1, "{report:?}");
    assert!(
        report.errors[0].contains("running executable"),
        "the error has to name the cause: {:?}",
        report.errors
    );
}

#[test]
fn autostart_is_skipped_when_there_is_no_installed_cli_to_start() {
    let tmp = Scratch::new("autostart-is-skipped-when-there-is-no-in");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    // A bundle with only the agent: nothing to register a service against.
    fs::create_dir_all(&bundle).expect("bundle dir");
    fs::write(bundle.join(OPENCODE_BINARY), "opencode").expect("opencode sidecar");

    let report = provision_with("1.0.0", Some(&bundle), &home, true);

    match report.autostart {
        AutostartOutcome::Skipped(reason) => assert!(
            reason.contains("nothing to start"),
            "unexpected skip reason: {reason}"
        ),
        other => panic!("autostart must not be registered without a daemon: {other:?}"),
    }
}

#[test]
fn disabling_autostart_still_installs_the_binaries() {
    let tmp = Scratch::new("disabling-autostart-still-installs-the-b");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    staged_sidecars(&bundle, "cli", "opencode");

    let report = provision_with("1.0.0", Some(&bundle), &home, false);

    assert_eq!(report.installed.len(), 2);
    assert!(matches!(report.autostart, AutostartOutcome::Skipped(_)));
    // The binaries are the half that makes the app work at all; autostart only decides whether the
    // daemon comes back after a reboot.
    assert!(home.join("bin").join(CLI_BINARY).is_file());
}

#[test]
fn the_autostart_unit_points_at_the_installed_copy_not_the_bundled_one() {
    let home = Path::new("/tmp/tendril-provision-test-home");
    let cfg = autostart_config(home);

    assert_eq!(cfg.binary_path, home.join("bin").join(CLI_BINARY));
    assert!(cfg.args.contains(&"serve".to_string()));

    // A launchd plist gets the home only through this map; unlike the systemd unit it writes no
    // TENDRIL_HOME line of its own.
    assert!(cfg
        .env_vars
        .iter()
        .any(|(k, v)| k == "TENDRIL_HOME" && *v == home.to_string_lossy()));

    let plist = tendril_core::service::platform::macos::generate_launchd_plist(&cfg);
    assert!(plist.contains(&cfg.binary_path.display().to_string()));
    assert!(plist.contains("<string>serve</string>"));
}

/// Rewriting the plist means `launchctl bootout` + `bootstrap`, which kills and restarts the running
/// daemon. Doing that on every launch would be a restart loop.
#[test]
fn an_unchanged_unit_is_not_rewritten() {
    let cfg = autostart_config(Path::new("/tmp/tendril-provision-test-home"));
    let unit = tendril_core::service::platform::macos::generate_launchd_plist(&cfg);

    assert!(!unit_needs_write(&unit, Some(&unit)));
    assert!(unit_needs_write(&unit, None));
    assert!(unit_needs_write(
        &unit,
        Some("<plist>something else</plist>")
    ));
}

/// The CLI's half of the shared config: it registers the executable the operator ran, with `--home`
/// baked in only when they named one. The app's half is `autostart_config` above — same function
/// underneath, which is the point of the move.
#[test]
fn the_cli_config_registers_the_binary_it_is_handed() {
    let home = Path::new("/tmp/tendril-service-config-home");
    let binary = Path::new("/opt/homebrew/bin/tendril");

    let implicit = service_config(home, binary, None, "Tendril-CLI");
    assert_eq!(implicit.binary_path, binary);
    assert_eq!(implicit.args, vec!["serve".to_string()]);

    // A home the operator named is pinned; a defaulted one is not, because the daemon's own
    // resolution honours `.tendril_location` and a baked-in path would override a later relocation.
    let explicit = service_config(home, binary, Some(home), "Tendril-CLI");
    assert_eq!(
        explicit.args,
        vec![
            "--home".to_string(),
            home.display().to_string(),
            "serve".to_string()
        ]
    );
    assert!(explicit
        .env_vars
        .iter()
        .any(|(k, v)| k == "TENDRIL_MANAGED_BY" && v == "Tendril-CLI"));
}

/// `service uninstall --purge-binaries` removes what a provisioning run installed and nothing else.
/// `<home>/bin` is on a coding agent's `PATH`, so an operator may well have put their own tools
/// there — deleting the directory, or sweeping it, would take those with it.
#[test]
fn purging_removes_only_the_binaries_provisioning_installed() {
    let tmp = Scratch::new("purge");
    let bundle = tmp.path().join("bundle");
    let home = tmp.path().join("home");
    fs::create_dir_all(&bundle).expect("bundle dir");
    fs::write(bundle.join(CLI_BINARY), "cli").expect("cli sidecar");
    fs::write(bundle.join(OPENCODE_BINARY), "opencode").expect("opencode sidecar");
    provision_with("1.0.0", Some(&bundle), &home, false);

    let bin = home.join("bin");
    let operators_own = bin.join("my-linter");
    fs::write(&operators_own, "not ours").expect("operator's own tool");

    let removed = purge_binaries(&home).expect("purge");

    assert_eq!(removed.len(), 3, "cli, agent and stamp: {removed:?}");
    assert!(!bin.join(CLI_BINARY).exists());
    assert!(!bin.join(OPENCODE_BINARY).exists());
    assert!(!bin.join(STAMP_FILE).exists());
    assert!(
        operators_own.is_file(),
        "purging must not touch anything provisioning did not install"
    );
    assert!(
        bin.is_dir(),
        "the directory itself stays: it is on agents' PATH"
    );
}

/// Purging a home that was never provisioned is a no-op, not an error: `service uninstall
/// --purge-binaries` runs it unconditionally, and a CLI-only install has no `<home>/bin` at all.
#[test]
fn purging_a_home_with_nothing_in_it_is_not_an_error() {
    let tmp = Scratch::new("purge-empty");
    let removed = purge_binaries(tmp.path()).expect("purging an empty home succeeds");
    assert!(removed.is_empty(), "{removed:?}");
}
