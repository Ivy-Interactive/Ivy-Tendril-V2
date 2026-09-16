//! The observable contract of the `tendril` commands whose output is machine-read: exact stdout,
//! exact exit code, and the stdout/stderr split.
//!
//! Everything here spawns the built binary (`env!("CARGO_BIN_EXE_tendril")`) rather than calling a
//! handler in-process, because the contract callers depend on *is* the process boundary: the bytes
//! on fd 1, the bytes on fd 2, and `$?`. An in-process test cannot see any of the three.
//!
//! Three consumers parse this output today and none of them can be fixed by a Tendril release:
//!   * the promptware corpus in `src/promptwares/*/Program.md`, which pipes stdout into `grep`/`wc`
//!     and chains commands with `&&`;
//!   * scripts such as `src/apps/tendril-app/scripts/migration/rehearse-cutover.ts`, which shells
//!     out to `tendril plan list` and treats non-empty stdout plus exit 0 as "the CLI can read this
//!     home";
//!   * the desktop app, which reads the JSON shapes.
//!
//! ## The exit-code rule this file establishes
//!
//! * **exit 2** — clap could not parse the command line (unknown subcommand, unknown flag, missing
//!   or malformed argument value). Nothing ran.
//! * **exit 1** — the command ran and failed. The message is on **stderr**, and stdout is empty, so
//!   a caller that captured stdout never mistakes an error for data.
//! * **exit 0** — success. Machine-readable output is on **stdout only**; diagnostics go to stderr.
//!
//! Two deliberate exceptions, pinned in `job_status_and_fail_warn_and_exit_zero_without_a_daemon`:
//! `job status` and `job fail` warn on stderr and still exit 0 when the daemon is unreachable.
//! They are progress telemetry, invoked inside `&&` chains all over the promptware corpus, and
//! telemetry must never abort an agent run.
//!
//! ## Isolation
//!
//! Every child gets an explicit `--home` under `std::env::temp_dir()`, and `TENDRIL_HOME`,
//! `TENDRIL_PLANS` and `TENDRIL_CONFIG` are removed from its environment. The developer's ambient
//! `TENDRIL_HOME` points at a real V1 home, so a test that forgot either half would read, and
//! `plan create`/`config set` would *write*, real data.

use std::path::{Path, PathBuf};
use std::process::Command;

use tendril_core::config::{get_config_path, load_config, save_config};
use tendril_core::models::{
    PlanStatus, PlanVerificationEntry, PlanYaml, ProjectConfig, ProjectVerificationRef,
    Recommendation, RepoRef, VerificationConfig, VerificationStatus,
};
use tendril_core::plans::writer::write_plan_yaml;
use tendril_core::plans::SUPPORTED_PLAN_FIELDS;

const PROJECT: &str = "ContractProject";

/// One completed `tendril` invocation.
struct Run {
    /// `None` only if the child was killed by a signal, which is itself a failure worth reporting.
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl Run {
    fn code(&self) -> i32 {
        self.code.expect("tendril exited via a signal, not a code")
    }

    /// stdout of a run that must have succeeded, with the failure's stderr in the panic message.
    fn ok(&self) -> &str {
        assert_eq!(
            self.code(),
            0,
            "expected exit 0, got {:?}. stderr: {}",
            self.code,
            self.stderr
        );
        &self.stdout
    }

    fn lines(&self) -> Vec<&str> {
        self.stdout.lines().collect()
    }
}

/// A throwaway Tendril home, removed on drop.
struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-cli-output-contract-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        // Belt and braces: `Drop` deletes this path recursively, so it must be under temp.
        assert!(home.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(home.join("Plans")).unwrap();
        Self { home }
    }

    fn plans_dir(&self) -> PathBuf {
        self.home.join("Plans")
    }

    fn run(&self, args: &[&str]) -> Run {
        self.run_with_env(args, &[])
    }

    /// Runs the CLI against this fixture's home. `TENDRIL_HOME`/`TENDRIL_PLANS`/`TENDRIL_CONFIG` are
    /// stripped from the child unless `env` puts one back, so an ambient value can never leak in.
    fn run_with_env(&self, args: &[&str], env: &[(&str, &str)]) -> Run {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
        cmd.arg("--home")
            .arg(&self.home)
            .args(args)
            .env_remove("TENDRIL_HOME")
            .env_remove("TENDRIL_PLANS")
            .env_remove("TENDRIL_CONFIG");
        for (k, v) in env {
            cmd.env(k, v);
        }
        let out = cmd
            .output()
            .unwrap_or_else(|e| panic!("run tendril {:?}: {}", args, e));

        Run {
            code: out.status.code(),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        }
    }

    /// Writes `config.yaml` with one project carrying `repos` and `verifications`, plus a matching
    /// verification definition for each name so `verification get` can find them too.
    fn write_project(&self, repos: &[&str], verifications: &[(&str, bool)]) {
        let path = get_config_path(&self.home);
        let mut settings = load_config(&path).unwrap();
        settings.projects.push(ProjectConfig {
            name: PROJECT.to_string(),
            color: "Blue".to_string(),
            repos: repos
                .iter()
                .map(|p| RepoRef {
                    path: p.to_string(),
                    base_branch: None,
                    extra: Default::default(),
                })
                .collect(),
            verifications: verifications
                .iter()
                .map(|(name, required)| ProjectVerificationRef {
                    name: name.to_string(),
                    required: *required,
                    extra: Default::default(),
                })
                .collect(),
            ..Default::default()
        });
        for (name, _) in verifications {
            settings.verifications.push(VerificationConfig {
                name: name.to_string(),
                prompt: format!("run {}", name.to_lowercase()),
            });
        }
        save_config(&path, &settings).unwrap();
    }

