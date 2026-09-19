//! `tendril reset` end to end.
//!
//! This is the one command in the CLI whose whole job is recursive deletion, so isolation is not a
//! nicety here. Every test:
//!   * builds its own scratch root under `std::env::temp_dir()`,
//!   * asserts that root is under the temp dir before the command runs,
//!   * passes `--home` explicitly and clears `TENDRIL_HOME` / `TENDRIL_PLANS` from the child, so the
//!     ambient `TENDRIL_HOME` (a real installation on a developer machine) is never resolved,
//!   * removes its root on drop, leaving nothing behind.
//!
//! The "real home" cases never point at the developer's actual home: `HOME` is redirected at a temp
//! directory so `real_user_tendril_home()` resolves inside the fixture.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use tendril_core::config::{ensure_not_real_home, real_user_tendril_home};

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-cli-reset-test-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&root).unwrap();
        assert!(
            root.starts_with(std::env::temp_dir()),
            "reset fixtures must live under the temp dir, got {}",
            root.display()
        );
        Self { root }
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    fn plans(&self) -> PathBuf {
        self.root.join("plans")
    }

    /// Seeds a home with a couple of files and a plans directory with a couple of plan folders.
    fn seed(&self) {
        std::fs::create_dir_all(self.home().join("Hooks")).unwrap();
        std::fs::write(self.home().join("config.yaml"), "codingAgent: claude\n").unwrap();
        std::fs::write(self.home().join("tendril.db"), b"db").unwrap();
        std::fs::write(self.home().join("Hooks").join("hook.ps1"), "#").unwrap();
        std::fs::create_dir_all(self.plans().join("00001-First")).unwrap();
        std::fs::create_dir_all(self.plans().join("00002-Second")).unwrap();
        std::fs::write(
            self.plans().join("00001-First").join("plan.yaml"),
            "title: First\n",
        )
        .unwrap();
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
        cmd.arg("--home")
            .arg(self.home())
            .args(args)
            .env("TENDRIL_PLANS", self.plans())
            .env_remove("TENDRIL_HOME")
            .env_remove("TENDRIL_CONFIG");
        cmd
    }

    /// Runs with stdin closed: the non-interactive case.
    fn run(&self, args: &[&str]) -> Output {
        self.command(args)
            .stdin(Stdio::null())
            .output()
            .expect("run tendril")
    }

    fn run_with_stdin(&self, args: &[&str], answer: &str) -> Output {
        let mut child = self
            .command(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn tendril");
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(answer.as_bytes())
            .unwrap();
        child.wait_with_output().expect("wait for tendril")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.root.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn stdout_of(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn stderr_of(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).to_string()
}

fn exit_code(out: &Output) -> i32 {
    out.status
        .code()
        .expect("the CLI must exit, not be signalled")
}

// ---------------------------------------------------------------------------
// what it deletes
// ---------------------------------------------------------------------------

#[test]
fn reset_force_deletes_home_and_plans() {
    let fx = Fixture::new("force");
    fx.seed();
    // A sibling directory under the same root stands in for anything else on the machine.
    let bystander = fx.root.join("repos");
    std::fs::create_dir_all(&bystander).unwrap();
    std::fs::write(bystander.join("keep.txt"), "keep").unwrap();

    let out = fx.run(&["reset", "--force"]);
    assert_eq!(exit_code(&out), 0, "stderr:\n{}", stderr_of(&out));

    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("The following items will be deleted:"),
        "{stdout}"
    );
    assert!(
        stdout.contains(&format!("[OK] Deleted directory: {}", fx.home().display())),
        "{stdout}"
    );
    assert!(
        stdout.contains(&format!("[OK] Deleted directory: {}", fx.plans().display())),
        "{stdout}"
    );
    assert!(stdout.contains("Reset complete."), "{stdout}");
    assert!(
        stdout.contains("Please restart your terminal"),
        "the closing advice is part of the contract: {stdout}"
    );

    assert!(!fx.home().exists(), "home must be gone");
    assert!(!fx.plans().exists(), "plans must be gone");
    assert!(
        bystander.join("keep.txt").exists(),
        "reset must delete only home and plans, nothing beside them"
    );
}

/// The listing before the prompt describes home by its recursive file count and plans by its
/// top-level folder count. An operator reads those numbers to decide.
#[test]
fn reset_describes_what_it_will_delete_before_asking() {
    let fx = Fixture::new("listing");
    fx.seed();

    let out = fx.run_with_stdin(&["reset"], "n\n");
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains(&format!(
            "Directory: {} (exists, 3 files)",
            fx.home().display()
        )),
        "home is described by its recursive file count:\n{stdout}"
    );
    assert!(
        stdout.contains(&format!(
            "Directory: {} (exists, 2 folders)",
            fx.plans().display()
        )),
        "plans is described by its top-level folder count:\n{stdout}"
    );
}

