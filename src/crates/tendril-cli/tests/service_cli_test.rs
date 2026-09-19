//! `tendril service install|uninstall|status` end to end.
//!
//! The platform work lives in `tendril_core::service`, which `tendril-core`'s own tests cover; what
//! is pinned here is the CLI's share of it — the command surface, the printed lines, and above all
//! the exit codes, since a wrapper script's `$?` is the point of having a subcommand at all.
//!
//! Every run is isolated the way `doctor_cli_test` isolates its own, and for the same reason: a test
//! whose result depends on what the developer happens to have installed passes locally and fails on
//! CI. Here the stakes are higher than a stray `gh`, because an unisolated `service install` would
//! write a LaunchAgent into the home directory of whoever ran `cargo test` and register a daemon on
//! their machine. So:
//!
//!   * `HOME`/`USERPROFILE` point at a temp directory, which is where the unit file is resolved
//!     from — nothing is written outside it;
//!   * `--home` is a separate temp directory, and the real `TENDRIL_HOME` is cleared;
//!   * `PATH` holds only a symlinked set of known tools, so `launchctl`, `systemctl` and
//!     `schtasks.exe` are *absent* and the install cannot hand anything to a live service manager;
//!   * every install passes `--no-start`, so even a leaked `PATH` entry would not be reached.

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

/// The tools the CLI is allowed to find. Deliberately no `launchctl`, `systemctl` or `schtasks.exe`:
/// their absence is what guarantees these tests cannot register a service on the machine running
/// them, and `--no-start` means nothing here ever asks for one.
#[cfg(unix)]
const BASE_TOOLS: &[&str] = &["sh"];
#[cfg(windows)]
const BASE_TOOLS: &[&str] = &["cmd.exe"];

#[cfg(unix)]
const TOOL_SEARCH_DIRS: &[&str] = &["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"];
#[cfg(windows)]
const TOOL_SEARCH_DIRS: &[&str] = &[r"C:\Windows\System32", r"C:\Windows"];

/// `tendril service` on a platform with no service manager refuses rather than installing, so the
/// tests that assert on a successful install only apply where there is one to install into.
const SUPPORTED: bool = cfg!(any(
    target_os = "macos",
    target_os = "linux",
    target_os = "windows"
));

/// Windows keeps the task in the scheduler's own store rather than a file, so there is no unit path
/// for a fixture to isolate and no install these tests can perform without touching the machine.
const HAS_UNIT_FILE: bool = cfg!(any(target_os = "macos", target_os = "linux"));