    /// Writes a plan folder directly, bypassing `plan create`, so a test can pin `plan get` against
    /// an exactly-known `plan.yaml` instead of whatever creation happens to seed.
    fn write_plan(&self, folder_name: &str, plan: PlanYaml) -> PathBuf {
        let folder = self.plans_dir().join(folder_name);
        std::fs::create_dir_all(&folder).unwrap();
        write_plan_yaml(&folder, &plan).unwrap();
        folder
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn verification(name: &str, status: VerificationStatus) -> PlanVerificationEntry {
    PlanVerificationEntry {
        name: name.to_string(),
        status,
    }
}

fn recommendation(title: &str, state: &str) -> Recommendation {
    Recommendation {
        title: title.to_string(),
        description: String::new(),
        state: state.to_string(),
        decline_reason: None,
        notes: None,
        impact: None,
    }
}

/// A plan with every list field populated, so one fixture covers all seven list renderings.
fn fully_populated_plan() -> PlanYaml {
    PlanYaml {
        state: PlanStatus::Executing.to_string(),
        project: PROJECT.to_string(),
        level: "Feature".to_string(),
        title: "Contract Plan".to_string(),
        repos: vec!["/tmp/repo-one".to_string(), "/tmp/repo-two".to_string()],
        prs: vec![
            "https://github.com/o/r/pull/1".to_string(),
            "https://github.com/o/r/pull/2".to_string(),
        ],
        commits: vec!["abc1234".to_string(), "def5678".to_string()],
        verifications: vec![
            verification("Build", VerificationStatus::Pending),
            verification("Lint", VerificationStatus::Fail),
            verification("Docs", VerificationStatus::Skipped),
        ],
        depends_on: vec!["00042".to_string(), "00043".to_string()],
        related_plans: vec!["00044".to_string()],
        recommendations: Some(vec![
            recommendation("Extract the parser", "Pending"),
            recommendation("Delete the shim", "Accepted"),
        ]),
        priority: 7,
        partial_delivery: true,
        execution_profile: Some("deep".to_string()),
        initial_prompt: Some("Fix the thing".to_string()),
        source_url: Some("https://github.com/o/r/issues/9".to_string()),
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// The exit-code rule
// ---------------------------------------------------------------------------

/// A command line clap cannot parse is exit **2**, and nothing ran. A wrapper that maps "non-zero"
/// onto "the operation failed" would otherwise retry a command that never started; `job start`
/// documents exactly that hazard, so the two classes have to stay distinguishable.
#[test]
fn a_malformed_command_line_is_clap_exit_2() {
    let fixture = Fixture::new("clap-exit-2");

    let cases: &[&[&str]] = &[
        // Unknown subcommand, at the top level and inside a group.
        &["bogus-command"],
        &["plan", "bogus-command"],
        // Unknown flag.
        &["plan", "list", "--not-a-flag"],
        &["version", "--not-a-flag"],
        // Missing required positional.
        &["plan", "get"],
        &["plan", "set", "00001", "title"],
        &["config", "get"],
        // Malformed value for a typed flag.
        &["plan", "list", "--limit", "not-a-number"],
        &["serve", "--port", "not-a-number"],
    ];

    for args in cases {
        let run = fixture.run(args);
        assert_eq!(
            run.code(),
            2,
            "tendril {:?} should be a clap usage error (exit 2), got {:?}. stdout: {} stderr: {}",
            args,
            run.code,
            run.stdout,
            run.stderr
        );
        assert!(
            run.stdout.is_empty(),
            "a usage error must not put anything on stdout: {:?} -> {}",
            args,
            run.stdout
        );
        assert!(
            run.stderr.contains("error:"),
            "a usage error is reported on stderr: {:?} -> {}",
            args,
            run.stderr
        );
    }

    // No subcommand at all is also a usage error, not a silent success.
    let bare = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .env_remove("TENDRIL_HOME")
        .output()
        .expect("run tendril");
    assert_eq!(bare.status.code(), Some(2));
}

/// A command that ran and failed is exit **1**, message on stderr, **nothing** on stdout. A caller
/// doing `TITLE=$(tendril plan get 42 title)` must get an empty variable on failure, never the
/// error text.
#[test]
fn a_runtime_failure_is_exit_1_with_the_message_on_stderr() {
    let fixture = Fixture::new("runtime-exit-1");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true)]);
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    // (args, a distinctive fragment of the expected stderr message)
    let cases: &[(&[&str], &str)] = &[
        (&["plan", "get", "99999", "title"], "Plan not found"),
        (&["plan", "get", "00001", "bogusField"], "Unknown field"),
        (&["plan", "set", "99999", "title", "x"], "Plan not found"),
        (
            &["plan", "set", "00001", "state", "Nonsense"],
            "Invalid state",
        ),
        (&["project", "get", "NoSuchProject"], "not found"),
        (&["verification", "get", "NoSuchVerification"], "not found"),
        (&["config", "get", "noSuchKey"], "Unknown config key"),
        (&["config", "get", "projects"], "structured config key"),
        // The daemon-required job verbs. `status`/`fail` are the two exceptions and are pinned
        // separately; every other job verb must fail loudly rather than pretend it worked.
        (&["job", "list"], "No Tendril server is running"),
        (
            &["job", "cancel", "some-job"],
            "No Tendril server is running",
        ),
        (
            &["job", "delete", "some-job"],
            "No Tendril server is running",
        ),
    ];

    for (args, fragment) in cases {
        let run = fixture.run(args);
        assert_eq!(
            run.code(),
            1,
            "tendril {:?} should be a runtime failure (exit 1), got {:?}. stderr: {}",
            args,
            run.code,
            run.stderr
        );
        assert!(
            run.stdout.is_empty(),
            "an error must not go to stdout: {:?} -> {:?}",
            args,
            run.stdout
        );
        assert!(
            run.stderr.contains(fragment),
            "tendril {:?} stderr should mention {:?}, got: {}",
            args,
            fragment,
            run.stderr
        );
    }
}

/// The stdout/stderr split for the read-only commands scripts capture. Anything on stderr here would
/// end up inside `$(...)` for a caller using `2>&1`, and anything diagnostic on stdout would end up
/// inside the value.
#[test]
fn read_commands_write_nothing_to_stderr() {
    let fixture = Fixture::new("clean-stderr");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true)]);
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    let cases: &[&[&str]] = &[
        &["version"],
        &["plan", "list"],
        &["plan", "list", "--format", "ids"],
        &["plan", "list", "--format", "folders"],
        &["plan", "list", "--format", "json"],
        &["plan", "get", "00001"],
        &["plan", "get", "00001", "title"],
        &["plan", "get", "00001", "verifications"],
        &["project", "list"],
        &["project", "get", PROJECT],
        &["verification", "list"],
        &["verification", "list", "--json"],
        &["verification", "get", "Build"],
        &["config", "get", "codingAgent"],
    ];

    for args in cases {
        let run = fixture.run(args);
        assert_eq!(run.code(), 0, "tendril {:?}: {}", args, run.stderr);
        assert!(
            run.stderr.is_empty(),
            "tendril {:?} wrote to stderr: {}",
            args,
            run.stderr
        );
    }
}

/// `--home` wins over the ambient `TENDRIL_HOME`. This is not theoretical: the variable is set to a
/// real V1 home on developer machines, so a regression here means the test suite starts reading —
/// and `plan create` starts writing into — the developer's live plans.
#[test]
fn the_home_flag_beats_the_ambient_tendril_home_env_var() {
    let fixture = Fixture::new("home-precedence");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true)]);

    let decoy = std::env::temp_dir().join(format!(
        "tendril-cli-output-contract-decoy-{}",
        uuid::Uuid::new_v4().simple()
    ));

    // `doctor`'s exit code depends on what is installed on this machine (see
    // `doctor_reports_on_stdout_and_exits_1_only_when_a_check_fails`), so only stdout is read here.
    let run = fixture.run_with_env(&["doctor"], &[("TENDRIL_HOME", decoy.to_str().unwrap())]);
    let first_check = run
        .stdout
        .lines()
        .find(|l| l.contains("Tendril Home:"))
        .expect("doctor reports the home it resolved")
        .to_string();
    assert!(
        first_check.contains(fixture.home.to_str().unwrap()),
        "--home must win over TENDRIL_HOME, got: {}",
        first_check
    );
    assert!(
        !decoy.exists(),
        "the decoy home from TENDRIL_HOME must never be touched"
    );

    // `project list` reads config.yaml, and the decoy has none: if the env var won, this would be
    // empty rather than naming the fixture's project.
    let run = fixture.run_with_env(
        &["project", "list"],
        &[("TENDRIL_HOME", decoy.to_str().unwrap())],
    );
    assert_eq!(run.ok(), format!("{}\n", PROJECT));
}

// ---------------------------------------------------------------------------
// `plan get <id> <field>`
// ---------------------------------------------------------------------------

/// Every field in `SUPPORTED_PLAN_FIELDS` resolves on a populated plan: exit 0, a value on stdout.
/// The loop is over the constant itself, so adding a field to `fields.rs` without teaching the CLI
/// to serve it fails here.
///
/// Consumers: `UpdatePlan/Program.md:20` (`title`), `RetryPlan/Program.md:86` (`commits`),
/// `CreatePlan/Program.md:128-129` (`verifications`, `partialDelivery`).
#[test]
fn plan_get_resolves_every_supported_field() {
    let fixture = Fixture::new("get-every-field");
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    for field in SUPPORTED_PLAN_FIELDS {
        let run = fixture.run(&["plan", "get", "00001", field]);
        assert_eq!(
            run.code(),
            0,
            "plan get 00001 {} should succeed, stderr: {}",
            field,
            run.stderr
        );
        assert!(
            !run.stdout.trim().is_empty(),
            "field {} rendered nothing on a fully populated plan",
            field
        );
        // Case-insensitive, because the promptwares and the HTTP `?field=` callers disagree on case.
        let lowered = fixture.run(&["plan", "get", "00001", &field.to_ascii_lowercase()]);
        assert_eq!(
            lowered.stdout, run.stdout,
            "field lookup must be case-insensitive: {}",
            field
        );
    }
}

