//! `tendril report-bug` end-to-end, through the real binary.
//!
//! The safety property is the thing being pinned: **nothing leaves the machine unless both `--submit`
//! and `--yes` are given**, because submitting attaches the whole bundle to a public GitHub issue.
//! Every test here therefore asserts the *absence* of an upload as carefully as the presence of a zip.
//!
//! Two belts, so a regression cannot pass quietly:
//!
//! * the child's stdout must not contain the "Uploading bug report..." line, and
//! * the child is run with its HTTP proxy environment pointed at a closed local port, so an upload
//!   attempted anyway would fail fast against loopback and turn the exit code non-zero instead of
//!   reaching the network. Nothing in this file can contact GitHub, and no test ever passes both
//!   flags.
//!
//! `report-bug` also runs the health checks to build `doctor.txt`, and one of those shells out to `gh
//! auth status`, which validates the token online. The child gets an empty `GH_CONFIG_DIR` and no
//! `GH_TOKEN`, so that check fails locally without a request.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// A closed port on loopback. Any HTTP attempt through the proxy environment dies here.
const DEAD_PROXY: &str = "http://127.0.0.1:1";

/// Planted secrets, one per shape the redactor knows, placed in `config.yaml`. None of these may
/// appear anywhere in the zip.
const PLANTED: [(&str, &str); 5] = [
    ("anthropic", "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF"),
    ("openai", "sk-abcdefghijklmnopqrstuvwx"),
    ("github", "ghp_A1b2C3d4E5f6G7h8I9j0"),
    (
        "bearer",
        "1cde84b8345d87525d884ff2175ea8d9fe561ca857c81be07a9d23747d419dc3",
    ),
    ("aws", "AKIAIOSFODNN7EXAMPLE"),
];

/// A password that looks like an ordinary word: no shape pass can catch it, only the key-name pass.
const PLANTED_PASSWORD: &str = "wintergreen-cathedral";

struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-cli-report-bug-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(home.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(home.join("Plans")).unwrap();
        std::fs::create_dir_all(home.join("Logs").join("Jobs")).unwrap();
        std::fs::create_dir_all(home.join("gh-config")).unwrap();
        Self { home }
    }

    fn plans_dir(&self) -> PathBuf {
        self.home.join("Plans")
    }

    /// A `config.yaml` carrying every planted secret, under both obvious and innocuous key names.
    fn write_config_with_secrets(&self) {
        let config = format!(
            "codingAgent: claude\n\
             auth:\n  \
               username: admin\n  \
               password: '{password}'\n  \
               hashSecret: 'cGVwcGVycGVwcGVycGVwcGVycGVwcGVy'\n\
             llm:\n  apiKey: '{anthropic}'\n\
             api:\n  apiKey: '{openai}'\n  bearerSecret: '{bearer}'\n\
             codingAgents:\n  \
               - id: claude\n    \
                   environmentVariables:\n      \
                     ANTHROPIC_API_KEY: '{anthropic}'\n\
             notes: 'a key pasted into a comment: {github}'\n\
             harmlessLookingKey: '{aws}'\n",
            password = PLANTED_PASSWORD,
            anthropic = PLANTED[0].1,
            openai = PLANTED[1].1,
            github = PLANTED[2].1,
            bearer = PLANTED[3].1,
            aws = PLANTED[4].1,
        );
        std::fs::write(self.home.join("config.yaml"), config).unwrap();
    }

    /// A plan folder, as `resolve_plan_folder` expects to find one.
    fn write_plan(&self, folder_name: &str) -> PathBuf {
        let folder = self.plans_dir().join(folder_name);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("plan.yaml"),
            "metadata:\n  id: 577\nstate: Executing\n",
        )
        .unwrap();
        folder
    }

    /// A job log for `job_id`, in the directory jobs write to.
    fn write_job_log(&self, file_name: &str, body: &str) {
        std::fs::write(self.home.join("Logs").join("Jobs").join(file_name), body).unwrap();
    }

    /// Runs `tendril --home <home> report-bug <args...>` with stdin closed and no route off the
    /// machine.
    fn run(&self, args: &[&str]) -> (bool, String, String) {
        let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
            .arg("--home")
            .arg(&self.home)
            .arg("report-bug")
            .args(args)
            .env_remove("TENDRIL_HOME")
            .env_remove("TENDRIL_PLANS")
            .env_remove("TENDRIL_CONFIG")
            // Any HTTP request, from this command or from `gh`, hits a closed loopback port.
            .env("HTTP_PROXY", DEAD_PROXY)
            .env("HTTPS_PROXY", DEAD_PROXY)
            .env("ALL_PROXY", DEAD_PROXY)
            .env("http_proxy", DEAD_PROXY)
            .env("https_proxy", DEAD_PROXY)
            // So the `gh auth status` health check answers from disk instead of the API.
            .env("GH_CONFIG_DIR", self.home.join("gh-config"))
            .env_remove("GH_TOKEN")
            .env_remove("GITHUB_TOKEN")
            .env_remove("GH_ENTERPRISE_TOKEN")
            .env_remove("GITHUB_ENTERPRISE_TOKEN")
            // Not a terminal and immediately at EOF, so the stdin description path is deterministic.
            .stdin(Stdio::null())
            .output()
            .expect("run tendril report-bug");

        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        )
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// Asserts stdout shows no sign of an upload having been started.
fn assert_nothing_was_uploaded(stdout: &str) {
    for forbidden in [
        "Uploading bug report",
        "Bug report submitted successfully",
        "issueUrl",
        "github.com/",
    ] {
        assert!(
            !stdout.contains(forbidden),
            "stdout suggests an upload happened ({}): {}",
            forbidden,
            stdout
        );
    }
}