#[test]
fn reset_on_a_missing_home_says_nothing_to_reset_and_creates_nothing() {
    let fx = Fixture::new("nothing");

    let out = fx.run(&["reset", "--force"]);
    assert_eq!(exit_code(&out), 0);
    assert_eq!(stdout_of(&out).trim(), "Nothing to reset.");
    assert!(
        !fx.home().exists(),
        "reset must not create the home it was asked to delete"
    );
    assert!(!fx.plans().exists());
}

/// A home with no plans directory reports and deletes only the home.
#[test]
fn reset_deletes_home_alone_when_there_is_no_plans_directory() {
    let fx = Fixture::new("home-only");
    std::fs::create_dir_all(fx.home()).unwrap();
    std::fs::write(fx.home().join("tendril.db"), b"db").unwrap();

    let out = fx.run(&["reset", "--force"]);
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert_eq!(
        stdout
            .lines()
            .filter(|l| l.starts_with("[OK] Deleted directory:"))
            .count(),
        1,
        "only one directory existed, so only one deletion should be reported:\n{stdout}"
    );
    assert!(!fx.home().exists());
}

// ---------------------------------------------------------------------------
// the interactive confirmation
// ---------------------------------------------------------------------------

/// `reset`'s prompt defaults to no and accepts the looser `y`/`yes` answers — deliberately different
/// from `db reset`, which takes only an exact `y`.
#[test]
fn reset_prompt_answers() {
    for (answer, should_delete) in [
        ("y\n", true),
        ("Y\n", true),
        ("yes\n", true),
        ("YES\n", true),
        ("n\n", false),
        ("no\n", false),
        ("\n", false),
        ("maybe\n", false),
    ] {
        let fx = Fixture::new("prompt");
        fx.seed();

        let out = fx.run_with_stdin(&["reset"], answer);
        assert_eq!(
            exit_code(&out),
            0,
            "{answer:?}: both answers exit 0; only the effect differs"
        );

        if should_delete {
            assert!(!fx.home().exists(), "{answer:?} must delete the home");
            assert!(!fx.plans().exists(), "{answer:?} must delete the plans dir");
        } else {
            assert!(
                stdout_of(&out).contains("Cancelled."),
                "{answer:?} must report cancellation: {}",
                stdout_of(&out)
            );
            assert!(fx.home().exists(), "{answer:?} must leave the home alone");
            assert!(
                fx.plans().exists(),
                "{answer:?} must leave the plans dir alone"
            );
        }
    }
}

/// A closed stdin reads as an empty line, and the prompt's default is no — so a piped or
/// scripted `reset` without `--force` never deletes anything.
#[test]
fn reset_without_force_declines_when_stdin_is_closed() {
    let fx = Fixture::new("eof");
    fx.seed();

    let out = fx.run(&["reset"]);
    assert_eq!(exit_code(&out), 0);
    assert!(
        stdout_of(&out).contains("Cancelled."),
        "{}",
        stdout_of(&out)
    );
    assert!(
        fx.home().exists(),
        "an unanswered prompt must not delete the home"
    );
    assert!(fx.plans().exists());
}

/// `--force` skips the prompt entirely: the command must not block waiting for input even when
/// stdin is an open pipe nobody writes to.
#[test]
fn reset_force_never_reads_stdin() {
    let fx = Fixture::new("force-no-stdin");
    fx.seed();

    let out = fx.run_with_stdin(&["reset", "--force"], "");
    assert_eq!(exit_code(&out), 0);
    assert!(
        !stdout_of(&out).contains("Proceed with reset?"),
        "--force must not print the prompt: {}",
        stdout_of(&out)
    );
    assert!(!fx.home().exists());
}

// ---------------------------------------------------------------------------
// environment variables
// ---------------------------------------------------------------------------

/// `reset` reports the Tendril environment variables it found but never unsets them — it has no
/// business rewriting a shell rc file.
#[test]
fn reset_reports_the_environment_variables_it_will_not_remove() {
    let fx = Fixture::new("env-report");
    fx.seed();

    // Here `TENDRIL_HOME` is deliberately set, pointing at the fixture home, so both variables are
    // in the report.
    let out = fx
        .command(&["reset", "--force"])
        .env("TENDRIL_HOME", fx.home())
        .stdin(Stdio::null())
        .output()
        .expect("run tendril");

    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("Note: remove these environment variables"),
        "{stdout}"
    );
    assert!(stdout.contains("  TENDRIL_HOME"), "{stdout}");
    assert!(stdout.contains("  TENDRIL_PLANS"), "{stdout}");
}

/// With neither variable set the note is omitted entirely rather than printed with an empty list.
#[test]
fn reset_omits_the_environment_note_when_nothing_is_set() {
    let fx = Fixture::new("env-none");
    std::fs::create_dir_all(fx.home()).unwrap();
    std::fs::write(fx.home().join("tendril.db"), b"db").unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--home")
        .arg(fx.home())
        .args(["reset", "--force"])
        .env_remove("TENDRIL_HOME")
        .env_remove("TENDRIL_PLANS")
        .env_remove("TENDRIL_CONFIG")
        .stdin(Stdio::null())
        .output()
        .expect("run tendril");

    assert_eq!(exit_code(&out), 0);
    assert!(
        !stdout_of(&out).contains("Note: remove these environment variables"),
        "{}",
        stdout_of(&out)
    );
    assert!(!fx.home().exists());
}