/// The exact scalar renderings. `id` is zero-stripped (`1`, not `00001`) while the folder name and
/// `plan list --format ids` are zero-padded — a difference a caller building a folder path from
/// `plan get <id> id` has to know about, so it is pinned rather than left to chance.
#[test]
fn plan_get_scalar_field_renderings() {
    let fixture = Fixture::new("get-scalars");
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    let get = |field: &str| fixture.run(&["plan", "get", "00001", field]).stdout;

    assert_eq!(
        get("id"),
        "1\n",
        "`id` is the bare integer, not zero-padded"
    );
    assert_eq!(get("title"), "Contract Plan\n");
    assert_eq!(get("state"), "Executing\n");
    assert_eq!(get("project"), format!("{}\n", PROJECT));
    assert_eq!(get("level"), "Feature\n");
    assert_eq!(get("executionProfile"), "deep\n");
    assert_eq!(get("initialPrompt"), "Fix the thing\n");
    assert_eq!(get("sourceUrl"), "https://github.com/o/r/issues/9\n");
    assert_eq!(get("priority"), "7\n");
    // `CreatePlan/Program.md:129` tests this string: it must be `true`/`false`, not `True`/`yes`/`1`.
    assert_eq!(get("partialDelivery"), "true\n");

    // Timestamps are RFC 3339, so `date -d` and every language's parser accept them.
    for field in ["created", "updated"] {
        let value = get(field);
        chrono::DateTime::parse_from_rfc3339(value.trim())
            .unwrap_or_else(|e| panic!("`{}` must be RFC 3339, got {:?}: {}", field, value, e));
    }
}

/// The seven list fields: one item per line, no header, no separator, no index. `plan get <id>
/// verifications | grep -i "=Fail"` (CreatePlan/Program.md:128) and `wc -l` on the same output only
/// work if each item owns exactly one line.
///
/// `verifications` is `Name=Status` and `recommendations` is `Title=State`; the other five are bare
/// values. `CreatePr/Program.md:347` documents the `Name=Status` form verbatim.
#[test]
fn plan_get_list_fields_render_one_item_per_line() {
    let fixture = Fixture::new("get-lists");
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    let get = |field: &str| fixture.run(&["plan", "get", "00001", field]).stdout;

    assert_eq!(get("repos"), "/tmp/repo-one\n/tmp/repo-two\n");
    assert_eq!(
        get("prs"),
        "https://github.com/o/r/pull/1\nhttps://github.com/o/r/pull/2\n"
    );
    assert_eq!(get("commits"), "abc1234\ndef5678\n");
    assert_eq!(get("dependsOn"), "00042\n00043\n");
    assert_eq!(get("relatedPlans"), "00044\n");

    // `Name=Status`, in the plan's configured order, one gate per line.
    assert_eq!(
        get("verifications"),
        "Build=Pending\nLint=Fail\nDocs=Skipped\n"
    );
    // The `grep -i "=Fail"` gate CreatePr relies on has to find exactly the one failing line.
    let rendered = get("verifications");
    let failing: Vec<&str> = rendered.lines().filter(|l| l.ends_with("=Fail")).collect();
    assert_eq!(failing, vec!["Lint=Fail"]);

    // `Title=State`. Titles may contain spaces, so `=` is the separator, not whitespace.
    assert_eq!(
        get("recommendations"),
        "Extract the parser=Pending\nDelete the shim=Accepted\n"
    );
}

/// The distinction the whole field contract exists for: an **empty list** is empty stdout with exit
/// **0**, an **unknown field** is exit **1** naming the valid fields.
///
/// Before this was fixed both were a blank line and exit 0, which meant a completion gate could read
/// "no failing verifications" out of a field name it had simply failed to understand.
#[test]
fn plan_get_separates_an_empty_list_from_an_unknown_field() {
    let fixture = Fixture::new("get-empty-vs-unknown");
    // Every list field left at its default: empty.
    fixture.write_plan(
        "00001-BarePlan",
        PlanYaml {
            title: "Bare Plan".to_string(),
            project: PROJECT.to_string(),
            ..Default::default()
        },
    );

    for field in [
        "repos",
        "prs",
        "commits",
        "verifications",
        "dependsOn",
        "relatedPlans",
        "recommendations",
    ] {
        let run = fixture.run(&["plan", "get", "00001", field]);
        assert_eq!(
            run.code(),
            0,
            "an empty {} is not an error, stderr: {}",
            field,
            run.stderr
        );
        // `println!("{}", "")` — one newline, zero lines. `wc -l` reads 1, but `grep -c .` and
        // "is the output empty" both read zero items, which is what the callers ask.
        assert_eq!(run.stdout, "\n", "an empty {} is an empty string", field);
        assert_eq!(run.stdout.trim(), "");
        assert!(run.stderr.is_empty());
    }

    // A typo — including the near-misses a caller is most likely to make.
    for field in ["verification", "Verifications ", "repo", "bogusField", "pr"] {
        let run = fixture.run(&["plan", "get", "00001", field]);
        assert_eq!(
            run.code(),
            1,
            "unknown field {:?} must be an error, stdout: {:?}",
            field,
            run.stdout
        );
        assert!(
            run.stdout.is_empty(),
            "an unknown field writes nothing to stdout: {:?}",
            run.stdout
        );
        assert!(
            run.stderr.contains(&format!("Unknown field '{}'", field)),
            "stderr must name the field it rejected: {}",
            run.stderr
        );
        // The remedy is in the message, so an agent can correct itself without reading the source.
        for valid in SUPPORTED_PLAN_FIELDS {
            assert!(
                run.stderr.contains(valid),
                "the valid-field list must include {}: {}",
                valid,
                run.stderr
            );
        }
    }

    // DIVERGENCE (reported, not fixed here): `allocatedPorts` is a working field —
    // `src/crates/tendril-cli/src/commands/plan.rs:933-943` special-cases it ahead of the
    // `SUPPORTED_PLAN_FIELDS` lookup, and `plan_env_cli_test.rs` pins its output — but it is absent
    // from `SUPPORTED_PLAN_FIELDS` (`src/crates/tendril-core/src/plans/fields.rs:8-29`), so the
    // error message above tells the caller a supported field is not valid. The field itself works;
    // only the advertised list is wrong.
    assert!(
        fixture
            .run(&["plan", "get", "00001", "allocatedPorts"])
            .code()
            == 0,
        "allocatedPorts works despite being missing from the advertised list"
    );
    assert!(
        !SUPPORTED_PLAN_FIELDS
            .iter()
            .any(|f| f.eq_ignore_ascii_case("allocatedPorts")),
        "if allocatedPorts has been added to SUPPORTED_PLAN_FIELDS, drop this note"
    );
}

/// `plan get <id>` with no field is the plan's `plan.yaml`, and it must round-trip through a YAML
/// parser: `SplitPlan/Program.md:20` reads the whole document this way.
#[test]
fn plan_get_without_a_field_is_yaml_that_round_trips() {
    let fixture = Fixture::new("get-whole-yaml");
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    let run = fixture.run(&["plan", "get", "00001"]);
    let stdout = run.ok();

    let parsed: PlanYaml = serde_yaml::from_str(stdout).expect("stdout parses as a PlanYaml");
    assert_eq!(parsed.title, "Contract Plan");
    assert_eq!(parsed.state, "Executing");
    assert_eq!(parsed.repos, vec!["/tmp/repo-one", "/tmp/repo-two"]);
    assert_eq!(parsed.verifications.len(), 3);
    assert_eq!(parsed.priority, 7);
    assert!(parsed.partial_delivery);

    // It is the raw file, not a re-serialization, so a hand-edited plan comes back byte-identical
    // apart from the trailing newline `println!` adds.
    let on_disk =
        std::fs::read_to_string(fixture.plans_dir().join("00001-ContractPlan/plan.yaml")).unwrap();
    assert_eq!(
        stdout,
        format!("{}\n", on_disk.trim_end_matches('\n')) + "\n",
        "stdout is plan.yaml verbatim plus the one newline println adds"
    );

    // Generic YAML too, not just our own struct: the promptwares use whatever parser their agent has.
    let generic: serde_yaml::Value = serde_yaml::from_str(stdout).expect("valid YAML");
    assert!(generic.get("title").is_some());
}