/// Every entry name in a zip.
fn zip_entries(path: &Path) -> Vec<String> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).expect("open the zip"))
        .expect("the report is a readable zip");
    (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect()
}

/// Every entry's bytes, keyed by name.
fn zip_contents(path: &Path) -> Vec<(String, String)> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).expect("open the zip"))
        .expect("the report is a readable zip");
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let name = entry.name().to_string();
        let mut body = String::new();
        // A non-text entry cannot hide a planted secret, which is ASCII.
        let _ = entry.read_to_string(&mut body);
        out.push((name, body));
    }
    out
}

/// The default: a zip on disk, nothing sent, exit 0. This is what a user gets when they follow the
/// instructions in the docs and attach the file to an issue by hand.
#[test]
fn the_default_writes_a_local_zip_and_uploads_nothing() {
    let fixture = Fixture::new("default");
    fixture.write_config_with_secrets();
    fixture.write_plan("00577-PortSomething");

    let (ok, stdout, stderr) = fixture.run(&["--plan", "00577"]);
    assert!(ok, "report-bug failed: {}{}", stdout, stderr);

    assert!(
        stdout.contains("Local report only. Add --submit --yes to upload it."),
        "the default has to say it went nowhere: {}",
        stdout
    );
    assert_nothing_was_uploaded(&stdout);
    assert!(
        !stdout.contains("public GitHub issue"),
        "the public-issue warning belongs to --submit, not to a local report: {}",
        stdout
    );

    // The zip lands under the home with a timestamped name.
    let zips: Vec<PathBuf> = std::fs::read_dir(&fixture.home)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "zip"))
        .collect();
    assert_eq!(zips.len(), 1, "exactly one zip: {:?}", zips);
    let name = zips[0].file_name().unwrap().to_string_lossy().to_string();
    assert!(
        name.starts_with("bug-report-") && name.ends_with("Z.zip"),
        "unexpected default name: {}",
        name
    );
    assert!(
        stdout.contains(&format!("Wrote {}", zips[0].display())),
        "stdout names the file it wrote: {}",
        stdout
    );

    let entries = zip_entries(&zips[0]);
    for expected in [
        "plan.yaml",
        "doctor.txt",
        "config.sanitized.yaml",
        "metadata.txt",
    ] {
        assert!(entries.contains(&expected.to_string()), "{:?}", entries);
    }
}

