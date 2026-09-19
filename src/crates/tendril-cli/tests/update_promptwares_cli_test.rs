//! End-to-end behaviour of `tendril update-promptwares`.
//!
//! Unlike `promptware deploy`, this command *replaces* each promptware folder from a source tree
//! rather than overlaying it — so the thing worth pinning is that `Memory/` and `Tools/` still come
//! out the other side, and that `--dry-run` reports exactly the set the real run would touch without
//! writing anything.
//!
//! Every test runs the built binary against a throwaway `TENDRIL_HOME` and an explicit source tree,
//! so nothing depends on the repo's own `src/promptwares` or on the operator's Tendril home.

use std::path::{Path, PathBuf};
use std::process::Command;

struct Fixture {
    root: PathBuf,
}

struct Run {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl Run {
    fn ok(&self) -> &Self {
        assert_eq!(
            self.code,
            Some(0),
            "expected success\nstdout: {}\nstderr: {}",
            self.stdout,
            self.stderr
        );
        self
    }

    fn lines(&self) -> Vec<&str> {
        self.stdout.lines().collect()
    }
}

impl Fixture {
    /// A source tree with two promptwares, one of them shipping a `Memory/.gitkeep` placeholder and
    /// a tool — exactly the shape `src/promptwares` has.
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-cli-update-pw-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(root.starts_with(std::env::temp_dir()));
        let fx = Fixture { root };
        std::fs::create_dir_all(fx.home()).unwrap();

        fx.write_source("CreatePlan/Program.md", "source create plan");
        fx.write_source("CreatePlan/Reference.md", "source reference");
        fx.write_source("CreatePlan/Memory/.gitkeep", "");
        fx.write_source("CreatePlan/Tools/Shipped-Tool.ps1", "shipped tool");
        fx.write_source("ExecutePlan/Program.md", "source execute plan");
        fx
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    fn source(&self) -> PathBuf {
        self.root.join("source")
    }

    fn target(&self) -> PathBuf {
        self.home().join("Promptwares")
    }

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn write_source(&self, relative: &str, contents: &str) {
        Self::write(&self.source().join(relative), contents);
    }

    fn write_target(&self, relative: &str, contents: &str) {
        Self::write(&self.target().join(relative), contents);
    }

    fn read_target(&self, relative: &str) -> String {
        std::fs::read_to_string(self.target().join(relative))
            .unwrap_or_else(|e| panic!("read {relative}: {e}"))
    }

    /// Runs `tendril --home <fixture home> update-promptwares <args>`.
    ///
    /// `TENDRIL_PROMPTWARES` is pointed at the fixture source so the command never falls back to
    /// probing the repo, and the working directory is the fixture root so a probe would find nothing
    /// even if it happened.
    fn run(&self, args: &[&str]) -> Run {
        self.run_without_source_env(args, true)
    }