struct Fixture {
    /// The `--home` the daemon would serve.
    home: PathBuf,
    /// The `HOME` the unit path is resolved against.
    fake_home: PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-cli-service-test-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let home = root.join("tendril-home");
        let fake_home = root.join("user-home");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&fake_home).unwrap();
        assert!(root.starts_with(std::env::temp_dir()));
        Self { home, fake_home }
    }

    /// A `PATH` holding only [`BASE_TOOLS`], symlinked into this fixture's own directory.
    fn base_path(&self) -> String {
        let bin = self.fake_home.join("base-bin");
        std::fs::create_dir_all(&bin).unwrap();
        for tool in BASE_TOOLS {
            let link = bin.join(tool);
            if link.exists() {
                continue;
            }
            let Some(real) = TOOL_SEARCH_DIRS
                .iter()
                .map(|dir| PathBuf::from(dir).join(tool))
                .find(|candidate| candidate.exists())
            else {
                continue;
            };
            #[cfg(unix)]
            std::os::unix::fs::symlink(&real, &link).unwrap();
            #[cfg(windows)]
            std::fs::copy(&real, &link).map(|_| ()).unwrap();
        }
        bin.display().to_string()
    }

    /// Where the launchd plist or systemd unit lands, given this fixture's `HOME`.
    fn unit_path(&self) -> Option<PathBuf> {
        let env = std::collections::HashMap::from([
            ("HOME".to_string(), self.fake_home.display().to_string()),
            (
                "USERPROFILE".to_string(),
                self.fake_home.display().to_string(),
            ),
        ]);
        tendril_core::service::platform::default_unit_path_with_env(&env)
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
        cmd.arg("--home")
            .arg(&self.home)
            .args(args)
            .env("PATH", self.base_path())
            // The unit path is derived from these, so this is what keeps a real LaunchAgents
            // directory out of reach.
            .env("HOME", &self.fake_home)
            .env("USERPROFILE", &self.fake_home)
            .env_remove("TENDRIL_HOME")
            .env_remove("TENDRIL_CONFIG")
            .env_remove("TENDRIL_PLANS")
            .stdin(Stdio::null());
        cmd
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command(args).output().expect("run tendril")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(root) = self.home.parent() {
            let _ = std::fs::remove_dir_all(root);
        }
    }
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn combined(out: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

/// A fresh home has no registration, and saying so is a successful report rather than a failure.
/// A wrapper that wants a verdict reads `installed` out of `--json`; inventing a non-zero exit out of
/// a fact would make `service status` unusable in a `set -e` script.
#[test]
fn status_on_a_fresh_home_reports_not_installed_and_exits_zero() {
    let fx = Fixture::new("status-fresh");
    let out = fx.run(&["service", "status"]);

    assert!(out.status.success(), "{}", combined(&out));
    let text = stdout(&out);
    if SUPPORTED {
        assert!(text.contains("Not installed"), "{text}");
        assert!(text.contains("Daemon:"), "{text}");
        // An absent registration is not a *stale* one. `unit_current` is honestly `false` here —
        // nothing on disk matches what an install would write — but printing "out of date" and
        // pointing at `--force` sends an operator who has never installed anything down the repair
        // path instead of the install path.
        assert!(
            !text.contains("out of date"),
            "nothing is installed, so there is no stale unit to repair: {text}"
        );
        assert!(
            !text.contains("--force"),
            "nothing is installed, so a plain install is the fix, not --force: {text}"
        );
    }
}

#[test]
fn status_json_is_machine_readable() {
    let fx = Fixture::new("status-json");
    let out = fx.run(&["service", "status", "--json"]);
    assert!(out.status.success(), "{}", combined(&out));

    let value: serde_json::Value = serde_json::from_str(&stdout(&out)).expect("status is JSON");
    assert_eq!(
        value["serviceName"], "com.spacecorps.tendril.service",
        "{value}"
    );
    assert_eq!(
        value["installed"],
        serde_json::Value::Bool(false),
        "{value}"
    );
    assert_eq!(
        value["tendrilHome"].as_str().map(PathBuf::from),
        Some(fx.home.clone()),
        "{value}"
    );
    assert!(value["daemon"].is_object(), "{value}");
}

/// `.master` naming a process that is gone is the state a killed daemon leaves behind. It must not
/// read as "running", or `service status` would tell an operator everything is fine while nothing is
/// serving.
#[test]
fn status_distinguishes_a_stale_master_file_from_a_running_daemon() {
    let fx = Fixture::new("status-stale");
    // Pid 0 is never a user process, so the liveness check fails first and no real pid is probed.
    std::fs::write(
        fx.home.join(".master"),
        r#"{"scheme":"http","host":"127.0.0.1","port":5010,"pid":0,"secret":"x"}"#,
    )
    .unwrap();

    let out = fx.run(&["service", "status"]);
    assert!(out.status.success(), "{}", combined(&out));
    let text = stdout(&out);
    assert!(text.contains("not running"), "{text}");
    assert!(text.contains("stale"), "{text}");
}

#[test]
fn install_writes_a_unit_naming_the_running_executable() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("install");
    let out = fx.run(&["service", "install", "--no-start"]);

    assert!(out.status.success(), "{}", combined(&out));
    let unit_path = fx.unit_path().expect("this platform writes a unit file");
    let unit = std::fs::read_to_string(&unit_path).expect("the unit landed");

    // The CLI registers itself, not a copy in `<home>/bin`: that is the app's install, and a unit
    // pointing at a path the CLI never writes would start nothing.
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_tendril"));
    assert!(
        unit.contains(&binary.display().to_string()),
        "the unit must name the running executable:\n{unit}"
    );
    assert!(unit.contains("serve"), "{unit}");
    assert!(
        unit.contains(&fx.home.display().to_string()),
        "the unit must name the home it serves:\n{unit}"
    );

    // Nothing may be written outside the fixture: a unit in the real LaunchAgents directory is a
    // service installed on whoever ran the suite.
    assert!(unit_path.starts_with(&fx.fake_home), "{unit_path:?}");
}