/// `--submit` on its own refuses and exits 0. The refusal is deliberate rather than an error: the zip
/// is still written and still useful, so there is nothing to fail about.
#[test]
fn submit_without_yes_refuses_and_still_writes_the_zip() {
    let fixture = Fixture::new("submit-only");
    fixture.write_config_with_secrets();
    fixture.write_plan("00577-PortSomething");
    let out = fixture.home.join("report.zip");

    let (ok, stdout, stderr) = fixture.run(&[
        "--plan",
        "00577",
        "--description",
        "the daemon stopped answering",
        "--out",
        &out.to_string_lossy(),
        "--submit",
    ]);

    assert!(ok, "--submit alone must exit 0: {}{}", stdout, stderr);
    assert!(
        stdout.contains("Not uploaded: --submit needs --yes to confirm."),
        "the refusal has to be explicit: {}",
        stdout
    );
    assert_nothing_was_uploaded(&stdout);

    // The warning that explains *why* it is gated is printed before the refusal.
    assert!(
        stdout.contains("Warning: These files will be attached to a public GitHub issue."),
        "the reason for the gate has to be shown: {}",
        stdout
    );
    let warning = stdout.find("public GitHub issue").unwrap();
    let refusal = stdout.find("Not uploaded").unwrap();
    assert!(warning < refusal, "the warning comes first: {}", stdout);

    assert!(out.is_file(), "the local zip is still written");
    let entries = zip_entries(&out);
    assert!(
        entries.contains(&"description.txt".to_string()),
        "the description travels with the bundle: {:?}",
        entries
    );
}

/// `--yes` on its own is not a submission either: it only confirms one, and there is nothing to
/// confirm without `--submit`.
#[test]
fn yes_without_submit_uploads_nothing() {
    let fixture = Fixture::new("yes-only");
    fixture.write_config_with_secrets();
    fixture.write_plan("00577-PortSomething");

    let (ok, stdout, stderr) = fixture.run(&["--plan", "00577", "--yes"]);
    assert!(ok, "--yes alone must exit 0: {}{}", stdout, stderr);
    assert!(
        stdout.contains("Local report only. Add --submit --yes to upload it."),
        "--yes alone is the default path: {}",
        stdout
    );
    assert_nothing_was_uploaded(&stdout);
}

/// The secret-stripping contract, which is what makes a bundle safe to attach to a public issue at
/// all: no planted secret survives anywhere in the zip, whether it is under a telling key name, an
/// innocuous one, or inside a job's transcript.
#[test]
fn no_planted_secret_survives_anywhere_in_the_zip() {
    let fixture = Fixture::new("secrets");
    fixture.write_config_with_secrets();
    fixture.write_plan("00577-PortSomething");
    // An agent's log echoes the commands it ran, so a key can land here under no key name at all.
    fixture.write_job_log(
        "03125-00577-ExecutePlan.md",
        &format!(
            "# Job Log\n\n- **PlanId:** 00577\n\n```\nexport ANTHROPIC_API_KEY={}\ncurl -H \
             'Authorization: Bearer {}'\n```\n",
            PLANTED[0].1, PLANTED[3].1
        ),
    );
    let out = fixture.home.join("report.zip");

    let (ok, stdout, stderr) = fixture.run(&["--plan", "00577", "--out", &out.to_string_lossy()]);
    assert!(ok, "report-bug failed: {}{}", stdout, stderr);

    let contents = zip_contents(&out);
    assert!(
        contents
            .iter()
            .any(|(name, _)| name == "config.sanitized.yaml"),
        "the config is in the bundle at all: {:?}",
        contents.iter().map(|(n, _)| n).collect::<Vec<_>>()
    );

    for (label, secret) in PLANTED {
        for (name, body) in &contents {
            assert!(
                !body.contains(secret),
                "the {} secret leaked into {} of the bundle",
                label,
                name
            );
        }
    }

    // A password that looks like a word is caught by its key name, not its shape.
    for (name, body) in &contents {
        assert!(
            !body.contains(PLANTED_PASSWORD),
            "the password leaked into {} of the bundle",
            name
        );
    }

    let config = contents
        .iter()
        .find(|(name, _)| name == "config.sanitized.yaml")
        .map(|(_, body)| body.clone())
        .unwrap();
    assert!(
        config.contains("[REDACTED]"),
        "nothing was redacted: {}",
        config
    );
    // The diagnostics have to survive the redaction, or the bundle is useless.
    assert!(config.contains("codingAgent"), "{}", config);
    assert!(
        config.contains("admin"),
        "a username is not a secret: {}",
        config
    );

    let job_log = contents
        .iter()
        .find(|(name, _)| name == "Jobs/03125-00577-ExecutePlan.md")
        .map(|(_, body)| body.clone())
        .expect("the plan's job log is in the bundle");
    assert!(
        job_log.contains("# Job Log"),
        "the log itself survives: {}",
        job_log
    );
    assert!(job_log.contains("[REDACTED]"), "{}", job_log);
    // The variable names stay, so the reader can still see what was configured.
    assert!(job_log.contains("ANTHROPIC_API_KEY"), "{}", job_log);
}