// ---------------------------------------------------------------------------
// the real-home safety guard
// ---------------------------------------------------------------------------

/// `ensure_not_real_home` is what stands between a test process and the operator's installation.
/// Called from a cargo test binary it is armed, so the real home must be refused outright — and this
/// assertion is safe because it only inspects the error, it deletes nothing.
#[test]
fn ensure_not_real_home_refuses_the_operators_real_home() {
    let real = real_user_tendril_home();
    let err = ensure_not_real_home(&real)
        .expect_err("a test process must not be allowed to claim the real home");
    let message = err.to_string();
    assert!(
        message.contains("Refusing to use the real Tendril home"),
        "{message}"
    );
    assert!(
        message.contains(&real.display().to_string()),
        "the refusal must name the path it protected: {message}"
    );
}

/// The guard has to be path-equality, not a substring or a prefix test: a temp home, and a
/// subdirectory of the real home, both have to pass.
#[test]
fn ensure_not_real_home_allows_anything_else() {
    let fx = Fixture::new("guard-allows");
    ensure_not_real_home(&fx.root).expect("a temp directory must be allowed");
    ensure_not_real_home(&real_user_tendril_home().join("Plans"))
        .expect("only the home itself is protected, not paths under it");
}

/// End to end: a home that resolves as "the real one" is refused before anything is deleted.
///
/// `HOME` is redirected at a temp directory, so `<temp>/.tendril` is what
/// `real_user_tendril_home()` resolves to inside the child — the developer's actual home is never
/// named, let alone touched.
#[test]
fn reset_refuses_a_home_that_resolves_as_the_real_one() {
    let fx = Fixture::new("guard-refuses");
    let fake_user_home = fx.root.join("fake-user");
    let looks_real = fake_user_home.join(".tendril");
    std::fs::create_dir_all(&looks_real).unwrap();
    std::fs::write(looks_real.join("config.yaml"), "codingAgent: claude\n").unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--home")
        .arg(&looks_real)
        .args(["reset", "--force"])
        .env("HOME", &fake_user_home)
        .env_remove("USERPROFILE")
        .env_remove("TENDRIL_HOME")
        .env_remove("TENDRIL_PLANS")
        .env_remove("TENDRIL_CONFIG")
        // What marks the child as a test process; without it the guard is a no-op, which is how an
        // operator resetting their own home from a shell still works.
        .env("TENDRIL_TEST_ISOLATION", "1")
        .stdin(Stdio::null())
        .output()
        .expect("run tendril");

    assert_eq!(exit_code(&out), 1, "the guard must fail the command");
    assert!(
        stderr_of(&out).contains("Refusing to use the real Tendril home"),
        "the refusal must explain itself, got:\n{}",
        stderr_of(&out)
    );
    assert!(
        looks_real.join("config.yaml").exists(),
        "the guard must fire before any deletion"
    );
    assert!(
        !stdout_of(&out).contains("Deleted directory"),
        "nothing may be reported as deleted: {}",
        stdout_of(&out)
    );
}

/// The same home is deleted happily once it is no longer the resolved real home, proving the refusal
/// above came from the guard and not from something incidental about the path.
#[test]
fn the_same_path_is_deletable_when_it_is_not_the_real_home() {
    let fx = Fixture::new("guard-control");
    let fake_user_home = fx.root.join("fake-user");
    let looks_real = fake_user_home.join(".tendril");
    std::fs::create_dir_all(&looks_real).unwrap();
    std::fs::write(looks_real.join("config.yaml"), "codingAgent: claude\n").unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--home")
        .arg(&looks_real)
        .args(["reset", "--force"])
        // `HOME` now points somewhere else, so the resolved real home is a different path.
        .env("HOME", fx.root.join("elsewhere"))
        .env_remove("USERPROFILE")
        .env_remove("TENDRIL_HOME")
        .env("TENDRIL_PLANS", fx.plans())
        .env_remove("TENDRIL_CONFIG")
        .env("TENDRIL_TEST_ISOLATION", "1")
        .stdin(Stdio::null())
        .output()
        .expect("run tendril");

    assert_eq!(exit_code(&out), 0, "stderr:\n{}", stderr_of(&out));
    assert!(!looks_real.exists(), "{}", stdout_of(&out));
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

#[test]
fn reset_usage_errors_exit_2() {
    let fx = Fixture::new("usage");

    for args in [
        vec!["reset", "--forse"],
        vec!["reset", "--force", "extra-positional"],
    ] {
        let out = fx.run(&args);
        assert_eq!(exit_code(&out), 2, "{args:?} must be a clap usage error");
        assert!(
            !fx.home().exists(),
            "{args:?} must not have deleted anything"
        );
    }
}

#[test]
fn reset_help_documents_force() {
    let fx = Fixture::new("help");
    let out = fx.run(&["reset", "--help"]);
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(stdout.contains("--force"), "{stdout}");
    assert!(stdout.contains("Skip confirmation prompt"), "{stdout}");
}