/// A defaulted home must not be pinned into the unit. The daemon's own resolution honours the
/// `.tendril_location` pointer file, so a baked-in `~/.tendril` would quietly override a home the
/// operator relocates later — whereas one they named on the command line is worth keeping.
#[test]
fn only_an_explicitly_named_home_is_baked_into_the_unit() {
    if !HAS_UNIT_FILE {
        return;
    }

    let fx = Fixture::new("explicit-home");
    fx.run(&["service", "install", "--no-start"]);
    let explicit = std::fs::read_to_string(fx.unit_path().unwrap()).expect("the unit landed");
    assert!(explicit.contains("--home"), "{explicit}");

    // The same install with no `--home` at all: the fixture's fake HOME makes the default resolve
    // inside the fixture, so this still writes nothing outside it.
    let fx2 = Fixture::new("default-home");
    let out = fx2
        .command(&["service", "install", "--no-start"])
        .output()
        .map(|_| ())
        .and_then(|_| {
            let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
            cmd.args(["service", "install", "--no-start", "--force"])
                .env("PATH", fx2.base_path())
                .env("HOME", &fx2.fake_home)
                .env("USERPROFILE", &fx2.fake_home)
                .env_remove("TENDRIL_HOME")
                .stdin(Stdio::null())
                .output()
        })
        .expect("run tendril without --home");
    assert!(out.status.success(), "{}", combined(&out));

    let implicit = std::fs::read_to_string(fx2.unit_path().unwrap()).expect("the unit landed");
    assert!(
        !implicit.contains("--home"),
        "a defaulted home must not be pinned into the unit:\n{implicit}"
    );
}

/// Installing when already installed is the state you asked for, so it succeeds and says nothing
/// changed. A non-zero exit here would break every `service install` in a provisioning script that
/// runs more than once.
#[test]
fn installing_twice_is_idempotent_and_still_exits_zero() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("install-twice");

    let first = fx.run(&["service", "install", "--no-start"]);
    assert!(first.status.success(), "{}", combined(&first));
    assert!(stdout(&first).contains("Registered"), "{}", stdout(&first));

    let unit_path = fx.unit_path().unwrap();
    let written_at = std::fs::metadata(&unit_path).unwrap().modified().unwrap();

    let second = fx.run(&["service", "install", "--no-start"]);
    assert!(second.status.success(), "{}", combined(&second));
    assert!(
        stdout(&second).contains("Already registered"),
        "{}",
        stdout(&second)
    );

    // Not rewritten, which is what keeps a real install off the launchd bootout/bootstrap treadmill:
    // rewriting the plist restarts the daemon, so doing it on every call would be a restart loop.
    assert_eq!(
        std::fs::metadata(&unit_path).unwrap().modified().unwrap(),
        written_at,
        "an unchanged unit must not be rewritten"
    );
}

/// `--force` is the repair for the case a content diff cannot see: after an upgrade the unit text is
/// unchanged but the binary behind it is a new inode, and launchd goes on running the old one.
#[test]
fn force_reinstalls_a_unit_that_is_already_current() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("install-force");
    fx.run(&["service", "install", "--no-start"]);

    let out = fx.run(&["service", "install", "--no-start", "--force"]);
    assert!(out.status.success(), "{}", combined(&out));
    assert!(
        stdout(&out).contains("Registered"),
        "--force must reinstall rather than report no-op: {}",
        stdout(&out)
    );
}