// ---------------------------------------------------------------------------
// `plan create`
// ---------------------------------------------------------------------------

/// The `PlanId:` / `Directory:` / `Verifications:` block. `CreatePlan/Program.md:323` forbids
/// reporting any plan id that did not come from this stdout, so the three labels, their order and
/// the zero-padded id are all load-bearing.
///
/// `Verifications:` is populated from the project, not from `--verification`:
/// `CreatePlan/Program.md:269` promises required → `Pending` and optional → `Skipped`, in the
/// project's configured order, and tells the agent it need not pass `--verification` at all.
#[test]
fn plan_create_prints_the_id_directory_and_seeded_verifications() {
    let fixture = Fixture::new("create-block");
    fixture.write_project(
        &["/tmp/contract-repo-a", "/tmp/contract-repo-b"],
        &[("Build", true), ("Docs", false), ("Lint", true)],
    );

    let run = fixture.run(&[
        "plan",
        "create",
        "Contract Plan",
        PROJECT,
        "--no-duplicate-check",
    ]);
    let lines = {
        let _ = run.ok();
        run.lines()
    };

    assert_eq!(lines[0], "PlanId: 00001", "zero-padded to five digits");
    assert_eq!(
        lines[1],
        format!(
            "Directory: {}",
            fixture.plans_dir().join("00001-ContractPlan").display()
        ),
        "an absolute path to the created folder, so the agent can cd into it"
    );
    assert_eq!(lines[2], "Verifications:");
    // `Name:Status` here — note the colon. `plan get <id> verifications` uses `=`. The two forms
    // differ, and both are V1's, so a caller cannot reuse one parser for both.
    assert_eq!(lines[3], "Build:Pending", "required seeds Pending");
    assert_eq!(lines[4], "Docs:Skipped", "optional seeds Skipped");
    assert_eq!(lines[5], "Lint:Pending");
    assert_eq!(
        lines.len(),
        6,
        "no trailing output with --no-duplicate-check: {:?}",
        lines
    );

    // The seeding is real, not just printed: the plan inherits the project's repos too.
    assert_eq!(
        fixture.run(&["plan", "get", "00001", "repos"]).stdout,
        "/tmp/contract-repo-a\n/tmp/contract-repo-b\n"
    );
    assert_eq!(
        fixture
            .run(&["plan", "get", "00001", "verifications"])
            .stdout,
        "Build=Pending\nDocs=Skipped\nLint=Pending\n"
    );
}

/// `--verification Name=Status` overrides the seeded status without dropping the rest of the set,
/// and an override for a verification the project does not configure is appended.
#[test]
fn plan_create_verification_overrides_keep_the_seeded_set() {
    let fixture = Fixture::new("create-overrides");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true), ("Docs", false)]);

    let run = fixture.run(&[
        "plan",
        "create",
        "Override Plan",
        PROJECT,
        "--no-duplicate-check",
        "--verification",
        "Docs=Pending",
        "--verification",
        "Extra=Skipped",
    ]);
    let _ = run.ok();

    assert_eq!(
        run.lines()[3..],
        ["Build:Pending", "Docs:Pending", "Extra:Skipped"],
        "overrides re-status the project's set in order, then append the unknown one"
    );
}

/// A project with no repos is refused: exit 1, message on stderr, and — critically — **no plan
/// folder and no consumed plan id**. `ExecutePlan` can make no worktree for a repo-less plan, so
/// creating one just burns an id and strands the agent.
#[test]
fn plan_create_refuses_a_project_with_no_repos() {
    let fixture = Fixture::new("create-no-repos");
    fixture.write_project(&[], &[("Build", true)]);

    let run = fixture.run(&["plan", "create", "Doomed Plan", PROJECT]);
    assert_eq!(run.code(), 1);
    assert!(run.stdout.is_empty(), "no PlanId: line: {:?}", run.stdout);
    assert!(
        run.stderr
            .contains(&format!("Project '{}' has no repos configured.", PROJECT)),
        "stderr names the project: {}",
        run.stderr
    );
    assert_eq!(
        std::fs::read_dir(fixture.plans_dir()).unwrap().count(),
        0,
        "a refused create leaves no plan folder behind"
    );

    // An unknown project is the same class of failure.
    let run = fixture.run(&["plan", "create", "Doomed Plan", "NoSuchProject"]);
    assert_eq!(run.code(), 1);
    assert!(run.stdout.is_empty());
    assert!(run.stderr.contains("Project 'NoSuchProject' not found."));
}

/// The `DuplicateCandidates:` block, which `CreatePlan/Program.md:100` parses as
/// `folderName|title|state` per line. It comes after the verification lines, and `--no-duplicate-
/// check` suppresses it entirely.
#[test]
fn plan_create_appends_the_duplicate_candidates_block() {
    let fixture = Fixture::new("create-duplicates");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true)]);

    fixture
        .run(&[
            "plan",
            "create",
            "Fix The Widget Renderer",
            PROJECT,
            "--no-duplicate-check",
        ])
        .ok();

    let run = fixture.run(&["plan", "create", "Fix The Widget Renderer", PROJECT]);
    let lines = {
        let _ = run.ok();
        run.lines()
    };

    let header = lines
        .iter()
        .position(|l| *l == "DuplicateCandidates:")
        .unwrap_or_else(|| panic!("expected a DuplicateCandidates: block, got {:?}", lines));
    assert!(
        header > 2,
        "the block comes after the PlanId/Directory/Verifications lines: {:?}",
        lines
    );
    let entry = lines[header + 1];
    let parts: Vec<&str> = entry.split('|').collect();
    assert_eq!(
        parts.len(),
        3,
        "each candidate is folderName|title|state: {:?}",
        entry
    );
    assert_eq!(parts[0], "00001-FixTheWidgetRenderer");
    assert_eq!(parts[1], "Fix The Widget Renderer");
    assert_eq!(parts[2], "Draft");
}

// ---------------------------------------------------------------------------
// `plan set`
// ---------------------------------------------------------------------------

/// `Set <field> = <value>` — the **value written**, not the plan's title. An agent reads this line
/// back to confirm its own write, and it used to be told "Updated state to 'My Plan Title'".
#[test]
fn plan_set_prints_the_field_and_the_value_written() {
    let fixture = Fixture::new("set-echo");
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    let cases: &[(&str, &str)] = &[
        ("title", "A New Title"),
        ("state", "Completed"),
        ("level", "Bug"),
        ("project", "OtherProject"),
        ("executionProfile", "quick"),
        ("initialPrompt", "do the thing"),
        ("sourceUrl", "https://example.com/1"),
        ("priority", "3"),
    ];

    for (field, value) in cases {
        // `state Completed` on a plan with a failing gate needs the override; the guard's warning
        // goes to stderr, which is exactly the split being pinned.
        let run = fixture.run(&[
            "plan",
            "set",
            "00001",
            field,
            value,
            "--allow-failed-verifications",
        ]);
        assert_eq!(run.code(), 0, "plan set {}: {}", field, run.stderr);
        assert_eq!(
            run.stdout,
            format!("Set {} = {}\n", field, value),
            "the echo is `Set <field> = <value>`, verbatim what was asked for"
        );
    }

    // And the writes actually landed, so the echo is not a lie.
    assert_eq!(
        fixture.run(&["plan", "get", "00001", "title"]).stdout,
        "A New Title\n"
    );
    assert_eq!(
        fixture.run(&["plan", "get", "00001", "priority"]).stdout,
        "3\n"
    );

    // The field name is echoed as the caller spelled it, not canonicalised.
    let run = fixture.run(&["plan", "set", "00001", "TITLE", "Shouty"]);
    assert_eq!(run.ok(), "Set TITLE = Shouty\n");
}

