//! End-to-end behaviour of `tendril promptware`.
//!
//! Every test spawns the built binary against a throwaway `TENDRIL_HOME` and a synthetic *shipped*
//! promptware tree (`TENDRIL_PROMPTWARES`), so nothing here depends on the real `src/promptwares`
//! contents, on the operator's own Tendril home, or on a daemon having deployed promptwares first.
//! The assertions are about exit codes, stdout shape and what lands on disk, which is why these run
//! the process rather than calling the handler in-process.

use clap::{CommandFactory, Parser};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tendril_cli::commands::promptware::PromptwareCommands;
use tendril_core::config::{load_config, save_config};
use tendril_core::promptware::shipped_version;

/// A minimal parser so `try_parse_from` exercises the real derive output, as `cli_parse_test.rs`
/// does for `PlanCommands`.
#[derive(Parser)]
#[command(name = "tendril")]
struct TestCli {
    #[command(subcommand)]
    command: PromptwareCommands,
}

fn parse(args: &[&str]) -> PromptwareCommands {
    TestCli::try_parse_from(args).expect("parse").command
}

#[test]
fn the_clap_definition_is_internally_consistent() {
    // Catches the `--file` / `--stdin` conflict being declared against a name that does not exist,
    // and any other malformed arg definition, at test time rather than on first use.
    TestCli::command().debug_assert();
}

#[test]
fn read_memory_takes_a_variadic_file_list() {
    let PromptwareCommands::ReadMemory { name, files } =
        parse(&["tendril", "read-memory", "CreatePlan", "a.md", "b.md"])
    else {
        panic!("expected read-memory");
    };
    assert_eq!(name, "CreatePlan");
    assert_eq!(files, vec!["a.md".to_string(), "b.md".to_string()]);

    // Zero files is allowed by the parser; it simply reads nothing.
    let PromptwareCommands::ReadMemory { files, .. } =
        parse(&["tendril", "read-memory", "CreatePlan"])
    else {
        panic!("expected read-memory");
    };
    assert!(files.is_empty());
}

#[test]
fn write_memory_input_flags_default_to_bare_stdin() {
    let PromptwareCommands::WriteMemory { file, stdin, .. } =
        parse(&["tendril", "write-memory", "CreatePlan", "lesson.md"])
    else {
        panic!("expected write-memory");
    };
    assert_eq!(file, None);
    assert!(!stdin);

    let PromptwareCommands::WriteTool {
        tool_name,
        file,
        stdin,
        ..
    } = parse(&[
        "tendril",
        "write-tool",
        "CreatePlan",
        "Tool.ps1",
        "--file",
        "/tmp/x",
    ])
    else {
        panic!("expected write-tool");
    };
    assert_eq!(tool_name, "Tool.ps1");
    assert_eq!(file, Some(PathBuf::from("/tmp/x")));
    assert!(!stdin);
}

#[test]
fn run_flags_all_parse_together() {
    let PromptwareCommands::Run {
        name,
        args,
        profile,
        working_dir,
        value,
        plan,
        promptware_path,
        config,
        agent,
        dry_run,
    } = parse(&[
        "tendril",
        "run",
        "ExecutePlan",
        "do the thing",
        "--profile",
        "deep",
        "--working-dir",
        "/tmp/wd",
        "--value",
        "A=1",
        "--value",
        "B=2",
        "--plan",
        "777",
        "--promptware-path",
        "/tmp/pw",
        "--config",
        "/tmp/config.yaml",
        "--agent",
        "codex",
        "--dry-run",
    ])
    else {
        panic!("expected run");
    };
    assert_eq!(name, "ExecutePlan");
    assert_eq!(args, vec!["do the thing".to_string()]);
    assert_eq!(profile.as_deref(), Some("deep"));
    assert_eq!(working_dir, Some(PathBuf::from("/tmp/wd")));
    assert_eq!(value, vec!["A=1".to_string(), "B=2".to_string()]);
    assert_eq!(plan.as_deref(), Some("777"));
    assert_eq!(promptware_path, Some(PathBuf::from("/tmp/pw")));
    assert_eq!(config, Some(PathBuf::from("/tmp/config.yaml")));
    assert_eq!(agent.as_deref(), Some("codex"));
    assert!(dry_run);
}