/// Once installed, status has to say so — and has to keep "registered" apart from "running". Nothing
/// is running here, because `--no-start` never handed the unit to a service manager and there is no
/// `launchctl` on `PATH` to have done it.
#[test]
fn status_after_install_reports_installed_but_not_running() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("status-installed");
    fx.run(&["service", "install", "--no-start"]);

    let out = fx.run(&["service", "status"]);
    assert!(out.status.success(), "{}", combined(&out));
    let text = stdout(&out);
    assert!(text.contains("Installed but not running"), "{text}");
    assert!(
        text.contains(&fx.unit_path().unwrap().display().to_string()),
        "status must name the unit it found:\n{text}"
    );

    let json = fx.run(&["service", "status", "--json"]);
    let value: serde_json::Value = serde_json::from_str(&stdout(&json)).unwrap();
    assert_eq!(value["installed"], serde_json::Value::Bool(true), "{value}");
    assert_eq!(value["loaded"], serde_json::Value::Bool(false), "{value}");
    assert_eq!(
        value["unitCurrent"],
        serde_json::Value::Bool(true),
        "a unit this install just wrote is current: {value}"
    );
}

/// A unit left over from an install that named a different binary. The fix is a reinstall, and
/// nothing else in the CLI reports it, so status has to.
#[test]
fn status_reports_a_unit_that_no_longer_matches_what_install_would_write() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("status-stale-unit");
    fx.run(&["service", "install", "--no-start"]);

    let unit_path = fx.unit_path().unwrap();
    let unit = std::fs::read_to_string(&unit_path).unwrap();
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_tendril"));
    std::fs::write(
        &unit_path,
        unit.replace(&binary.display().to_string(), "/somewhere/else/tendril"),
    )
    .unwrap();

    let out = fx.run(&["service", "status"]);
    assert!(out.status.success(), "{}", combined(&out));
    assert!(stdout(&out).contains("out of date"), "{}", stdout(&out));

    let json = fx.run(&["service", "status", "--json"]);
    let value: serde_json::Value = serde_json::from_str(&stdout(&json)).unwrap();
    assert_eq!(
        value["unitCurrent"],
        serde_json::Value::Bool(false),
        "{value}"
    );
}

/// Installs, then rewrites the unit so it names a binary this executable is not - which is exactly
/// the shape of "a second Tendril, or the desktop app's copy, already owns this label". Returns the
/// unit path and the text now on disk.
fn plant_a_foreign_registration(fx: &Fixture) -> (PathBuf, String) {
    fx.run(&["service", "install", "--no-start"]);
    let unit_path = fx.unit_path().unwrap();
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_tendril"));
    let foreign = std::fs::read_to_string(&unit_path).unwrap().replace(
        &binary.display().to_string(),
        "/opt/other-tendril/bin/tendril",
    );
    std::fs::write(&unit_path, &foreign).unwrap();
    (unit_path, foreign)
}

/// A unit whose text is not what we would write is either an upgrade or a second installation, and
/// the unit text alone cannot tell them apart. Guessing "upgrade" and rewriting is how `install`
/// exits 0 having quietly taken the machine's autostart away from whatever owned it. So it stops.
#[test]
fn install_refuses_to_take_over_a_registration_it_did_not_write() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("install-foreign");
    let (unit_path, foreign) = plant_a_foreign_registration(&fx);

    let out = fx.run(&["service", "install", "--no-start"]);
    assert!(
        !out.status.success(),
        "install must not silently repoint a registration it did not write:\n{}",
        combined(&out)
    );
    let text = combined(&out);
    assert!(
        text.contains("already registered") && text.contains("--force"),
        "the refusal must name the conflict and the way past it:\n{text}"
    );
    assert!(
        text.contains(&unit_path.display().to_string()),
        "the refusal must name the unit it found:\n{text}"
    );
    assert_eq!(
        std::fs::read_to_string(&unit_path).unwrap(),
        foreign,
        "a refused install must leave the other registration exactly as it was"
    );
}

/// The other half of the same rule: `--force` is the operator saying they meant it, and it has to
/// still work — otherwise a genuine upgrade, which looks identical, has no way through.
#[test]
fn force_takes_over_a_registration_it_did_not_write() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("install-foreign-force");
    let (unit_path, foreign) = plant_a_foreign_registration(&fx);

    let out = fx.run(&["service", "install", "--no-start", "--force"]);
    assert!(out.status.success(), "{}", combined(&out));
    let after = std::fs::read_to_string(&unit_path).unwrap();
    assert_ne!(after, foreign, "--force must rewrite the unit");
    assert!(
        after.contains(
            &PathBuf::from(env!("CARGO_BIN_EXE_tendril"))
                .display()
                .to_string()
        ),
        "the rewritten unit must name this executable:\n{after}"
    );
}