/// Issue #133: a `plan set` that cannot write is exit 1 on stderr, and leaves `plan.yaml` untouched.
///
/// The `if/else if` chain over field names had no final `else` and the priority arm was
/// `if let Ok(p) = value.parse()` with no error branch, so `plan set 1 titel "X"` and
/// `plan set 1 priority abc` both printed `Set <field> = <value>`, bumped `updated`, rewrote
/// `plan.yaml` and re-synced the database while writing nothing the caller asked for.
///
/// This replaces `plan_set_silently_accepts_a_field_it_cannot_write_today`, which pinned that.
#[test]
fn plan_set_rejects_a_field_it_cannot_write() {
    let fixture = Fixture::new("set-unknown-field");
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());
    let plan_yaml = fixture.plans_dir().join("00001-ContractPlan/plan.yaml");
    let before = std::fs::read_to_string(&plan_yaml).unwrap();

    // (args, a fragment of the expected stderr)
    let cases: &[(&[&str], &str)] = &[
        // A typo.
        (
            &["plan", "set", "00001", "bogusField", "hello"],
            "Unknown field 'bogusField'",
        ),
        // A near-miss on a real field.
        (
            &["plan", "set", "00001", "titel", "A New Title"],
            "Unknown field 'titel'",
        ),
        // Readable but not settable: the list fields have their own add-*/remove-* verbs, and
        // `created`/`updated`/`id` are not the caller's to set.
        (
            &["plan", "set", "00001", "repos", "/tmp/elsewhere"],
            "Unknown field 'repos'",
        ),
        (
            &["plan", "set", "00001", "created", "2020-01-01T00:00:00Z"],
            "Unknown field 'created'",
        ),
        // A value the field cannot hold.
        (
            &["plan", "set", "00001", "priority", "not-a-number"],
            "Invalid priority 'not-a-number'",
        ),
        (
            &["plan", "set", "00001", "state", "Nonsense"],
            "Invalid state: Nonsense",
        ),
    ];

    for (args, fragment) in cases {
        let run = fixture.run(args);
        assert_eq!(
            run.code(),
            1,
            "{:?} must fail rather than report a write it did not make. stdout: {:?}",
            args,
            run.stdout
        );
        assert!(
            run.stdout.is_empty(),
            "{:?} must not print a `Set ...` line: {:?}",
            args,
            run.stdout
        );
        assert!(
            run.stderr.contains(fragment),
            "{:?} stderr must contain {:?}, got: {}",
            args,
            fragment,
            run.stderr
        );
    }

    // The remedy is in the message: an agent can correct itself without reading the source.
    let run = fixture.run(&["plan", "set", "00001", "bogusField", "hello"]);
    for settable in [
        "state",
        "title",
        "level",
        "project",
        "executionProfile",
        "initialPrompt",
        "sourceUrl",
        "priority",
    ] {
        assert!(
            run.stderr.contains(settable),
            "the settable-field list must include {}: {}",
            settable,
            run.stderr
        );
    }

    // Nothing was written: not the field, not `updated`, not a database re-sync.
    assert_eq!(
        std::fs::read_to_string(&plan_yaml).unwrap(),
        before,
        "a rejected `plan set` must leave plan.yaml byte-identical"
    );
    assert_eq!(
        fixture.run(&["plan", "get", "00001", "priority"]).stdout,
        "7\n",
        "the old priority survives a rejected write"
    );
    assert_eq!(
        fixture.run(&["plan", "get", "00001", "title"]).stdout,
        "Contract Plan\n"
    );
}

// ---------------------------------------------------------------------------
// `plan list`
// ---------------------------------------------------------------------------

/// The default table: a header, a rule, then one row per plan. Column **order** and the separators
/// are the contract; the exact padding is not, so this asserts on the whitespace-split tokens.
///
/// `src/apps/tendril-app/scripts/migration/rehearse-cutover.ts:228` treats non-empty stdout plus
/// exit 0 as "the CLI can read this home", which is why the header prints even with no plans.
#[test]
fn plan_list_table_column_order() {
    let fixture = Fixture::new("list-table");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true)]);
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    let run = fixture.run(&["plan", "list"]);
    let lines = {
        let _ = run.ok();
        run.lines()
    };

    assert_eq!(
        lines[0].split_whitespace().collect::<Vec<_>>(),
        ["ID", "STATE", "LEVEL", "PROJECT", "TITLE"],
        "column order, left to right"
    );
    assert_eq!(lines[1], "-".repeat(70), "a 70-dash rule under the header");
    // The row's first four columns are single tokens; TITLE is the free-text remainder.
    let row: Vec<&str> = lines[2].split_whitespace().collect();
    assert_eq!(&row[..4], &["00001", "Executing", "Feature", PROJECT]);
    assert!(
        lines[2].trim_end().ends_with("Contract Plan"),
        "the title is last and unquoted: {:?}",
        lines[2]
    );
    assert_eq!(lines.len(), 3, "header, rule, one row: {:?}", lines);
}

/// `ids` and `folders` are one bare value per line: no header, no rule, no padding, nothing to
/// strip. They exist so `for id in $(tendril plan list --format ids)` works.
#[test]
fn plan_list_ids_and_folders_are_one_bare_value_per_line() {
    let fixture = Fixture::new("list-ids-folders");
    fixture.write_plan("00001-First", fully_populated_plan());
    fixture.write_plan(
        "00002-Second",
        PlanYaml {
            title: "Second".to_string(),
            project: PROJECT.to_string(),
            ..Default::default()
        },
    );

    // Newest first, matching the table and the desktop app's ordering.
    let ids = fixture.run(&["plan", "list", "--format", "ids"]);
    assert_eq!(
        ids.ok(),
        "00002\n00001\n",
        "zero-padded ids, newest first, nothing else"
    );

    let folders = fixture.run(&["plan", "list", "--format", "folders"]);
    assert_eq!(
        folders.ok(),
        "00002-Second\n00001-First\n",
        "folder *names*, not paths"
    );

    // The format name is case-insensitive, so `--format IDS` is not a silent fall-through to the
    // table (which is what an unknown format does — see the divergence test below).
    assert_eq!(
        fixture.run(&["plan", "list", "--format", "IDS"]).ok(),
        ids.stdout
    );

    // `--limit` truncates from the top of that ordering.
    assert_eq!(
        fixture
            .run(&["plan", "list", "--format", "ids", "--limit", "1"])
            .ok(),
        "00002\n"
    );
}

/// `--format json` is a JSON array, pretty-printed, one object per plan, and it parses. The desktop
/// app and any `jq` caller depend on the top level being an array even for one plan.
#[test]
fn plan_list_json_is_a_parseable_array_of_plans() {
    let fixture = Fixture::new("list-json");
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    let run = fixture.run(&["plan", "list", "--format", "json"]);
    let doc: serde_json::Value = serde_json::from_str(run.ok()).expect("stdout is JSON");
    let arr = doc.as_array().expect("the top level is an array");
    assert_eq!(arr.len(), 1);

    // The keys a caller selects on. `folder_path`/`folder_name` are snake_case here, unlike the
    // HTTP API's camelCase — same data, different casing, so a shared client cannot reuse a model.
    let plan = &arr[0];
    assert_eq!(plan["metadata"]["id"], 1);
    assert_eq!(plan["metadata"]["title"], "Contract Plan");
    assert_eq!(plan["metadata"]["state"], "Executing");
    assert_eq!(plan["metadata"]["project"], PROJECT);
    assert_eq!(plan["folder_name"], "00001-ContractPlan");
    assert_eq!(
        plan["folder_path"],
        fixture
            .plans_dir()
            .join("00001-ContractPlan")
            .to_str()
            .unwrap()
    );
    // `yaml_raw` carries the full plan, which is how a caller gets the list fields the metadata
    // omits on this path (see plan_list_json_metadata_child_lists_are_empty_on_the_db_path).
    assert!(plan["yaml_raw"]
        .as_str()
        .expect("yaml_raw is a string")
        .contains("title: Contract Plan"));
}