/// A config that cannot be parsed cannot be sanitized, so it is left out rather than shipped raw.
/// Failing closed is the whole point: an unparseable config is exactly the one nobody has read.
#[test]
fn a_config_that_cannot_be_sanitized_is_left_out() {
    let fixture = Fixture::new("bad-config");
    std::fs::write(
        fixture.home.join("config.yaml"),
        format!(
            "projects:\n  - name: [unclosed\napi:\n  apiKey: '{}'\n",
            PLANTED[0].1
        ),
    )
    .unwrap();
    fixture.write_plan("00577-PortSomething");
    let out = fixture.home.join("report.zip");

    let (ok, stdout, stderr) = fixture.run(&["--plan", "00577", "--out", &out.to_string_lossy()]);
    assert!(ok, "report-bug failed: {}{}", stdout, stderr);

    let contents = zip_contents(&out);
    assert!(
        !contents
            .iter()
            .any(|(name, _)| name == "config.sanitized.yaml"),
        "an unsanitizable config must not be shipped"
    );
    for (name, body) in &contents {
        assert!(
            !body.contains(PLANTED[0].1),
            "the raw config leaked through {}",
            name
        );
    }
}

/// The worktrees are working copies of the reporter's own repositories: their identities go in, the
/// trees themselves do not. This keeps proprietary source out of a bundle bound for a public issue.
#[test]
fn worktree_contents_never_enter_the_bundle() {
    let fixture = Fixture::new("worktrees");
    fixture.write_config_with_secrets();
    let plan_folder = fixture.write_plan("00577-PortSomething");
    let worktree = plan_folder.join("Worktrees").join("repo");
    std::fs::create_dir_all(&worktree).unwrap();
    std::fs::write(worktree.join(".git"), "gitdir: /nowhere\n").unwrap();
    std::fs::write(
        worktree.join("secret-source.rs"),
        "// the customer's proprietary source\n",
    )
    .unwrap();
    let out = fixture.home.join("report.zip");

    let (ok, stdout, stderr) = fixture.run(&["--plan", "00577", "--out", &out.to_string_lossy()]);
    assert!(ok, "report-bug failed: {}{}", stdout, stderr);

    let contents = zip_contents(&out);
    let names: Vec<&str> = contents.iter().map(|(n, _)| n.as_str()).collect();
    assert!(
        !names.iter().any(|n| n.starts_with("Worktrees")),
        "a worktree path is in the bundle: {:?}",
        names
    );
    for (name, body) in &contents {
        assert!(
            !body.contains("proprietary source"),
            "worktree contents leaked through {}",
            name
        );
    }
    // Their identity is recorded instead.
    assert!(
        names.contains(&"worktrees.txt"),
        "the worktree manifest is missing: {:?}",
        names
    );
}

/// The redaction covers the config, the health report and every job artifact — but **not** the plan's
/// own files, which go in byte for byte. `--help` says so ("plan files are included as they are"), and
/// it is the reason submitting is gated behind two flags and a warning: a plan is the user's own
/// prose, and rewriting it would make the bundle useless for diagnosing the plan.
///
/// This test exists so the boundary is visible rather than assumed. If plan files ever *should* be
/// scrubbed, this is the test that has to change, deliberately.
#[test]
fn plan_files_are_bundled_verbatim_which_is_why_submitting_is_gated() {
    let fixture = Fixture::new("plan-verbatim");
    fixture.write_config_with_secrets();
    let plan_folder = fixture.write_plan("00577-PortSomething");
    std::fs::write(
        plan_folder.join("notes.md"),
        format!(
            "The reporter pasted a key into the plan: {}\n",
            PLANTED[0].1
        ),
    )
    .unwrap();
    let out = fixture.home.join("report.zip");

    let (ok, stdout, stderr) = fixture.run(&["--plan", "00577", "--out", &out.to_string_lossy()]);
    assert!(ok, "report-bug failed: {}{}", stdout, stderr);

    let notes = zip_contents(&out)
        .into_iter()
        .find(|(name, _)| name == "notes.md")
        .map(|(_, body)| body)
        .expect("the plan's own files are in the bundle");
    assert!(
        notes.contains(PLANTED[0].1),
        "plan files are documented as included as they are: {}",
        notes
    );

    // Which is exactly why the default sends nothing anywhere.
    assert!(stdout.contains("Local report only. Add --submit --yes to upload it."));
    assert_nothing_was_uploaded(&stdout);
}

