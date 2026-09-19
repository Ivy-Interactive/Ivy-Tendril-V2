//! `tendril doctor` end to end.
//!
//! `doctor` is a printer over `tendril_core::health`, so what is pinned here is the report: which
//! lines appear, how they are tagged, what order the `--rebuild-search-index` note lands in, and the
//! exit code.
//!
//! Two things are deliberately taken out of the ambient environment's hands:
//!   * `--home` is always an isolated temp directory (the real `TENDRIL_HOME` is cleared), and
//!   * `PATH` is set explicitly wherever a check probes it, so the installation checks are
//!     deterministic rather than a function of what the developer happens to have installed.

use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use tendril_core::db::SCHEMA_VERSION;

/// The minimum `PATH` the probes need: `which` lives in `/usr/bin`, and `git`/`gh` are looked up
/// through it. Nothing named `tendril` is in either directory, so the "not on PATH" branch is
/// reachable from here.
#[cfg(unix)]
const BASE_PATH: &str = "/usr/bin:/bin";
#[cfg(windows)]
const BASE_PATH: &str = r"C:\Windows\System32;C:\Windows";

struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-cli-doctor-test-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&home).unwrap();
        assert!(home.starts_with(std::env::temp_dir()));
        Self { home }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
        cmd.arg("--home")
            .arg(&self.home)
            .args(args)
            .env("PATH", BASE_PATH)
            .env_remove("TENDRIL_HOME")
            .env_remove("TENDRIL_PLANS")
            .env_remove("TENDRIL_CONFIG")
            .stdin(Stdio::null());
        cmd
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command(args).output().expect("run tendril")
    }

    fn conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.home.join("tendril.db")).expect("open database")
    }

    /// Creates a directory of stub executables that answer `--version`, and returns a `PATH` with it
    /// in front of [`BASE_PATH`]. The agent probes shell out to `<name> --version`, so a stub is all
    /// they need — and it makes the agent checks deterministic instead of a function of which coding
    /// agents the developer happens to have installed.
    fn path_with_stubs(&self, names: &[&str]) -> String {
        let bin = self.home.join("stub-bin");
        std::fs::create_dir_all(&bin).unwrap();
        for name in names {
            let path = bin.join(name);
            std::fs::write(&path, format!("#!/bin/sh\necho '{name} 1.0.0'\n")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        format!("{}:{}", bin.display(), BASE_PATH)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn stdout_of(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn exit_code(out: &Output) -> i32 {
    out.status
        .code()
        .expect("the CLI must exit, not be signalled")
}

/// Asserts a line containing `needle` exists and carries `tag`. Returns the whole line.
fn line_with(stdout: &str, needle: &str) -> String {
    stdout
        .lines()
        .find(|l| l.contains(needle))
        .unwrap_or_else(|| panic!("no doctor line containing {needle:?} in:\n{stdout}"))
        .to_string()
}

fn assert_tagged(stdout: &str, needle: &str, tag: &str) {
    let line = line_with(stdout, needle);
    assert!(
        line.starts_with(&format!("[{tag}] ")),
        "expected [{tag}] for {needle:?}, got: {line}"
    );
}

fn insert_plan(conn: &rusqlite::Connection, id: i64, title: &str) {
    conn.execute(
        "INSERT INTO Plans (Id, Title, Project, Level, State, FolderPath, FolderName, YamlRaw, \
         LatestRevisionContent, Created, Updated) \
         VALUES (?1, ?2, 'P', 'Feature', 'Draft', ?3, ?4, '', '', '2026-01-01T00:00:00Z', \
         '2026-01-01T00:00:00Z')",
        rusqlite::params![
            id,
            title,
            format!("/tmp/plans/{id}"),
            format!("{id}-{title}")
        ],
    )
    .expect("insert plan row");
}

// ---------------------------------------------------------------------------
// the full report
// ---------------------------------------------------------------------------

/// Every section `doctor` prints, on a home that has nothing in it. The point of the test is that
/// each check is *present* — a check that silently disappears from the registry is the failure mode
/// a printer test cannot otherwise catch.
#[test]
fn doctor_reports_every_check_on_a_bare_home() {
    let fx = Fixture::new("full-report");
    // Stub `claude` so the active agent's per-tier lines are reachable; the tiers are only reported
    // once the agent's CLI answers `--version`.
    let out = fx
        .command(&["doctor"])
        .env("PATH", fx.path_with_stubs(&["claude"]))
        .output()
        .expect("run tendril");
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);

    assert!(
        stdout.starts_with("Checking Tendril system health...\n"),
        "{stdout}"
    );

    for needle in [
        "Tendril Home:",
        "Config file",
        "Promptware overlay:",
        "Server:",
        "Version: tendril v",
        "Executable:",
        "PATH",
        "Git",
        "GitHub CLI",
        "Model catalog:",
        "deep:",
        "balanced:",
        "quick:",
        "Database",
        "Plan search index",
        "Plan search index integrity",
        "synced",
        "Plans directory",
    ] {
        let lowered = stdout.to_lowercase();
        assert!(
            lowered.contains(&needle.to_lowercase()),
            "doctor must still report on {needle:?}:\n{stdout}"
        );
    }

    // Only the banner and the rebuild note are untagged; every check line carries one of the three
    // tags, which is what operators and the onboarding wizard match on.
    for line in stdout.lines().skip(1).filter(|l| !l.trim().is_empty()) {
        assert!(
            line.starts_with("[OK] ") || line.starts_with("[WARN] ") || line.starts_with("[FAIL] "),
            "untagged doctor line: {line}"
        );
    }
}

/// A home with no config, no plans directory and no daemon must be reported honestly rather than
/// papered over.
#[test]
fn doctor_is_honest_about_a_home_with_nothing_in_it() {
    let fx = Fixture::new("honest");
    let stdout = stdout_of(&fx.run(&["doctor"]));

    assert_tagged(&stdout, "Config file does not exist", "WARN");
    assert!(
        line_with(&stdout, "Config file does not exist").contains("config.yaml"),
        "the warning must name the path it looked at"
    );

    assert_tagged(&stdout, "Plans directory not found", "WARN");
    assert!(line_with(&stdout, "Plans directory not found").contains("Plans"));

    // No daemon is not a problem, so it is reported OK — but it is reported.
    assert_tagged(&stdout, "Server: not running (no .master file)", "OK");

    assert_tagged(&stdout, "Plans have never been synced", "WARN");
}

/// A valid config flips the config line to OK and names the file.
#[test]
fn doctor_reports_a_valid_config_as_ok() {
    let fx = Fixture::new("valid-config");
    std::fs::write(
        fx.home.join("config.yaml"),
        "codingAgent: claude\njobTimeout: 30\n",
    )
    .unwrap();

    let stdout = stdout_of(&fx.run(&["doctor"]));
    assert_tagged(&stdout, "Config file valid:", "OK");
    assert!(line_with(&stdout, "Config file valid:").contains("config.yaml"));
}

/// `.master` is the only thing that tells `doctor` a server is running, and the line has to state the
/// scheme: a client that guesses wrong gets a connection error, not a redirect.
#[test]
fn doctor_reports_the_server_recorded_in_the_master_file() {
    let fx = Fixture::new("master");
    std::fs::write(
        fx.home.join(".master"),
        r#"{"port":51234,"pid":4242,"host":"127.0.0.1","scheme":"http"}"#,
    )
    .unwrap();

    let stdout = stdout_of(&fx.run(&["doctor"]));
    let line = line_with(&stdout, "Server:");
    assert!(line.starts_with("[OK] "), "{line}");
    assert!(line.contains("http://127.0.0.1:51234"), "{line}");
    assert!(line.contains("pid 4242"), "{line}");
    assert!(
        line.contains("plaintext"),
        "an http server must be flagged as plaintext: {line}"
    );
}

#[test]
fn doctor_reports_an_https_server_as_tls() {
    let fx = Fixture::new("master-tls");
    std::fs::write(
        fx.home.join(".master"),
        r#"{"port":51235,"pid":7,"host":"127.0.0.1","scheme":"https"}"#,
    )
    .unwrap();

    let line = line_with(&stdout_of(&fx.run(&["doctor"])), "Server:");
    assert!(line.contains("https://127.0.0.1:51235"), "{line}");
    assert!(line.contains("TLS"), "{line}");
}

/// The three execution-profile tiers are part of the report, so an operator can see which model each
/// one resolves to before a job picks it.
#[test]
fn doctor_lists_the_deep_balanced_and_quick_tiers() {
    let fx = Fixture::new("tiers");
    std::fs::write(fx.home.join("config.yaml"), "codingAgent: claude\n").unwrap();

    let out = fx
        .command(&["doctor"])
        .env("PATH", fx.path_with_stubs(&["claude"]))
        .output()
        .expect("run tendril");
    let stdout = stdout_of(&out);
    for (tier, model) in [("deep", "opus"), ("balanced", "sonnet"), ("quick", "haiku")] {
        let line = line_with(&stdout, &format!("{tier}:"));
        assert!(
            line.contains("claude (active)") && line.contains(model),
            "the {tier} tier must report the model it resolves to: {line}"
        );
    }
}

// ---------------------------------------------------------------------------
// the installation checks
// ---------------------------------------------------------------------------

/// The `tendril` an operator types resolving to a *different* build than the one running is a real
/// and confusing failure, so it is a WARN with both paths spelled out. Pinned with a fake `tendril`
/// earlier on `PATH` rather than by relying on what is installed on the machine.
#[test]
fn doctor_warns_when_tendril_on_path_is_a_different_build() {
    let fx = Fixture::new("path-elsewhere");
    let fake_bin = fx.home.join("fake-bin");
    std::fs::create_dir_all(&fake_bin).unwrap();
    let fake = fake_bin.join("tendril");
    std::fs::write(&fake, "#!/bin/sh\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    // The active agent's CLI is stubbed so the report carries no `[FAIL]` line: this test is about
    // the PATH check being a warning, and `doctor` now exits 1 on a failure of any kind.
    let stub_path = fx.path_with_stubs(&["claude"]);
    let out = fx
        .command(&["doctor"])
        .env("PATH", format!("{}:{}", fake_bin.display(), stub_path))
        .output()
        .expect("run tendril");
    let stdout = stdout_of(&out);

    let line = line_with(&stdout, "tendril on PATH resolves elsewhere");
    assert!(line.starts_with("[WARN] "), "{line}");
    assert!(line.contains(&fake.display().to_string()), "{line}");
    assert!(
        line.contains(env!("CARGO_BIN_EXE_tendril")),
        "the warning must also say which build is actually running: {line}"
    );
    assert!(
        line.contains("the CLI you invoke is not this build"),
        "{line}"
    );
    // A WARN is not a failure: doctor still exits 0.
    assert_eq!(exit_code(&out), 0);
}

/// The same check reports OK when the `tendril` on `PATH` *is* the running build.
#[test]
fn doctor_reports_ok_when_tendril_on_path_is_this_build() {
    let fx = Fixture::new("path-match");
    let exe = PathBuf::from(env!("CARGO_BIN_EXE_tendril"));
    let bin_dir = exe.parent().unwrap();

    let out = fx
        .command(&["doctor"])
        .env("PATH", format!("{}:{}", bin_dir.display(), BASE_PATH))
        .output()
        .expect("run tendril");
    let stdout = stdout_of(&out);

    let line = line_with(&stdout, "tendril on PATH:");
    assert!(
        line.starts_with("[OK] "),
        "the build on PATH matches the one running, so this is OK: {line}"
    );
    assert!(line.contains(&exe.display().to_string()), "{line}");
}

/// No `tendril` on `PATH` at all is a WARN, not a failure — the binary can legitimately be invoked
/// by absolute path. Nothing named `tendril` is in the stub directory or in [`BASE_PATH`], and the
/// agent CLI is stubbed so the only interesting line is the PATH one.
#[test]
fn doctor_warns_when_tendril_is_not_on_path() {
    let fx = Fixture::new("path-missing");
    let out = fx
        .command(&["doctor"])
        .env("PATH", fx.path_with_stubs(&["claude"]))
        .output()
        .expect("run tendril");
    assert_tagged(&stdout_of(&out), "tendril not found on PATH", "WARN");
    assert_eq!(exit_code(&out), 0);
}

// ---------------------------------------------------------------------------
// exit code
// ---------------------------------------------------------------------------

/// The exit-code contract (issue #136): `doctor` exits **1** when any check is `[FAIL]`, so a CI job
/// or wrapper script can gate on Tendril health. The full report still prints on stdout; only the
/// summary goes to stderr.
///
/// This replaces `doctor_exits_0_even_when_a_check_fails`, which pinned the old always-0 behaviour.
#[test]
fn doctor_exits_1_when_a_check_fails() {
    let fx = Fixture::new("fail-exit-1");
    // Unparseable YAML: `load_config` errors, which is the FAIL branch of the config check.
    std::fs::write(fx.home.join("config.yaml"), "codingAgent: [unclosed\n").unwrap();

    let out = fx.run(&["doctor"]);
    let stdout = stdout_of(&out);
    assert_tagged(&stdout, "Config file error:", "FAIL");
    assert_eq!(
        exit_code(&out),
        1,
        "a FAIL must be visible in $?, or nothing can gate on doctor"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("health check(s) failed"),
        "the summary must say why the exit code is non-zero: {stderr}"
    );
    // The report is still the whole report: a gate that swallows the diagnosis is useless.
    assert!(stdout.contains("Plans directory"), "{stdout}");
}

/// The invariant behind the exit code, asserted without depending on what is installed on the
/// machine: exit 0 if and only if no line is tagged `[FAIL]`. A `[WARN]` never counts — a fresh
/// install legitimately warns (no config, no plans directory, never synced, no `gh`), and a wrapper
/// that gated on warnings would refuse to run on every new machine.
#[test]
fn doctor_exit_code_is_the_presence_of_a_fail_line() {
    for (tag, stubs) in [
        ("no-stubs", &[][..]),
        ("agent-stubbed", &["claude"][..]),
        ("agent-and-gh", &["claude", "gh"][..]),
    ] {
        let fx = Fixture::new(tag);
        let out = fx
            .command(&["doctor"])
            .env("PATH", fx.path_with_stubs(stubs))
            .output()
            .expect("run tendril");
        let stdout = stdout_of(&out);
        let failed = stdout.lines().any(|l| l.starts_with("[FAIL] "));
        assert_eq!(
            exit_code(&out),
            i32::from(failed),
            "{tag}: exit code must be exactly \"is there a [FAIL] line\":\n{stdout}"
        );
        assert!(
            stdout.lines().any(|l| l.starts_with("[WARN] ")),
            "{tag}: a temp home must warn about something:\n{stdout}"
        );
    }
}

#[test]
fn doctor_exits_0_when_checks_only_warn() {
    let fx = Fixture::new("warn-exit-0");
    // `git` and the active agent present, `gh` absent: warnings but no failures.
    let out = fx
        .command(&["doctor"])
        .env("PATH", fx.path_with_stubs(&["claude"]))
        .output()
        .expect("run tendril");
    let stdout = stdout_of(&out);
    assert!(
        stdout.lines().any(|l| l.starts_with("[WARN] ")),
        "a bare home must produce warnings:\n{stdout}"
    );
    assert!(
        !stdout.lines().any(|l| l.starts_with("[FAIL] ")),
        "a bare home must produce no failures:\n{stdout}"
    );
    assert_eq!(exit_code(&out), 0);
}

/// The *active* agent's CLI missing is a FAIL — nothing can run without it — so it exits 1. An
/// inactive agent's CLI missing is a WARN, which does not.
#[test]
fn doctor_fails_the_agent_check_when_the_active_cli_is_missing() {
    let fx = Fixture::new("agent-missing");
    std::fs::write(fx.home.join("config.yaml"), "codingAgent: claude\n").unwrap();

    let out = fx.run(&["doctor"]);
    let stdout = stdout_of(&out);
    assert_tagged(
        &stdout,
        "claude (active): CLI 'claude' not found on PATH",
        "FAIL",
    );
    assert_eq!(exit_code(&out), 1);
}

/// An *inactive* agent's CLI missing is only a WARN, so it must not gate: exit 0.
#[test]
fn doctor_exits_0_when_only_an_inactive_agents_cli_is_missing() {
    let fx = Fixture::new("agent-inactive-missing");
    std::fs::write(
        fx.home.join("config.yaml"),
        "codingAgent: claude\ncodingAgents:\n  - name: codex\n",
    )
    .unwrap();

    let out = fx
        .command(&["doctor"])
        .env("PATH", fx.path_with_stubs(&["claude"]))
        .output()
        .expect("run tendril");
    let stdout = stdout_of(&out);
    assert_tagged(&stdout, "codex: CLI 'codex' not found on PATH", "WARN");
    assert_eq!(
        exit_code(&out),
        0,
        "an inactive agent is optional, so its absence is not a gate failure:\n{stdout}"
    );
}

// ---------------------------------------------------------------------------
// side effects
// ---------------------------------------------------------------------------

/// The database check opens the database, and opening it migrates it — so running `doctor` on a home
/// with no `tendril.db` creates a fully migrated one. Pinned because it is a write from a command
/// whose name suggests it only looks.
#[test]
fn doctor_creates_and_migrates_a_missing_database() {
    let fx = Fixture::new("db-side-effect");
    assert!(!fx.home.join("tendril.db").exists());

    let stdout = stdout_of(&fx.run(&["doctor"]));
    assert_tagged(&stdout, "Database accessible and migrated", "OK");

    assert!(fx.home.join("tendril.db").exists());
    let version: i64 = fx
        .conn()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);
}

/// A `tendril.db` that is not a database at all is the FAIL branch of the database check, and it must
/// not take the rest of the report down with it.
#[test]
fn doctor_reports_an_unopenable_database_as_a_failure_and_keeps_going() {
    let fx = Fixture::new("db-fail");
    std::fs::write(fx.home.join("tendril.db"), b"not a database").unwrap();

    let out = fx.run(&["doctor"]);
    let stdout = stdout_of(&out);
    assert_tagged(&stdout, "Database error:", "FAIL");
    assert!(
        stdout.contains("Plans directory"),
        "the checks after the database must still run:\n{stdout}"
    );
    assert_eq!(
        exit_code(&out),
        1,
        "an unopenable database is a [FAIL], so it gates"
    );
}

// ---------------------------------------------------------------------------
// --rebuild-search-index
// ---------------------------------------------------------------------------

/// The rebuild has to happen before the checks read the index, but its line is printed directly
/// after the database line — that interleaving is the contract.
#[test]
fn rebuild_search_index_reports_the_count_directly_after_the_database_line() {
    let fx = Fixture::new("rebuild-order");
    // Two plans to index, so the count is not trivially zero.
    assert_eq!(
        exit_code(&fx.run(&["db", "migrate"])),
        0,
        "seed the database first"
    );
    insert_plan(&fx.conn(), 1, "First");
    insert_plan(&fx.conn(), 2, "Second");

    // The agent CLI is stubbed so the run has no `[FAIL]` line and the exit code stays 0; the rebuild
    // itself is what is under test.
    let out = fx
        .command(&["doctor", "--rebuild-search-index"])
        .env("PATH", fx.path_with_stubs(&["claude"]))
        .output()
        .expect("run tendril");
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("Rebuilt plan search index (2 plans)."),
        "{stdout}"
    );

    let lines: Vec<&str> = stdout.lines().collect();
    let db_index = lines
        .iter()
        .position(|l| l.contains("Database accessible and migrated"))
        .unwrap_or_else(|| panic!("no database line in:\n{stdout}"));
    assert_eq!(
        lines[db_index + 1],
        "Rebuilt plan search index (2 plans).",
        "the rebuild note must sit immediately after the database line:\n{stdout}"
    );
}

#[test]
fn rebuild_search_index_reports_zero_for_an_empty_database() {
    let fx = Fixture::new("rebuild-empty");
    let stdout = stdout_of(&fx.run(&["doctor", "--rebuild-search-index"]));
    assert!(
        stdout.contains("Rebuilt plan search index (0 plans)."),
        "{stdout}"
    );
}

/// Without the flag the note must not appear at all — `doctor` does not mutate the index by default.
#[test]
fn doctor_does_not_rebuild_the_index_unless_asked() {
    let fx = Fixture::new("no-rebuild");
    let stdout = stdout_of(&fx.run(&["doctor"]));
    assert!(!stdout.contains("Rebuilt plan search index"), "{stdout}");
}

/// When the database cannot be opened there is nothing to rebuild, and the database check already
/// says why — so the rebuild line is suppressed rather than duplicating the error.
#[test]
fn rebuild_search_index_is_silent_when_the_database_cannot_be_opened() {
    let fx = Fixture::new("rebuild-no-db");
    std::fs::write(fx.home.join("tendril.db"), b"not a database").unwrap();

    let out = fx.run(&["doctor", "--rebuild-search-index"]);
    let stdout = stdout_of(&out);
    assert!(
        !stdout.contains("Rebuilt plan search index")
            && !stdout.contains("Could not rebuild plan search index"),
        "the database check already reports the error; a second line would duplicate it:\n{stdout}"
    );
    assert_tagged(&stdout, "Database error:", "FAIL");
    assert_eq!(exit_code(&out), 1);
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

#[test]
fn doctor_usage_errors_exit_2() {
    let fx = Fixture::new("usage");
    for args in [
        vec!["doctor", "--bogus"],
        vec!["doctor", "--rebuild-search-indx"],
        vec!["doctor", "unexpected-positional"],
    ] {
        let out = fx.run(&args);
        assert_eq!(exit_code(&out), 2, "{args:?} must be a clap usage error");
    }
}

#[test]
fn doctor_help_documents_the_rebuild_flag() {
    let fx = Fixture::new("help");
    let out = fx.run(&["doctor", "--help"]);
    assert_eq!(exit_code(&out), 0);
    assert!(
        stdout_of(&out).contains("--rebuild-search-index"),
        "{}",
        stdout_of(&out)
    );
}