/// SUSPECTED BUG — pinned as today's behaviour.
///
/// On the database-backed path `plan list --format json` returns `metadata.repos`,
/// `metadata.prs`, `metadata.commits` and `metadata.verifications` as **empty arrays**, even though
/// `yaml_raw` in the same object has them. `src/crates/tendril-core/src/db/plans.rs:384-404`
/// deliberately leaves those child relations for `get_plan_by_id` to load, but `plan list` exposes
/// the half-filled struct straight to a caller.
///
/// The disk fallback path (`--plans-dir`, or a home with no `tendril.db`) fills them in, so the same
/// command emits two different JSON shapes depending on whether the database exists. A caller that
/// developed against one gets silently wrong answers on the other.
#[test]
fn plan_list_json_metadata_child_lists_are_empty_on_the_db_path() {
    let fixture = Fixture::new("list-json-children");
    fixture.write_project(
        &["/tmp/contract-repo-a", "/tmp/contract-repo-b"],
        &[("Build", true)],
    );
    // `plan create` is what populates `tendril.db`, so this goes through the CLI rather than
    // `write_plan`: a plan on disk with no database row would be listed from disk instead.
    fixture
        .run(&[
            "plan",
            "create",
            "Contract Plan",
            PROJECT,
            "--no-duplicate-check",
        ])
        .ok();
    fixture
        .run(&["plan", "add-pr", "00001", "https://github.com/o/r/pull/1"])
        .ok();

    let run = fixture.run(&["plan", "list", "--format", "json"]);
    let doc: serde_json::Value = serde_json::from_str(run.ok()).unwrap();
    let metadata = &doc[0]["metadata"];
    for key in ["repos", "prs", "commits", "verifications"] {
        // EXPECTED: the same values `plan get <id> <key>` returns.
        assert_eq!(
            metadata[key].as_array().map(|a| a.len()),
            Some(0),
            "today the db path leaves metadata.{} empty",
            key
        );
    }
    // Proof it is the db path that drops them: the disk path does not.
    let disk = fixture.run(&[
        "plan",
        "list",
        "--format",
        "json",
        "--plans-dir",
        fixture.plans_dir().to_str().unwrap(),
    ]);
    let doc: serde_json::Value = serde_json::from_str(disk.ok()).unwrap();
    assert_eq!(
        doc[0]["metadata"]["repos"].as_array().map(|a| a.len()),
        Some(2),
        "the disk path fills the same field in"
    );
}

/// KNOWN BUG, ignored rather than pinned: `plan list --has-pr` matches nothing whenever
/// `tendril.db` exists, because it filters on `metadata.prs`, which the database path always leaves
/// empty (`src/crates/tendril-core/src/db/plans.rs:392`). The filter works only on the disk path.
///
/// Un-ignore this once `--has-pr` filters on data that path actually loads.
#[test]
#[ignore = "known bug: --has-pr filters on metadata.prs, which the db listing path never populates"]
fn plan_list_has_pr_filters_on_the_database_path() {
    let fixture = Fixture::new("list-has-pr");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true)]);
    for title in ["With Pr", "Without Pr"] {
        fixture
            .run(&["plan", "create", title, PROJECT, "--no-duplicate-check"])
            .ok();
    }
    fixture
        .run(&["plan", "add-pr", "00001", "https://github.com/o/r/pull/1"])
        .ok();

    // Sanity: the PR is on the plan, so only the filter is in question.
    assert_eq!(
        fixture.run(&["plan", "get", "00001", "prs"]).ok(),
        "https://github.com/o/r/pull/1\n"
    );
    // Today: empty on the db path, `00001` via `--plans-dir`.
    let run = fixture.run(&["plan", "list", "--format", "ids", "--has-pr"]);
    assert_eq!(run.ok(), "00001\n");
}

/// Issue #135, same defect class as the dropped `--state` filter: an unknown `--format` used to fall
/// through to the default table and exit 0, so a script that typo'd `--format id` got a padded table
/// it would happily mis-parse as data. It is now exit 1 naming the four valid formats.
///
/// This replaces `plan_list_an_unknown_format_falls_back_to_the_table_today`.
#[test]
fn plan_list_rejects_an_unknown_format() {
    let fixture = Fixture::new("list-bad-format");
    fixture.write_plan("00001-ContractPlan", fully_populated_plan());

    for bogus in ["id", "folder", "yaml", "csv", ""] {
        let run = fixture.run(&["plan", "list", "--format", bogus]);
        assert_eq!(
            run.code(),
            1,
            "an unknown --format {:?} must be an error, stdout: {:?}",
            bogus,
            run.stdout
        );
        assert!(
            run.stdout.is_empty(),
            "a rejected --format must print no table: {:?}",
            run.stdout
        );
        assert!(
            run.stderr.contains(&format!("Unknown format '{}'", bogus)),
            "stderr must name the format it rejected: {}",
            run.stderr
        );
        for valid in ["table", "ids", "folders", "json"] {
            assert!(
                run.stderr.contains(valid),
                "the valid-format list must include {}: {}",
                valid,
                run.stderr
            );
        }
    }

    // The four that are valid still work, in either case.
    for good in ["table", "ids", "folders", "json", "IDS", "JSON"] {
        assert_eq!(
            fixture.run(&["plan", "list", "--format", good]).code(),
            0,
            "--format {} must still be accepted",
            good
        );
    }
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

/// Empty is not an error, and it is not a placeholder line either. A caller counting lines has to
/// get zero, so "No plans found."-style prose would break `wc -l`.
///
/// The one exception is the default `plan list` table, which still prints its header and rule — the
/// migration rehearsal script depends on non-empty stdout meaning "readable home".
#[test]
fn empty_states_are_empty_stdout_with_exit_0() {
    // A pristine home: no config.yaml, no plans, no database.
    let fixture = Fixture::new("empty-states");

    let empty: &[&[&str]] = &[
        &["plan", "list", "--format", "ids"],
        &["plan", "list", "--format", "folders"],
        &["project", "list"],
        &["verification", "list"],
    ];
    for args in empty {
        let run = fixture.run(args);
        assert_eq!(run.code(), 0, "tendril {:?}: {}", args, run.stderr);
        assert_eq!(
            run.stdout, "",
            "tendril {:?} must print nothing at all when empty",
            args
        );
        assert!(run.stderr.is_empty(), "tendril {:?}: {}", args, run.stderr);
    }

    // The JSON forms are an empty array, never `null` and never nothing.
    for args in [
        &["plan", "list", "--format", "json"][..],
        &["verification", "list", "--json"][..],
    ] {
        let run = fixture.run(args);
        assert_eq!(run.ok(), "[]\n", "tendril {:?}", args);
    }

    // The table keeps its header and rule.
    let run = fixture.run(&["plan", "list"]);
    let lines = {
        let _ = run.ok();
        run.lines()
    };
    assert_eq!(
        lines[0].split_whitespace().collect::<Vec<_>>(),
        ["ID", "STATE", "LEVEL", "PROJECT", "TITLE"]
    );
    assert_eq!(lines.len(), 2, "header and rule only: {:?}", lines);

    // A project with nothing configured still prints its four labels, so a parser keyed on
    // `Repos:`/`Verifications:` does not have to handle their absence.
    fixture.write_project(&[], &[]);
    let run = fixture.run(&["project", "get", PROJECT]);
    assert_eq!(
        run.ok(),
        format!(
            "Project: {}\nColor: Blue\nRepos:\nVerifications:\n",
            PROJECT
        )
    );
}

// ---------------------------------------------------------------------------
// `verification`, `project`, `config`, `version`, `doctor`
// ---------------------------------------------------------------------------

/// `verification list` is one bare name per line; `verification get` is `Name:` then `Prompt:` with
/// the prompt starting on the following line, so a multi-line prompt survives.
///
/// Consumers: `AddProject/Program.md` and `SetupProject/Program.md` (`verification list`),
/// `CreatePlan`/`CreatePr`/`ExecutePlan`/`RetryPlan` (`verification get <name>`, to read the gate's
/// prompt before running it).
#[test]
fn verification_list_and_get_output_shape() {
    let fixture = Fixture::new("verification-shape");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true), ("Lint", false)]);

    assert_eq!(
        fixture.run(&["verification", "list"]).ok(),
        "Build\nLint\n",
        "one bare name per line, in config order"
    );

    let run = fixture.run(&["verification", "get", "Build"]);
    assert_eq!(
        run.ok(),
        "Name: Build\nPrompt:\nrun build\n",
        "`Prompt:` is a label on its own line; the body follows it"
    );

    // Lookup is case-insensitive but the *stored* name is echoed, so a caller can normalise.
    let run = fixture.run(&["verification", "get", "bUiLd"]);
    assert_eq!(run.ok(), "Name: Build\nPrompt:\nrun build\n");

    // A multi-line prompt is emitted verbatim, not folded or quoted.
    fixture
        .run(&[
            "verification",
            "set",
            "Lint",
            "--prompt",
            "line one\nline two",
        ])
        .ok();
    let run = fixture.run(&["verification", "get", "Lint"]);
    assert_eq!(run.ok(), "Name: Lint\nPrompt:\nline one\nline two\n");

    // `--json` is the full definition set, parseable.
    let run = fixture.run(&["verification", "list", "--json"]);
    let doc: serde_json::Value = serde_json::from_str(run.ok()).unwrap();
    assert_eq!(doc[0]["name"], "Build");
    assert_eq!(doc[0]["prompt"], "run build");
}