/// A report needs a subject. Without `--plan` or `--job` clap asks for one rather than bundling the
/// whole installation.
#[test]
fn a_report_needs_a_plan_or_a_job() {
    let fixture = Fixture::new("no-subject");
    fixture.write_config_with_secrets();

    let (ok, stdout, stderr) = fixture.run(&[]);
    assert!(!ok, "no subject must be a usage error: {}", stdout);
    assert!(
        stderr.contains("--plan") && stderr.contains("--job"),
        "the error names both options: {}",
        stderr
    );
    assert!(
        std::fs::read_dir(&fixture.home)
            .unwrap()
            .flatten()
            .all(|e| e.path().extension().is_none_or(|x| x != "zip")),
        "no zip is written when the arguments are rejected"
    );
}

/// A plan id that does not resolve is an error, not an empty bundle with a reassuring exit code.
#[test]
fn an_unknown_plan_is_an_error() {
    let fixture = Fixture::new("unknown-plan");
    fixture.write_config_with_secrets();

    let (ok, stdout, stderr) = fixture.run(&["--plan", "99999"]);
    assert!(!ok, "an unknown plan must exit non-zero: {}", stdout);
    assert!(
        stderr.contains("99999"),
        "the error names the plan: {}",
        stderr
    );
}

/// Submitting needs a description, and there is no interactive prompt: with stdin closed the command
/// refuses rather than uploading a bundle with an empty body. Still no upload.
#[test]
fn submitting_without_a_description_refuses_rather_than_prompting() {
    let fixture = Fixture::new("no-description");
    fixture.write_config_with_secrets();
    fixture.write_plan("00577-PortSomething");

    let (ok, stdout, stderr) = fixture.run(&["--plan", "00577", "--submit"]);
    assert!(
        !ok,
        "a submission with no description must fail: {}",
        stdout
    );
    assert!(
        stderr.contains("--description is required"),
        "the error says what is missing: {}",
        stderr
    );
    assert_nothing_was_uploaded(&stdout);
}

/// `--out` is honoured exactly, including a directory that has to be created, so a caller can put the
/// bundle somewhere it will not be picked up by anything else.
#[test]
fn out_writes_exactly_where_it_is_told() {
    let fixture = Fixture::new("out");
    fixture.write_config_with_secrets();
    fixture.write_plan("00577-PortSomething");
    let out = fixture
        .home
        .join("nested")
        .join("deeper")
        .join("named-report.zip");

    let (ok, stdout, stderr) = fixture.run(&["--plan", "00577", "--out", &out.to_string_lossy()]);
    assert!(ok, "report-bug failed: {}{}", stdout, stderr);

    assert!(out.is_file(), "the zip is at the requested path");
    assert!(
        !std::fs::read_dir(&fixture.home)
            .unwrap()
            .flatten()
            .any(|e| e.path().extension().is_some_and(|x| x == "zip")),
        "no default-named zip is written alongside"
    );
    assert!(!zip_entries(&out).is_empty());
}

/// `--help` has to state the double gate, because a user reading only the flag list would otherwise
/// assume `--submit` submits.
#[test]
fn help_states_that_submitting_needs_both_flags() {
    let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .args(["report-bug", "--help"])
        .env_remove("TENDRIL_HOME")
        .output()
        .expect("run tendril report-bug --help");
    assert!(output.status.success());

    let help = String::from_utf8_lossy(&output.stdout);
    assert!(
        help.contains("--submit and --yes"),
        "--help must state that both flags are needed: {}",
        help
    );
    assert!(
        help.contains("public GitHub issue"),
        "--help must say where a submitted bundle ends up: {}",
        help
    );
    assert!(
        help.contains("--submit does nothing without it"),
        "--yes must document what it confirms: {}",
        help
    );
}