#[test]
fn layers_name_is_optional() {
    assert!(matches!(
        parse(&["tendril", "layers"]),
        PromptwareCommands::Layers { name: None }
    ));
    let PromptwareCommands::Layers { name } = parse(&["tendril", "layers", "CreatePlan"]) else {
        panic!("expected layers");
    };
    assert_eq!(name.as_deref(), Some("CreatePlan"));
}

/// A throwaway home plus the two promptware layers, removed on drop.
struct Fixture {
    root: PathBuf,
}

/// The result of one `tendril` invocation.
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

    /// The `promptware layers` row for `name`, from either `deploy` or `layers` output.
    fn row(&self, name: &str) -> &str {
        self.stdout
            .lines()
            .find(|l| l.starts_with(name))
            .unwrap_or_else(|| panic!("no row for {name} in:\n{}", self.stdout))
    }
}

impl Fixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-cli-promptware-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(root.starts_with(std::env::temp_dir()));
        let fx = Fixture { root };
        std::fs::create_dir_all(fx.home().join("Plans")).unwrap();

        // A shipped tree shaped like `src/promptwares`: two known promptwares, one shipping a tool,
        // and a `Memory/` placeholder that must never be deployed.
        fx.write_shipped("CreatePlan/Program.md", "shipped create plan v1");
        fx.write_shipped("CreatePlan/Tools/Shipped-Tool.ps1", "shipped tool");
        fx.write_shipped("CreatePlan/Memory/.gitkeep", "");
        fx.write_shipped("ExecutePlan/Program.md", "shipped execute plan");
        fx
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    fn shipped(&self) -> PathBuf {
        self.root.join("shipped")
    }

    fn overlay(&self) -> PathBuf {
        self.root.join("overlay")
    }

    /// `<home>/Promptwares`, where a deploy lands.
    fn deployed(&self) -> PathBuf {
        self.home().join("Promptwares")
    }

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn write_shipped(&self, relative: &str, contents: &str) {
        Self::write(&self.shipped().join(relative), contents);
    }

    fn write_overlay(&self, relative: &str, contents: &str) {
        Self::write(&self.overlay().join(relative), contents);
    }

    fn read_deployed(&self, relative: &str) -> String {
        std::fs::read_to_string(self.deployed().join(relative))
            .unwrap_or_else(|e| panic!("read {relative}: {e}"))
    }

    /// Points `promptwareOverlay` in `config.yaml` at `value`, as `tendril config set` would.
    fn set_config_overlay(&self, value: &str) {
        let path = self.home().join("config.yaml");
        let mut settings = load_config(&path).unwrap_or_default();
        settings.promptware_overlay = Some(value.to_string());
        save_config(&path, &settings).unwrap();
    }

    fn run(&self, args: &[&str]) -> Run {
        self.run_full(args, &[], None)
    }

    fn run_with_env(&self, args: &[&str], env: &[(&str, &str)]) -> Run {
        self.run_full(args, env, None)
    }

    fn run_with_stdin(&self, args: &[&str], stdin: &str) -> Run {
        self.run_full(args, &[], Some(stdin))
    }

    /// Runs `tendril --home <fixture home> <args>` with a fully pinned environment: the ambient
    /// `TENDRIL_*` variables on a developer machine point at a real V1 home, so they are all either
    /// removed or overridden here.
    fn run_full(&self, args: &[&str], env: &[(&str, &str)], stdin: Option<&str>) -> Run {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
        cmd.arg("--home")
            .arg(self.home())
            .args(args)
            .env("TENDRIL_PROMPTWARES", self.shipped())
            .env("TENDRIL_PLANS", self.home().join("Plans"))
            .env_remove("TENDRIL_CONFIG")
            .env_remove("TENDRIL_PROMPTWARE_OVERLAY")
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (key, value) in env {
            cmd.env(key, value);
        }

        let mut child = cmd.spawn().expect("spawn tendril");
        if let Some(text) = stdin {
            use std::io::Write;
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(text.as_bytes())
                .unwrap();
        }
        let out = child.wait_with_output().expect("run tendril");

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

// ---------------------------------------------------------------------------
// deploy
// ---------------------------------------------------------------------------

#[test]
fn deploy_copies_the_shipped_layer_and_stubs_the_rest() {
    let fx = Fixture::new("deploy");

    let run = fx.run(&["promptware", "deploy"]);
    run.ok();

    let lines = run.lines();
    assert_eq!(
        lines[0],
        format!("Promptwares deployed to {}", fx.deployed().display())
    );
    assert_eq!(lines[1], "");
    assert_eq!(
        lines[2], "Overlay: (none configured)",
        "no overlay is configured in this fixture"
    );
    assert_eq!(
        lines[3],
        format!(
            "Shipped: {} ({})",
            fx.shipped().display(),
            shipped_version()
        ),
        "the shipped root and the deploying build's version are both reported"
    );
    assert_eq!(lines[4], "");

    assert!(run.row("CreatePlan").contains("Program.md: shipped"));
    assert!(fx.deployed().join(".provenance.json").is_file());

    // The shipped file is copied verbatim, tools included.
    assert_eq!(
        fx.read_deployed("CreatePlan/Program.md"),
        "shipped create plan v1"
    );
    assert_eq!(
        fx.read_deployed("CreatePlan/Tools/Shipped-Tool.ps1"),
        "shipped tool"
    );

    // A standard promptware the shipped tree does not carry still gets a folder and a stub program.
    assert!(run.row("UpdateProject").contains("Program.md: stub"));
    assert!(fx
        .read_deployed("UpdateProject/Program.md")
        .starts_with("# UpdateProject"));
    assert!(fx.deployed().join("UpdateProject/Memory").is_dir());
    assert!(fx.deployed().join("UpdateProject/Tools").is_dir());

    // `Memory/` is never deployed, so a shipped placeholder cannot land in a live Memory folder.
    assert!(
        !fx.deployed().join("CreatePlan/Memory/.gitkeep").exists(),
        "a shipped Memory/ file must not be deployed"
    );
}

/// Deploy is an overlay, not a replace: everything the running installation authored under `Memory/`
/// and `Tools/` has to survive a redeploy while `Program.md` is refreshed from the layer.
#[test]
fn redeploy_refreshes_the_program_and_preserves_memory_and_tools() {
    let fx = Fixture::new("redeploy");
    fx.run(&["promptware", "deploy"]).ok();

    fx.run_with_stdin(
        &["promptware", "write-memory", "CreatePlan", "lesson.md"],
        "hard-won lesson",
    )
    .ok();
    fx.run_with_stdin(
        &[
            "promptware",
            "write-tool",
            "CreatePlan",
            "Agent-Written.ps1",
        ],
        "Write-Host agent",
    )
    .ok();

    // The shipped program moves on, and one shipped tool is dropped from the layer entirely.
    fx.write_shipped("CreatePlan/Program.md", "shipped create plan v2");
    std::fs::remove_file(fx.shipped().join("CreatePlan/Tools/Shipped-Tool.ps1")).unwrap();

    fx.run(&["promptware", "deploy"]).ok();

    assert_eq!(
        fx.read_deployed("CreatePlan/Program.md"),
        "shipped create plan v2",
        "Program.md is refreshed from the layer"
    );
    assert_eq!(
        fx.read_deployed("CreatePlan/Memory/lesson.md"),
        "hard-won lesson",
        "a memory file must survive a redeploy"
    );
    assert_eq!(
        fx.read_deployed("CreatePlan/Tools/Agent-Written.ps1"),
        "Write-Host agent",
        "an agent-written tool must survive a redeploy"
    );
    assert!(
        !fx.deployed()
            .join("CreatePlan/Tools/Shipped-Tool.ps1")
            .exists(),
        "a tool the layer stopped shipping is pruned, because a manifest recorded it"
    );

    // The memory is still listed after the redeploy, i.e. the round trip still works.
    let listed = fx.run(&["promptware", "list-memory", "CreatePlan"]);
    listed.ok();
    assert_eq!(listed.stdout, "lesson.md\n");
}

// ---------------------------------------------------------------------------
// overlay / layers
// ---------------------------------------------------------------------------

/// Lays down an overlay carrying its own `CreatePlan` plus an overlay-only promptware.
fn with_overlay(fx: &Fixture) {
    fx.write_overlay(".version", "1.2.3\n");
    fx.write_overlay("CreatePlan/Program.md", "overlay create plan");
    fx.write_overlay("CreatePlan/Tools/Overlay-Tool.ps1", "overlay tool");
    fx.write_overlay("TeamOnly/Program.md", "team only program");
    // No Program.md, so this is a scratch directory rather than a promptware.
    std::fs::create_dir_all(fx.overlay().join("Scratch")).unwrap();
}

#[test]
fn overlay_env_var_wins_per_file_and_layers_reports_provenance() {
    let fx = Fixture::new("overlay-env");
    with_overlay(&fx);

    let overlay = fx.overlay().to_string_lossy().to_string();
    let run = fx.run_with_env(
        &["promptware", "deploy"],
        &[("TENDRIL_PROMPTWARE_OVERLAY", &overlay)],
    );
    run.ok();

    let lines = run.lines();
    assert_eq!(
        lines[2],
        format!("Overlay: {} (.version 1.2.3)", fx.overlay().display()),
        "the overlay root and its .version are reported"
    );

    let create_plan = run.row("CreatePlan");
    assert!(
        create_plan.contains("Program.md: overlay"),
        "the overlay wins for Program.md: {create_plan}"
    );
    assert!(
        create_plan.contains("Tools: 1 overlay / 1 shipped"),
        "tools merge across layers: {create_plan}"
    );
    assert!(!create_plan.contains("overlay-only"));

    let team_only = run.row("TeamOnly");
    assert!(
        team_only.ends_with("(overlay-only)"),
        "a promptware only the overlay carries is flagged: {team_only}"
    );
    assert!(!run.stdout.contains("Scratch"), "{}", run.stdout);

    assert_eq!(
        fx.read_deployed("CreatePlan/Program.md"),
        "overlay create plan"
    );
    assert_eq!(
        fx.read_deployed("CreatePlan/Tools/Overlay-Tool.ps1"),
        "overlay tool"
    );
    assert_eq!(
        fx.read_deployed("CreatePlan/Tools/Shipped-Tool.ps1"),
        "shipped tool",
        "a shipped tool the overlay does not name stays in place"
    );
    assert_eq!(fx.read_deployed("TeamOnly/Program.md"), "team only program");

    // `layers` replays the recorded provenance, and narrows to one promptware on request.
    let narrowed = fx.run(&["promptware", "layers", "TeamOnly"]);
    narrowed.ok();
    let lines = narrowed.lines();
    assert_eq!(
        lines.len(),
        4,
        "two headers, a blank line and one row: {lines:?}"
    );
    assert!(lines[3].starts_with("TeamOnly"));
}

#[test]
fn overlay_comes_from_the_config_key_when_the_env_var_is_absent() {
    let fx = Fixture::new("overlay-config");
    with_overlay(&fx);
    fx.set_config_overlay(&fx.overlay().to_string_lossy());

    let run = fx.run(&["promptware", "deploy"]);
    run.ok();

    assert_eq!(
        run.lines()[2],
        format!("Overlay: {} (.version 1.2.3)", fx.overlay().display())
    );
    assert_eq!(
        fx.read_deployed("CreatePlan/Program.md"),
        "overlay create plan"
    );
}

#[test]
fn overlay_env_var_beats_the_config_key() {
    let fx = Fixture::new("overlay-precedence");
    with_overlay(&fx);

    let other = fx.root.join("other-overlay");
    Fixture::write(&other.join("CreatePlan/Program.md"), "other create plan");
    fx.set_config_overlay(&other.to_string_lossy());

    let overlay = fx.overlay().to_string_lossy().to_string();
    fx.run_with_env(
        &["promptware", "deploy"],
        &[("TENDRIL_PROMPTWARE_OVERLAY", &overlay)],
    )
    .ok();

    assert_eq!(
        fx.read_deployed("CreatePlan/Program.md"),
        "overlay create plan"
    );
}

/// A configured-but-missing overlay degrades to shipped-only rather than failing the deploy.
#[test]
fn a_missing_overlay_root_deploys_shipped_only() {
    let fx = Fixture::new("overlay-missing");
    fx.set_config_overlay(&fx.root.join("nope").to_string_lossy());

    let run = fx.run(&["promptware", "deploy"]);
    run.ok();

    assert_eq!(run.lines()[2], "Overlay: (none configured)");
    assert_eq!(
        fx.read_deployed("CreatePlan/Program.md"),
        "shipped create plan v1"
    );
}

#[test]
fn layers_before_any_deploy_says_so_instead_of_printing_an_empty_table() {
    let fx = Fixture::new("layers-empty");

    let run = fx.run(&["promptware", "layers"]);
    run.ok();

    assert_eq!(
        run.stdout,
        format!(
            "No promptware provenance recorded at {} — run 'tendril promptware deploy'.\n",
            fx.deployed().display()
        )
    );
}

#[test]
fn layers_narrowed_to_an_unknown_name_prints_only_the_headers() {
    let fx = Fixture::new("layers-unknown");
    fx.run(&["promptware", "deploy"]).ok();

    let run = fx.run(&["promptware", "layers", "NoSuchPromptware"]);
    run.ok();

    assert_eq!(run.lines().len(), 3, "{:?}", run.lines());
}

// ---------------------------------------------------------------------------
// memory round trips
// ---------------------------------------------------------------------------

#[test]
fn memory_round_trips_write_read_list_delete() {
    let fx = Fixture::new("memory-round-trip");
    fx.run(&["promptware", "deploy"]).ok();

    let written = fx.run_with_stdin(
        &["promptware", "write-memory", "CreatePlan", "first.md"],
        "the first lesson",
    );
    written.ok();
    assert_eq!(written.stdout, "Memory written.\n");

    fx.run_with_stdin(
        &["promptware", "write-memory", "CreatePlan", "second.md"],
        "the second lesson",
    )
    .ok();

    let listed = fx.run(&["promptware", "list-memory", "CreatePlan"]);
    listed.ok();
    assert_eq!(
        listed.stdout, "first.md\nsecond.md\n",
        "sorted, one per line"
    );

    // Reads batch, and each file is framed by a `## <filename>` heading.
    let read = fx.run(&[
        "promptware",
        "read-memory",
        "CreatePlan",
        "second.md",
        "first.md",
    ]);
    read.ok();
    assert_eq!(
        read.stdout, "## second.md\n\nthe second lesson\n\n## first.md\n\nthe first lesson\n\n",
        "files come back in the order asked for"
    );

    // A pruned memory reads as `(not found)` rather than failing, which is what the firmware tells
    // the agent to expect.
    let missing = fx.run(&["promptware", "read-memory", "CreatePlan", "gone.md"]);
    missing.ok();
    assert_eq!(missing.stdout, "## gone.md\n\n(not found)\n\n");

    let deleted = fx.run(&["promptware", "delete-memory", "CreatePlan", "first.md"]);
    deleted.ok();
    assert_eq!(deleted.stdout, "Memory deleted.\n");
    assert_eq!(
        fx.run(&["promptware", "list-memory", "CreatePlan"]).stdout,
        "second.md\n"
    );

    // Deleting twice is a no-op, not an error.
    fx.run(&["promptware", "delete-memory", "CreatePlan", "first.md"])
        .ok();
}

#[test]
fn write_memory_overwrites_an_existing_file() {
    let fx = Fixture::new("memory-overwrite");

    fx.run_with_stdin(
        &["promptware", "write-memory", "CreatePlan", "lesson.md"],
        "v1",
    )
    .ok();
    fx.run_with_stdin(
        &["promptware", "write-memory", "CreatePlan", "lesson.md"],
        "v2",
    )
    .ok();

    assert_eq!(fx.read_deployed("CreatePlan/Memory/lesson.md"), "v2");
}

#[test]
fn list_memory_for_a_promptware_with_no_memory_prints_nothing() {
    let fx = Fixture::new("memory-none");
    fx.run(&["promptware", "deploy"]).ok();

    let deployed = fx.run(&["promptware", "list-memory", "CreatePlan"]);
    deployed.ok();
    assert_eq!(deployed.stdout, "");

    // An unknown promptware is empty rather than an error: there is no directory to list.
    let unknown = fx.run(&["promptware", "list-memory", "NoSuchPromptware"]);
    unknown.ok();
    assert_eq!(unknown.stdout, "");
}

/// A filename with a path separator must be rejected. The agents pick these names themselves, so
/// `../../config.yaml` reaching `std::fs::write` would let a promptware write anywhere under home.
#[test]
fn memory_commands_reject_a_filename_that_would_escape_the_promptware_folder() {
    let fx = Fixture::new("memory-escape");
    fx.run(&["promptware", "deploy"]).ok();

    let escape = fx.home().join("escaped.md");

    for (args, stdin) in [
        (
            vec![
                "promptware",
                "write-memory",
                "CreatePlan",
                "../../escaped.md",
            ],
            Some("pwned"),
        ),
        (
            vec![
                "promptware",
                "write-memory",
                "CreatePlan",
                "nested/escaped.md",
            ],
            Some("pwned"),
        ),
        (
            vec!["promptware", "write-tool", "CreatePlan", "../../escaped.md"],
            Some("pwned"),
        ),
        (
            vec![
                "promptware",
                "delete-memory",
                "CreatePlan",
                "../../escaped.md",
            ],
            None,
        ),
        (
            vec![
                "promptware",
                "read-memory",
                "CreatePlan",
                "../../escaped.md",
            ],
            None,
        ),
        // The promptware name is part of the same path and is validated the same way.
        (
            vec!["promptware", "write-memory", "../..", "escaped.md"],
            Some("pwned"),
        ),
        (vec!["promptware", "list-memory", "../.."], None),
    ] {
        let run = match stdin {
            Some(text) => fx.run_with_stdin(&args, text),
            None => fx.run(&args),
        };
        assert_eq!(
            run.code,
            Some(1),
            "{args:?} must fail at runtime, not succeed\nstdout: {}",
            run.stdout
        );
        assert!(
            run.stderr.contains("must be a single file or folder name"),
            "{args:?} stderr: {}",
            run.stderr
        );
    }

    assert!(
        !escape.exists(),
        "nothing may be written outside the promptware's own directory"
    );
    assert!(
        !fx.deployed().join("escaped.md").exists(),
        "and nothing may be written outside the promptware's folder inside Promptwares either"
    );
}

// ---------------------------------------------------------------------------
// content input paths: --file, bare stdin, --stdin
// ---------------------------------------------------------------------------

#[test]
fn write_memory_and_write_tool_read_from_a_file() {
    let fx = Fixture::new("input-file");
    let source = fx.root.join("content.md");
    Fixture::write(&source, "content from a file");

    fx.run(&[
        "promptware",
        "write-memory",
        "CreatePlan",
        "lesson.md",
        "--file",
        source.to_str().unwrap(),
    ])
    .ok();
    let tool = fx.run(&[
        "promptware",
        "write-tool",
        "CreatePlan",
        "Tool.ps1",
        "--file",
        source.to_str().unwrap(),
    ]);
    tool.ok();
    assert_eq!(tool.stdout, "Tool written.\n");

    assert_eq!(
        fx.read_deployed("CreatePlan/Memory/lesson.md"),
        "content from a file"
    );
    assert_eq!(
        fx.read_deployed("CreatePlan/Tools/Tool.ps1"),
        "content from a file"
    );
}

#[test]
fn write_memory_with_a_missing_file_exits_one() {
    let fx = Fixture::new("input-file-missing");

    let run = fx.run(&[
        "promptware",
        "write-memory",
        "CreatePlan",
        "lesson.md",
        "--file",
        fx.root.join("nope.md").to_str().unwrap(),
    ]);

    assert_eq!(run.code, Some(1), "stdout: {}", run.stdout);
    assert!(!fx.deployed().join("CreatePlan/Memory/lesson.md").exists());
}

/// The firmware template tells agents to pipe a heredoc with no flag at all, so bare stdin is the
/// primary input path — including the empty-stdin case, which must not be an error.
#[test]
fn write_memory_reads_bare_stdin_including_empty_input() {
    let fx = Fixture::new("input-stdin");

    fx.run_with_stdin(
        &["promptware", "write-memory", "CreatePlan", "lesson.md"],
        "line one\nline two\n",
    )
    .ok();
    assert_eq!(
        fx.read_deployed("CreatePlan/Memory/lesson.md"),
        "line one\nline two\n"
    );

    fx.run_with_stdin(
        &["promptware", "write-memory", "CreatePlan", "empty.md"],
        "",
    )
    .ok();
    assert_eq!(fx.read_deployed("CreatePlan/Memory/empty.md"), "");
}

/// `agent_instructions.md` documents `--stdin` on `write-memory` and `write-tool`. It used to be a
/// clap exit-2 error, so an agent following its own instructions failed; the flag now exists and is
/// a no-op, because reading stdin is already the default.
#[test]
fn the_documented_stdin_flag_is_accepted_as_a_no_op() {
    let fx = Fixture::new("input-stdin-flag");

    fx.run_with_stdin(
        &[
            "promptware",
            "write-memory",
            "CreatePlan",
            "lesson.md",
            "--stdin",
        ],
        "from --stdin",
    )
    .ok();
    fx.run_with_stdin(
        &[
            "promptware",
            "write-tool",
            "CreatePlan",
            "Tool.ps1",
            "--stdin",
        ],
        "from --stdin",
    )
    .ok();

    assert_eq!(
        fx.read_deployed("CreatePlan/Memory/lesson.md"),
        "from --stdin"
    );
    assert_eq!(
        fx.read_deployed("CreatePlan/Tools/Tool.ps1"),
        "from --stdin"
    );
}

#[test]
fn file_and_stdin_together_are_a_usage_error() {
    let fx = Fixture::new("input-conflict");
    let source = fx.root.join("content.md");
    Fixture::write(&source, "content");

    let run = fx.run(&[
        "promptware",
        "write-memory",
        "CreatePlan",
        "lesson.md",
        "--file",
        source.to_str().unwrap(),
        "--stdin",
    ]);

    assert_eq!(
        run.code,
        Some(2),
        "asking for two different inputs is a clap error: {}{}",
        run.stdout,
        run.stderr
    );
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

#[test]
fn run_refuses_cleanly_when_the_promptware_folder_does_not_exist() {
    let fx = Fixture::new("run-missing");

    let run = fx.run(&["promptware", "run", "NoSuchPromptware", "--dry-run"]);

    assert_eq!(run.code, Some(1), "stdout: {}", run.stdout);
    assert!(
        run.stderr
            .contains("Promptware 'NoSuchPromptware' not found at")
            && run
                .stderr
                .contains(&fx.deployed().join("NoSuchPromptware").display().to_string()),
        "the error names the promptware and the path it looked in: {}",
        run.stderr
    );
    assert!(
        run.stdout.is_empty(),
        "no firmware is printed: {}",
        run.stdout
    );
}

/// `run` deploys lazily, so it works against a home that has never been deployed to.
#[test]
fn run_deploys_lazily_and_compiles_the_firmware_for_a_dry_run() {
    let fx = Fixture::new("run-dry");
    assert!(!fx.deployed().exists());

    let run = fx.run(&[
        "promptware",
        "run",
        "CreatePlan",
        "fix the flaky test",
        "--dry-run",
    ]);
    run.ok();

    assert!(
        run.stdout.contains("TaskDescription: fix the flaky test"),
        "the free-form args become TaskDescription: {}",
        run.stdout
    );
    assert!(
        run.stdout.contains("CurrentTime: "),
        "the compiler always stamps CurrentTime"
    );
    assert!(
        run.stdout.contains("shipped create plan v1"),
        "Program.md is inlined: {}",
        run.stdout
    );
    assert!(
        run.stdout.contains("- Shipped-Tool.ps1"),
        "the promptware's tools are listed: {}",
        run.stdout
    );
    assert!(run.stdout.contains("(no memory yet)"));
    assert!(fx.deployed().join("CreatePlan/Program.md").is_file());
}

#[test]
fn run_dry_run_carries_explicit_values_and_a_resolved_plan() {
    let fx = Fixture::new("run-values");
    let plan_folder = fx.home().join("Plans").join("00777-FixTheThing");
    std::fs::create_dir_all(&plan_folder).unwrap();

    let run = fx.run(&[
        "promptware",
        "run",
        "ExecutePlan",
        "--plan",
        "777",
        "--value",
        "Reviewer=rory",
        "--dry-run",
    ]);
    run.ok();

    assert!(
        run.stdout.contains("TendrilPlanId: 00777"),
        "{}",
        run.stdout
    );
    assert!(
        run.stdout
            .contains(&format!("TendrilPlanFolder: {}", plan_folder.display())),
        "{}",
        run.stdout
    );
    assert!(run.stdout.contains("Reviewer: rory"), "{}", run.stdout);
    // Nothing invents a TaskDescription when no free-form args were given.
    assert!(!run.stdout.contains("TaskDescription:"), "{}", run.stdout);
}

#[test]
fn run_prefers_an_explicit_promptware_path_and_falls_back_to_home() {
    let fx = Fixture::new("run-path");
    let custom = fx.root.join("custom-promptwares");
    Fixture::write(&custom.join("SideLoaded/Program.md"), "side-loaded program");

    let run = fx.run(&[
        "promptware",
        "run",
        "SideLoaded",
        "--promptware-path",
        custom.to_str().unwrap(),
        "--dry-run",
    ]);
    run.ok();
    assert!(run.stdout.contains("side-loaded program"), "{}", run.stdout);
    assert!(
        !fx.deployed().join("SideLoaded").exists(),
        "a side-loaded promptware is not copied into home"
    );

    // A name the custom path does not carry falls back to the deployed tree.
    let run = fx.run(&[
        "promptware",
        "run",
        "CreatePlan",
        "--promptware-path",
        custom.to_str().unwrap(),
        "--dry-run",
    ]);
    run.ok();
    assert!(
        run.stdout.contains("shipped create plan v1"),
        "{}",
        run.stdout
    );
}

#[test]
fn run_rejects_a_promptware_name_that_is_a_path() {
    let fx = Fixture::new("run-escape");

    let run = fx.run(&["promptware", "run", "../../etc", "--dry-run"]);

    assert_eq!(run.code, Some(1), "stdout: {}", run.stdout);
    assert!(
        run.stderr.contains("must be a single file or folder name"),
        "{}",
        run.stderr
    );
}

/// `--profile` is accepted and does not disturb the dry-run path. What it resolves to — a tier's
/// model and effort — is asserted in `commands::promptware`'s unit tests, because `--dry-run`
/// deliberately returns before any agent is resolved or launched.
#[test]
fn run_accepts_a_profile_and_an_agent_override() {
    let fx = Fixture::new("run-profile");
    fx.run(&["promptware", "deploy"]).ok();

    for profile in ["deep", "balanced", "quick"] {
        let run = fx.run(&[
            "promptware",
            "run",
            "CreatePlan",
            "--profile",
            profile,
            "--agent",
            "claude",
            "--dry-run",
        ]);
        run.ok();
        assert!(run.stdout.contains("shipped create plan v1"), "{profile}");
    }
}

// ---------------------------------------------------------------------------
// exit codes
// ---------------------------------------------------------------------------

#[test]
fn an_unknown_flag_is_a_clap_usage_error() {
    let fx = Fixture::new("exit-two");

    for args in [
        vec!["promptware", "deploy", "--bogus"],
        vec!["promptware", "list-memory", "CreatePlan", "--bogus"],
        vec!["promptware", "no-such-subcommand"],
        // `filename` is required.
        vec!["promptware", "write-memory", "CreatePlan"],
    ] {
        let run = fx.run(&args);
        assert_eq!(
            run.code,
            Some(2),
            "{args:?} must be a clap error\nstdout: {}\nstderr: {}",
            run.stdout,
            run.stderr
        );
    }
}

#[test]
fn promptware_help_lists_every_subcommand() {
    let fx = Fixture::new("help");

    let run = fx.run(&["promptware", "--help"]);
    run.ok();

    for sub in [
        "list-memory",
        "read-memory",
        "write-memory",
        "delete-memory",
        "write-tool",
        "deploy",
        "layers",
        "run",
    ] {
        assert!(run.stdout.contains(sub), "{sub} is missing from --help");
    }
}