/// `project list` is one bare name per line; `project get` is a labelled block whose list sections
/// are `  - ` bullets. `AddProject/Program.md` and `SetupProject/Program.md` read both.
#[test]
fn project_list_and_get_output_shape() {
    let fixture = Fixture::new("project-shape");
    fixture.write_project(
        &["/tmp/contract-repo-a", "/tmp/contract-repo-b"],
        &[("Build", true), ("Docs", false)],
    );

    assert_eq!(
        fixture.run(&["project", "list"]).ok(),
        format!("{}\n", PROJECT)
    );

    let run = fixture.run(&["project", "get", PROJECT]);
    assert_eq!(
        run.ok(),
        format!(
            "Project: {}\n\
             Color: Blue\n\
             Repos:\n\
             \x20 - /tmp/contract-repo-a\n\
             \x20 - /tmp/contract-repo-b\n\
             Verifications:\n\
             \x20 - Build (required: true)\n\
             \x20 - Docs (required: false)\n",
            PROJECT
        ),
        "labels, then two-space `- ` bullets; `required:` is the literal bool"
    );

    // Lookup is case-insensitive, and the stored name is echoed back.
    let run = fixture.run(&["project", "get", &PROJECT.to_lowercase()]);
    assert!(run.ok().starts_with(&format!("Project: {}\n", PROJECT)));
}

/// `config get <key>` is the bare value on one line — no key, no quotes — because the promptwares
/// and the app substitute it straight into a path or a command. An unset optional key is an empty
/// line, not the word `null`.
#[test]
fn config_get_prints_the_bare_value() {
    let fixture = Fixture::new("config-get");

    // A default home, so these are the shipped defaults rather than an operator's edits.
    let agent = fixture.run(&["config", "get", "codingAgent"]);
    let agent = agent.ok();
    assert!(
        !agent.trim().is_empty() && agent.ends_with('\n') && agent.lines().count() == 1,
        "one unquoted line: {:?}",
        agent
    );
    assert!(!agent.contains("codingAgent"), "the key is not echoed");

    // Numbers are bare digits, booleans are `true`/`false`.
    assert!(fixture
        .run(&["config", "get", "jobTimeout"])
        .ok()
        .trim()
        .parse::<i64>()
        .is_ok());
    assert!(["true\n", "false\n"].contains(&fixture.run(&["config", "get", "beta"]).ok()));

    // An unset `Option<String>` is an empty line: a caller's `[ -z "$v" ]` test has to work.
    assert_eq!(fixture.run(&["config", "get", "planFolder"]).ok(), "\n");

    // Keys are case-insensitive; a `config set` round-trips through `config get`.
    fixture.run(&["config", "set", "theme", "dark"]).ok();
    assert_eq!(fixture.run(&["config", "get", "THEME"]).ok(), "dark\n");
    assert_eq!(
        fixture.run(&["config", "set", "theme", "light"]).ok(),
        "Config updated.\n",
        "`config set` confirms on stdout without echoing the value"
    );
}

/// `version` is exactly one line, `tendril v<semver>`. The updater and the extension parse it, so
/// the `v` prefix and the absence of any second line both matter.
#[test]
fn version_is_one_line_with_a_v_prefixed_semver() {
    let fixture = Fixture::new("version");

    let run = fixture.run(&["version"]);
    let stdout = run.ok();
    assert_eq!(stdout.lines().count(), 1, "one line only: {:?}", stdout);
    let rest = stdout
        .trim_end()
        .strip_prefix("tendril v")
        .unwrap_or_else(|| panic!("expected `tendril v<version>`, got {:?}", stdout));
    assert_eq!(
        rest.split('.').count(),
        3,
        "a three-part version: {:?}",
        rest
    );
    assert!(rest
        .split('.')
        .all(|p| p.chars().next().is_some_and(|c| c.is_ascii_digit())));
    assert!(run.stderr.is_empty());

    // `--version` is clap's own, and also exit 0 with one line.
    let run = fixture.run(&["--version"]);
    assert_eq!(run.ok().lines().count(), 1);
}

/// `doctor` reports on **stdout** in full and exits **1** if and only if some line is `[FAIL]`
/// (issue #136) — a report a CI job or wrapper can gate on. A `[WARN]` is not a failure: a fresh
/// install legitimately warns, so the exit code would otherwise be useless.
///
/// Only the shape is pinned: the individual checks probe git, `gh`, the installed coding agent and
/// the model catalogue, so which lines are OK, WARN or FAIL is machine-dependent — which is why the
/// exit code is asserted *against the report* rather than against a constant.
///
/// This replaces `doctor_reports_on_stdout_and_always_exits_0`.
#[test]
fn doctor_reports_on_stdout_and_exits_1_only_when_a_check_fails() {
    let fixture = Fixture::new("doctor");
    fixture.write_project(&["/tmp/contract-repo"], &[("Build", true)]);

    for run in [
        fixture.run(&["doctor"]),
        Fixture::new("doctor-bare").run(&["doctor"]),
    ] {
        let lines: Vec<&str> = run.stdout.lines().collect();

        assert_eq!(lines[0], "Checking Tendril system health...");
        assert!(lines.len() > 5, "doctor ran no checks: {:?}", lines);
        for line in &lines[1..] {
            assert!(
                line.starts_with("[OK] ")
                    || line.starts_with("[WARN] ")
                    || line.starts_with("[FAIL] "),
                "untagged doctor line: {:?}",
                line
            );
        }
        assert!(
            lines.iter().any(|l| l.contains("Tendril Home:")),
            "doctor names the home it inspected: {:?}",
            lines
        );

        let failed = lines.iter().any(|l| l.starts_with("[FAIL] "));
        assert_eq!(
            run.code(),
            i32::from(failed),
            "exit code must be exactly \"is there a [FAIL] line\". stderr: {}\nstdout:\n{}",
            run.stderr,
            run.stdout
        );
        if failed {
            assert!(
                run.stderr.contains("health check(s) failed"),
                "the failure summary belongs on stderr: {}",
                run.stderr
            );
        } else {
            assert!(run.stderr.is_empty(), "stderr: {}", run.stderr);
        }
    }
}

// ---------------------------------------------------------------------------
// The two deliberate exit-0-on-failure exceptions
// ---------------------------------------------------------------------------