    fn run_without_source_env(&self, args: &[&str], with_env: bool) -> Run {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
        cmd.arg("--home")
            .arg(self.home())
            .arg("update-promptwares")
            .args(args)
            .current_dir(&self.root)
            .env_remove("TENDRIL_CONFIG")
            .env_remove("TENDRIL_PROMPTWARE_OVERLAY");
        if with_env {
            cmd.env("TENDRIL_PROMPTWARES", self.source());
        } else {
            cmd.env_remove("TENDRIL_PROMPTWARES");
        }

        let out = cmd.output().expect("run tendril");
        Run {
            code: out.status.code(),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.root.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// The headline contract: program files are replaced, `Memory/` and `Tools/` survive.
#[test]
fn update_replaces_program_files_and_preserves_memory_and_tools() {
    let fx = Fixture::new("preserve");
    fx.write_target("CreatePlan/Program.md", "stale program");
    fx.write_target("CreatePlan/Stale.md", "no longer shipped");
    fx.write_target("CreatePlan/Memory/lesson.md", "hard-won lesson");
    fx.write_target("CreatePlan/Memory/nested/deeper.md", "nested lesson");
    fx.write_target("CreatePlan/Tools/Agent-Written.ps1", "Write-Host agent");

    let run = fx.run(&[]);
    run.ok();

    let lines = run.lines();
    assert_eq!(
        lines[0],
        format!("Updating promptwares in {}...", fx.target().display())
    );
    assert_eq!(
        lines[1], "  CreatePlan: preserved 2 memory file(s), 1 tool file(s)",
        "counts are recursive and cover only what was preserved: {lines:?}"
    );
    assert_eq!(
        lines[2],
        "  ExecutePlan: preserved 0 memory file(s), 0 tool file(s)"
    );
    assert_eq!(lines[3], "Done.");
    assert_eq!(lines.len(), 4, "{lines:?}");

    assert_eq!(
        fx.read_target("CreatePlan/Program.md"),
        "source create plan"
    );
    assert_eq!(
        fx.read_target("CreatePlan/Reference.md"),
        "source reference"
    );
    assert_eq!(
        fx.read_target("CreatePlan/Memory/lesson.md"),
        "hard-won lesson"
    );
    assert_eq!(
        fx.read_target("CreatePlan/Memory/nested/deeper.md"),
        "nested lesson"
    );
    assert_eq!(
        fx.read_target("CreatePlan/Tools/Agent-Written.ps1"),
        "Write-Host agent"
    );
    assert!(
        !fx.target().join("CreatePlan/Stale.md").exists(),
        "update replaces the promptware folder rather than overlaying it"
    );
    assert!(
        !fx.target().join("CreatePlan/Memory/.gitkeep").exists(),
        "the source's Memory placeholder must never land on top of real memory"
    );

    // A promptware the source has but the home does not is installed from scratch, with both
    // preserved directories present.
    assert_eq!(
        fx.read_target("ExecutePlan/Program.md"),
        "source execute plan"
    );
    assert!(fx.target().join("ExecutePlan/Memory").is_dir());
    assert!(fx.target().join("ExecutePlan/Tools").is_dir());
}

/// BUG (unfixed, outside this test's owned files): `update-promptwares` drops every tool the source
/// tree ships, because `replace_promptware` deletes both `PRESERVED_DIRS` after copying the source
/// and then restores only what the *home* already had — see
/// `tendril-core/src/promptware/deployer.rs:478-483`. That reasoning is right for `Memory/` (the
/// source only ever ships a `.gitkeep` placeholder) but wrong for `Tools/`, which
/// `deploy_promptwares` deliberately merges so "the shipped tools, the overlay's tools and the ones
/// agents write at run time all coexist" (`deployer.rs:64-66`). The two commands therefore disagree
/// about the same directory.
///
/// Harmless today only because no promptware in `src/promptwares` ships a real tool — every
/// `*/Tools` holds just `.gitkeep`. The first shipped tool would vanish on the next
/// `tendril update-promptwares`.
///
/// Fix: in `replace_promptware`, restrict the post-copy delete to the directories a source may not
/// supply (`Memory` only, i.e. `NEVER_DEPLOYED_DIRS`), and merge the preserved `Tools/` back over the
/// source's rather than replacing it.
#[test]
#[ignore = "product bug: update-promptwares drops source-shipped Tools/ - see doc comment"]
fn update_should_install_the_sources_own_tools_alongside_the_preserved_ones() {
    let fx = Fixture::new("tools-merge");
    fx.write_target("CreatePlan/Tools/Agent-Written.ps1", "Write-Host agent");

    fx.run(&[]).ok();

    assert_eq!(
        fx.read_target("CreatePlan/Tools/Agent-Written.ps1"),
        "Write-Host agent"
    );
    assert_eq!(
        fx.read_target("CreatePlan/Tools/Shipped-Tool.ps1"),
        "shipped tool",
        "a tool the source ships must be installed, as `promptware deploy` already does"
    );
}

/// The other half of the same bug, pinned as it behaves today so a fix has to update this test
/// deliberately rather than by accident.
#[test]
fn update_currently_drops_the_sources_own_tools() {
    let fx = Fixture::new("tools-dropped");

    let run = fx.run(&[]);
    run.ok();

    assert!(
        !fx.target()
            .join("CreatePlan/Tools/Shipped-Tool.ps1")
            .exists(),
        "known divergence from `promptware deploy`; see \
         update_should_install_the_sources_own_tools_alongside_the_preserved_ones"
    );
    assert!(
        fx.target().join("CreatePlan/Tools").is_dir(),
        "the directory itself is always created"
    );
    assert!(run
        .stdout
        .contains("CreatePlan: preserved 0 memory file(s), 0 tool file(s)"));
}

#[test]
fn update_is_idempotent() {
    let fx = Fixture::new("idempotent");
    fx.write_target("CreatePlan/Memory/lesson.md", "hard-won lesson");

    fx.run(&[]).ok();
    let second = fx.run(&[]);
    second.ok();

    assert!(
        second
            .stdout
            .contains("CreatePlan: preserved 1 memory file(s), 0 tool file(s)"),
        "{}",
        second.stdout
    );
    assert_eq!(
        fx.read_target("CreatePlan/Memory/lesson.md"),
        "hard-won lesson"
    );

    // No scratch directory is left next to Promptwares.
    let leftovers: Vec<String> = std::fs::read_dir(fx.home())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.starts_with(".promptwares-updating-"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "scratch dirs left behind: {leftovers:?}"
    );
}

/// A promptware only the home has is left completely alone — update refreshes what the source
/// carries, it does not prune the installation.
#[test]
fn update_leaves_a_promptware_the_source_does_not_carry_alone() {
    let fx = Fixture::new("extra");
    fx.write_target("TeamOnly/Program.md", "team only program");
    fx.write_target("TeamOnly/Memory/lesson.md", "team lesson");

    let run = fx.run(&[]);
    run.ok();

    assert!(!run.stdout.contains("TeamOnly"), "{}", run.stdout);
    assert_eq!(fx.read_target("TeamOnly/Program.md"), "team only program");
    assert_eq!(fx.read_target("TeamOnly/Memory/lesson.md"), "team lesson");
}

#[test]
fn dry_run_reports_the_same_set_and_writes_nothing() {
    let fx = Fixture::new("dry-run");
    fx.write_target("CreatePlan/Program.md", "stale program");
    fx.write_target("CreatePlan/Memory/lesson.md", "hard-won lesson");
    fx.write_target("CreatePlan/Tools/a.ps1", "a");
    fx.write_target("CreatePlan/Tools/b.ps1", "b");

    let run = fx.run(&["--dry-run"]);
    run.ok();

    let lines = run.lines();
    assert_eq!(
        lines[0],
        format!("Would update promptwares in {}...", fx.target().display())
    );
    assert_eq!(
        lines[1], "  CreatePlan: would replace program files, preserve Memory: 1, Tools: 2",
        "an existing promptware is a replace: {lines:?}"
    );
    assert_eq!(
        lines[2], "  ExecutePlan: would install program files, preserve Memory: 0, Tools: 0",
        "a promptware not yet in home is an install: {lines:?}"
    );
    assert_eq!(lines[3], "Dry run — nothing written.");
    assert_eq!(lines.len(), 4, "{lines:?}");

    assert_eq!(
        fx.read_target("CreatePlan/Program.md"),
        "stale program",
        "--dry-run must not touch the program"
    );
    assert!(
        !fx.target().join("ExecutePlan").exists(),
        "--dry-run must not install anything"
    );
    assert!(
        !fx.target().join("CreatePlan/Reference.md").exists(),
        "--dry-run must not copy source files"
    );
}

#[test]
fn source_flag_overrides_the_discovered_source() {
    let fx = Fixture::new("source-flag");
    let other = fx.root.join("other-source");
    Fixture::write(&other.join("TeamOnly/Program.md"), "other source program");

    let run = fx.run(&["--source", other.to_str().unwrap()]);
    run.ok();

    assert!(run.stdout.contains("TeamOnly: preserved"), "{}", run.stdout);
    assert!(
        !run.stdout.contains("CreatePlan"),
        "the discovered source is not consulted when --source is given: {}",
        run.stdout
    );
    assert_eq!(
        fx.read_target("TeamOnly/Program.md"),
        "other source program"
    );
    assert!(!fx.target().join("CreatePlan").exists());
}

#[test]
fn source_flag_wins_for_dry_run_too() {
    let fx = Fixture::new("source-flag-dry");
    let other = fx.root.join("other-source");
    Fixture::write(&other.join("TeamOnly/Program.md"), "other source program");

    let run = fx.run(&["--dry-run", "--source", other.to_str().unwrap()]);
    run.ok();

    assert_eq!(
        run.lines()[1],
        "  TeamOnly: would install program files, preserve Memory: 0, Tools: 0"
    );
    assert!(!fx.target().join("TeamOnly").exists());
}

#[test]
fn a_missing_source_directory_exits_one() {
    let fx = Fixture::new("source-missing");

    let run = fx.run(&["--source", fx.root.join("nope").to_str().unwrap()]);

    assert_eq!(run.code, Some(1), "stdout: {}", run.stdout);
    assert!(
        run.stdout
            .contains("Error: promptware source is not a directory:"),
        "{}",
        run.stdout
    );
    assert!(
        !fx.target().exists(),
        "nothing is created on the error path"
    );
}

#[test]
fn a_source_that_is_a_file_exits_one() {
    let fx = Fixture::new("source-file");
    let file = fx.root.join("not-a-dir.md");
    Fixture::write(&file, "just a file");

    let run = fx.run(&["--source", file.to_str().unwrap()]);

    assert_eq!(run.code, Some(1), "stdout: {}", run.stdout);
    assert!(
        run.stdout
            .contains("Error: promptware source is not a directory:"),
        "{}",
        run.stdout
    );
}

/// With no `--source` and no `TENDRIL_PROMPTWARES`, discovery probes a handful of repo-relative
/// paths. From a directory with none of them, the command has to say so and exit 1 rather than
/// silently doing nothing.
#[test]
fn no_discoverable_source_exits_one_with_guidance() {
    let fx = Fixture::new("source-none");

    let run = fx.run_without_source_env(&[], false);

    assert_eq!(run.code, Some(1), "stdout: {}", run.stdout);
    assert!(
        run.stdout.contains(
            "Error: no promptware source found. Set TENDRIL_PROMPTWARES or pass --source."
        ),
        "{}",
        run.stdout
    );
    assert!(run.stderr.is_empty(), "stderr: {}", run.stderr);
}

#[test]
fn an_unknown_flag_is_a_clap_usage_error() {
    let fx = Fixture::new("exit-two");

    let run = fx.run(&["--bogus"]);
    assert_eq!(
        run.code,
        Some(2),
        "stdout: {}\nstderr: {}",
        run.stdout,
        run.stderr
    );

    // `--source` takes a value.
    let run = fx.run(&["--source"]);
    assert_eq!(run.code, Some(2), "stderr: {}", run.stderr);
}