/// `unregister_autostart` removes by service name, so it will happily delete a unit written by a
/// different Tendril home and report success. Reading `unit_current` before removing is the only
/// thing standing between `uninstall` and silently disabling someone else's daemon.
#[test]
fn uninstall_refuses_to_remove_a_registration_it_did_not_write() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("uninstall-foreign");
    let (unit_path, foreign) = plant_a_foreign_registration(&fx);

    let out = fx.run(&["service", "uninstall"]);
    assert!(
        !out.status.success(),
        "uninstall must not remove a registration it did not write:\n{}",
        combined(&out)
    );
    assert!(
        unit_path.exists(),
        "a refused uninstall must leave the unit on disk"
    );
    assert_eq!(std::fs::read_to_string(&unit_path).unwrap(), foreign);
    let text = combined(&out);
    assert!(
        text.contains("--force") && text.contains(&unit_path.display().to_string()),
        "the refusal must name the unit and the way past it:\n{text}"
    );

    // And --force still gets there, so an operator who has looked at `status` is not stuck.
    let forced = fx.run(&["service", "uninstall", "--force"]);
    assert!(forced.status.success(), "{}", combined(&forced));
    assert!(!unit_path.exists(), "--force must remove the unit");
}

#[test]
fn uninstall_removes_the_unit_and_status_goes_back_to_not_installed() {
    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("uninstall");
    fx.run(&["service", "install", "--no-start"]);
    let unit_path = fx.unit_path().unwrap();
    assert!(unit_path.exists());

    let out = fx.run(&["service", "uninstall"]);
    assert!(out.status.success(), "{}", combined(&out));
    assert!(!unit_path.exists(), "the unit must be gone");

    let status = fx.run(&["service", "status"]);
    assert!(
        stdout(&status).contains("Not installed"),
        "{}",
        stdout(&status)
    );
}

/// Uninstalling what is not installed is the state you asked for, so it succeeds. A non-zero exit
/// would make a teardown script fail on its second run.
#[test]
fn uninstalling_when_nothing_is_installed_exits_zero() {
    let fx = Fixture::new("uninstall-absent");
    let out = fx.run(&["service", "uninstall"]);

    if !SUPPORTED {
        assert!(!out.status.success(), "{}", combined(&out));
        return;
    }
    assert!(out.status.success(), "{}", combined(&out));
    assert!(
        stdout(&out).contains("nothing to remove"),
        "{}",
        stdout(&out)
    );
}

/// `<home>/bin` is on a coding agent's `PATH`, so an operator may well have put their own tools
/// there. `--purge-binaries` removes what a desktop-app install put in it and nothing else, and
/// plain `uninstall` removes none of it.
#[test]
fn purge_binaries_removes_only_what_provisioning_installed() {
    let fx = Fixture::new("purge");
    let bin = fx.home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let cli = bin.join(if cfg!(windows) {
        "tendril.exe"
    } else {
        "tendril"
    });
    let theirs = bin.join("my-linter");
    std::fs::write(&cli, "installed daemon").unwrap();
    std::fs::write(&theirs, "not ours").unwrap();

    let kept = fx.run(&["service", "uninstall"]);
    if !SUPPORTED {
        return;
    }
    assert!(kept.status.success(), "{}", combined(&kept));
    assert!(cli.is_file(), "a plain uninstall must not remove binaries");

    let out = fx.run(&["service", "uninstall", "--purge-binaries"]);
    assert!(out.status.success(), "{}", combined(&out));
    assert!(!cli.exists(), "{}", stdout(&out));
    assert!(
        theirs.is_file(),
        "purging must not touch anything provisioning did not install"
    );
}