/// `job status` and `job fail` warn on **stderr** and exit **0** when the daemon is unreachable.
///
/// This is deliberate, not a bug. They are the two most-invoked commands in the promptware corpus
/// (`ExecutePlan`, `CreatePlan`, `CreatePr`, `CreateIssue`, `SyncRepo`, ... all call them, usually
/// inside an `&&` chain), and they are pure progress telemetry. A daemon blip must not abort the
/// agent's step. `fail` matters most: it runs on the failure path, so a non-zero exit there would
/// kill the job mid-report.
///
/// Note the asymmetry with `job list`/`cancel`/`delete`, which exit 1 on the same unreachable
/// daemon — those change state or return data the caller needs, so they must fail loudly.
#[test]
fn job_status_and_fail_warn_and_exit_zero_without_a_daemon() {
    // No `.master` file, so the daemon is definitively unreachable.
    let fixture = Fixture::new("job-telemetry");
    assert!(!fixture.home.join(".master").exists());

    let cases: &[(&[&str], &str)] = &[
        (
            &["job", "status", "job-abc", "--message", "step 1 of 3"],
            "could not report status for job job-abc",
        ),
        (
            &["job", "fail", "job-abc", "--message", "the build broke"],
            "could not report failure for job job-abc",
        ),
    ];

    for (args, fragment) in cases {
        let run = fixture.run(args);
        assert_eq!(
            run.code(),
            0,
            "tendril {:?} must exit 0 so an `&&` chain survives an offline daemon; stderr: {}",
            args,
            run.stderr
        );
        assert_eq!(
            run.stdout, "",
            "the failed report writes nothing to stdout: {:?}",
            args
        );
        assert!(
            run.stderr.starts_with("Warning: "),
            "the warning is on stderr and is labelled a warning: {:?}",
            run.stderr
        );
        assert!(
            run.stderr.contains(fragment),
            "the warning names the job and what it could not do: {}",
            run.stderr
        );
        assert_eq!(
            run.stderr.lines().count(),
            1,
            "one warning line: {:?}",
            run.stderr
        );
    }

    // `job status --plan-id` is how CreatePlan reports the id it just created; still exit 0.
    let run = fixture.run(&[
        "job",
        "status",
        "job-abc",
        "--message",
        "created",
        "--plan-id",
        "00001",
    ]);
    assert_eq!(run.code(), 0);
}

/// `job list` against a real daemon with no jobs: the header and rule print, and `--json` is `[]`.
/// The desktop app polls the JSON form and the promptware corpus reads the table, so "no jobs" has
/// to be structurally identical to "some jobs", minus the rows.
///
/// This is the only test here that stands a daemon up. It binds port 0 so nothing is fixed, and the
/// `.master` file lives inside the fixture's temp home.
#[tokio::test(flavor = "multi_thread")]
async fn job_list_empty_state_against_a_running_daemon() {
    let fixture = Fixture::new("job-list-empty");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let secret = tendril_core::config::generate_bearer_secret();
    let guard = tendril_core::config::MasterGuard::acquire(
        &fixture.home,
        port,
        &secret,
        "127.0.0.1",
        "http",
    )
    .unwrap();

    let state = std::sync::Arc::new(tendril_server::AppState::with_plans_dir(
        fixture.home.clone(),
        fixture.plans_dir(),
        secret,
    ));
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let _guard = guard;
        let _ = axum::serve(listener, tendril_server::create_router(state))
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    let run = tokio::task::block_in_place(|| fixture.run(&["job", "list"]));
    let lines = {
        let _ = run.ok();
        run.lines()
    };
    assert_eq!(
        lines[0].split_whitespace().collect::<Vec<_>>(),
        ["ID", "TYPE", "STATUS", "PROJECT", "PLAN", "/", "ARGS"],
        "column order, left to right; the last column is labelled `PLAN / ARGS`"
    );
    assert_eq!(lines[1], "-".repeat(75), "a 75-dash rule under the header");
    assert_eq!(lines.len(), 2, "header and rule only: {:?}", lines);

    let run = tokio::task::block_in_place(|| fixture.run(&["job", "list", "--json"]));
    assert_eq!(run.ok(), "[]\n", "never `null`, never empty output");

    let _ = shutdown_tx.send(());
    let _ = server.await;
}

// ---------------------------------------------------------------------------
// `--help`
// ---------------------------------------------------------------------------

/// `--help` exits 0 on stdout at the top level and for every subcommand group, and each group's
/// help lists its own subcommands. `src/crates/tendril-core/src/agents/agent_instructions.md` is the
/// only description of the CLI a chat agent gets; `--help` is its fallback when a command surprises
/// it, so it has to be reachable and non-empty everywhere.
#[test]
fn help_exits_0_and_lists_the_subcommands() {
    let fixture = Fixture::new("help");

    // (group, one subcommand it must list)
    let groups: &[(&str, &str)] = &[
        ("plan", "create"),
        ("job", "status"),
        ("chat", "list"),
        ("project", "add-repo"),
        ("vault", "status"),
        ("verification", "get"),
        ("promptware", "list-memory"),
        ("config", "get"),
        ("db", "migrate"),
    ];

    let top = fixture.run(&["--help"]);
    let top_stdout = top.ok();
    assert!(top.stderr.is_empty(), "help goes to stdout, not stderr");
    assert!(top_stdout.contains("Usage: tendril"));
    for (group, _) in groups {
        assert!(
            top_stdout.contains(group),
            "the top-level help omits the `{}` group",
            group
        );
    }
    for solo in ["doctor", "version", "models", "run", "mcp", "report-bug"] {
        assert!(
            top_stdout.contains(solo),
            "the top-level help omits `{}`",
            solo
        );
    }
    assert!(
        top_stdout.contains("--home"),
        "the top-level help documents --home, the only global flag"
    );

    for (group, subcommand) in groups {
        for flag in ["--help", "-h"] {
            let run = fixture.run(&[group, flag]);
            let stdout = run.ok();
            assert!(
                run.stderr.is_empty(),
                "`{} {}` wrote to stderr: {}",
                group,
                flag,
                run.stderr
            );
            assert!(
                stdout.contains(&format!("Usage: tendril {}", group)),
                "`{} {}` should name its own usage line: {}",
                group,
                flag,
                stdout
            );
            assert!(
                stdout.contains("Commands:"),
                "`{} {}` should list its subcommands: {}",
                group,
                flag,
                stdout
            );
            assert!(
                stdout.contains(subcommand),
                "`{} {}` omits the `{}` subcommand",
                group,
                flag,
                subcommand
            );
        }
    }

    // A leaf command's help works too, and documents its flags rather than its subcommands.
    let run = fixture.run(&["plan", "create", "--help"]);
    let stdout = run.ok();
    assert!(stdout.contains("--verification"));
    assert!(stdout.contains("--no-duplicate-check"));
}

/// `help <group>` is the same document as `<group> --help`, so an agent that guesses either form
/// gets the same answer.
#[test]
fn the_help_subcommand_matches_the_help_flag() {
    let fixture = Fixture::new("help-subcommand");
    for group in ["plan", "job", "project", "verification", "config"] {
        let via_flag = fixture.run(&[group, "--help"]);
        let via_help = fixture.run(&["help", group]);
        assert_eq!(via_help.ok(), via_flag.ok(), "help {} diverged", group);
    }
}

// ---------------------------------------------------------------------------
// A dummy path assertion, kept last: nothing above may reach a real home.
// ---------------------------------------------------------------------------

/// Every fixture in this file lives under the system temp directory, and none of them is the
/// operator's real Tendril home. `tendril_core::config::real_user_tendril_home` resolves that home
/// as if `TENDRIL_HOME` were unset, which is exactly the path a `--home` regression would reach.
#[test]
fn no_fixture_can_collide_with_the_real_tendril_home() {
    let real = tendril_core::config::real_user_tendril_home();
    let fixture = Fixture::new("isolation");
    assert!(fixture.home.starts_with(std::env::temp_dir()));
    assert_ne!(fixture.home, real);
    assert!(
        !real.starts_with(std::env::temp_dir()),
        "a real home under temp would make this file's isolation check vacuous: {}",
        real.display()
    );
    let _: &Path = fixture.home.as_path();
}