/// The subcommand has to exist in the parse tree with the three verbs and their flags, whatever
/// platform the suite runs on — `--help` is the surface an operator discovers it through.
#[test]
fn the_command_surface_is_discoverable() {
    let fx = Fixture::new("help");

    let help = fx.run(&["service", "--help"]);
    assert!(help.status.success(), "{}", combined(&help));
    let text = stdout(&help);
    for verb in ["install", "uninstall", "status"] {
        assert!(
            text.contains(verb),
            "`service --help` must list {verb}:\n{text}"
        );
    }

    let install = fx.run(&["service", "install", "--help"]);
    let text = stdout(&install);
    assert!(text.contains("--no-start"), "{text}");
    assert!(text.contains("--force"), "{text}");

    let uninstall = fx.run(&["service", "uninstall", "--help"]);
    assert!(stdout(&uninstall).contains("--purge-binaries"));

    let status = fx.run(&["service", "status", "--help"]);
    assert!(stdout(&status).contains("--json"));
}

/// A platform Tendril has no mechanism for must produce a message naming it and a non-zero exit, not
/// a panic and not a silent success. macOS, Linux and Windows all have one, so what this run can
/// check is that the supported path does not take the refusal branch; the message itself is pinned in
/// `commands::service`'s unit tests, which can construct the unsupported mechanism directly.
#[test]
fn a_supported_platform_does_not_take_the_unsupported_branch() {
    let fx = Fixture::new("supported");
    let out = fx.run(&["service", "status"]);
    let text = combined(&out);

    if SUPPORTED {
        assert!(
            !text.contains("no autostart mechanism"),
            "a supported platform must not refuse:\n{text}"
        );
    } else {
        assert!(!out.status.success());
        assert!(text.contains(std::env::consts::OS), "{text}");
    }
}

/// An install into a directory it cannot write must fail loudly with a non-zero exit, not report
/// success over a unit that was never written.
#[cfg(unix)]
#[test]
fn an_unwritable_unit_directory_fails_with_a_non_zero_exit() {
    use std::os::unix::fs::PermissionsExt;

    if !HAS_UNIT_FILE {
        return;
    }
    let fx = Fixture::new("unwritable");
    let unit_path = fx.unit_path().unwrap();
    let parent = unit_path.parent().unwrap();
    std::fs::create_dir_all(parent).unwrap();
    std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o500)).unwrap();

    // Root ignores the mode bits entirely, so the failure this pins cannot be provoked in a
    // container that runs the suite as root. Probed rather than asked (`libc` is not a dependency
    // here), and probed *after* the chmod so it tests the same directory the CLI will write into.
    if std::fs::write(parent.join(".writable-probe"), b"").is_ok() {
        let _ = std::fs::remove_file(parent.join(".writable-probe"));
        let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        return;
    }

    let out = fx.run(&["service", "install", "--no-start"]);

    // Restore before asserting, so a failed assertion still leaves a removable fixture.
    let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));

    assert!(
        !out.status.success(),
        "a unit that could not be written must not report success:\n{}",
        combined(&out)
    );
    let text = combined(&out);
    assert!(text.contains("permissions"), "{text}");
    assert!(!unit_path.exists());
}

/// Nothing any of these tests do may reach outside its own temp directory. Asserted directly, because
/// the cost of getting it wrong is a LaunchAgent installed on a developer's or a CI runner's machine.
#[test]
fn no_test_here_can_write_outside_its_fixture() {
    let fx = Fixture::new("containment");
    let Some(unit_path) = fx.unit_path() else {
        return;
    };
    assert!(
        unit_path.starts_with(&fx.fake_home),
        "the unit path must resolve inside the fixture, not at {unit_path:?}"
    );
    // Only meaningful when there is a real home to compare against. `unwrap_or_default()` would
    // yield "", and `Path::starts_with("")` is true of every path — so an unset HOME turned this
    // guard into an assertion that always fails, which is exactly the machine-dependent breakage
    // the fixture exists to prevent.
    if let Some(real_home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
        assert!(
            !unit_path.starts_with(&real_home),
            "the fixture must not resolve to the real home"
        );
    }
    assert!(fx.home.starts_with(std::env::temp_dir()));

    let real_path = |p: &str| Path::new(p).to_path_buf();
    assert_ne!(
        unit_path.parent().map(Path::to_path_buf),
        Some(real_path("/Library/LaunchAgents"))
    );
}
