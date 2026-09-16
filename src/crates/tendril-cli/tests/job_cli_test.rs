//! `tendril job` — argument parsing, exit codes, the daemon wire contract and the daemon-down
//! contract.
//!
//! Three layers, in order of how much they cost to run:
//!
//! 1. **Parsing.** `JobCommands` is public, so the real derive output is exercised in-process with
//!    `try_parse_from`, as `cli_parse_test.rs` does for `PlanCommands`.
//! 2. **Process behaviour.** Exit codes and stdout/stderr shape need a real process, so those tests
//!    spawn `env!("CARGO_BIN_EXE_tendril")` against a throwaway `--home`. The ambient `TENDRIL_HOME`
//!    on a developer machine points at a real Tendril home, so `--home` is always passed explicitly
//!    and `TENDRIL_HOME`/`TENDRIL_PLANS`/`TENDRIL_CONFIG` are overridden for the child.
//! 3. **Wire contract.** A recording stub daemon on an ephemeral port answers the CLI's requests and
//!    keeps every method, URI, bearer token and body, so what the CLI *sends* is pinned as tightly as
//!    what it prints. One test uses the real `tendril_server` router instead of a stub, so the
//!    end-to-end submission path is covered by something that can actually diverge from the stub.
//!
//! The daemon-down contract is the subtle part and it is not uniform on purpose:
//!
//! - `job status` and `job fail` are progress telemetry. They warn on stderr and exit **0**, because
//!   they are the two most-invoked commands in the promptware corpus and almost always sit inside an
//!   `&&` chain — a daemon blip must not abort the agent's step, and `fail` runs on the failure path
//!   where dying mid-report is worst of all.
//! - Every other subcommand that needs the daemon fails with exit 1 and a message naming
//!   `tendril run`, which is the documented way to start it.

use axum::routing::any;
use axum::{Json, Router};
use clap::{CommandFactory, Parser};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tendril_cli::commands::job::{JobAddLogArgs, JobClearArgs, JobCommands, JobListArgs};
use tendril_core::config::write_master;

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

/// A minimal parser so `try_parse_from` exercises the real derive output for `JobCommands`.
#[derive(Parser)]
#[command(name = "tendril")]
struct TestCli {
    #[command(subcommand)]
    command: JobCommands,
}

fn parse(args: &[&str]) -> JobCommands {
    TestCli::try_parse_from(args)
        .unwrap_or_else(|e| panic!("parse {:?}: {}", args, e))
        .command
}

fn parse_err(args: &[&str]) -> clap::error::ErrorKind {
    match TestCli::try_parse_from(args) {
        Ok(_) => panic!("expected {:?} to fail parsing", args),
        Err(e) => e.kind(),
    }
}

#[test]
fn the_clap_definition_is_internally_consistent() {
    // Catches conflicting flags and malformed arg definitions here rather than on the operator's
    // first `tendril job --help`.
    TestCli::command().debug_assert();
}

/// Every subcommand the promptware corpus and the docs name must still parse under that exact name.
/// A rename is a breaking change for every agent prompt in the corpus, so it has to fail here.
#[test]
fn every_documented_subcommand_parses_under_its_documented_name() {
    assert!(matches!(parse(&["tendril", "list"]), JobCommands::List(_)));
    assert!(matches!(
        parse(&["tendril", "start", "ExpandPlan", "00123"]),
        JobCommands::Start(_)
    ));
    assert!(matches!(
        parse(&["tendril", "status", "00123", "-m", "working"]),
        JobCommands::Status(_)
    ));
    assert!(matches!(
        parse(&["tendril", "fail", "00123", "-m", "boom"]),
        JobCommands::Fail(_)
    ));
    assert!(matches!(
        parse(&["tendril", "cancel", "00123"]),
        JobCommands::Cancel(_)
    ));
    assert!(matches!(
        parse(&["tendril", "add-log", "00123", "ExecutePlan"]),
        JobCommands::AddLog(_)
    ));
    assert!(matches!(
        parse(&["tendril", "delete", "00123"]),
        JobCommands::Delete(_)
    ));
    assert!(matches!(
        parse(&["tendril", "force-start", "00123"]),
        JobCommands::ForceStart(_)
    ));
    assert!(matches!(
        parse(&["tendril", "stop-all"]),
        JobCommands::StopAll
    ));
    assert!(matches!(
        parse(&["tendril", "clear"]),
        JobCommands::Clear(_)
    ));
    assert!(matches!(
        parse(&["tendril", "queue"]),
        JobCommands::Queue(_)
    ));
    assert!(matches!(
        parse(&["tendril", "maintenance"]),
        JobCommands::Maintenance
    ));
}

#[test]
fn list_defaults_to_twenty_rows_of_plain_text() {
    let JobCommands::List(JobListArgs {
        status,
        limit,
        json,
    }) = parse(&["tendril", "list"])
    else {
        panic!("expected list");
    };
    assert_eq!(status, None);
    assert_eq!(limit, 20, "the default page size is part of the contract");
    assert!(!json);
}

#[test]
fn list_accepts_short_and_long_forms_of_status_and_limit() {
    for args in [
        ["tendril", "list", "-s", "Running", "-l", "5"],
        ["tendril", "list", "--status", "Running", "--limit", "5"],
    ] {
        let JobCommands::List(JobListArgs { status, limit, .. }) = parse(&args) else {
            panic!("expected list");
        };
        assert_eq!(status.as_deref(), Some("Running"));
        assert_eq!(limit, 5);
    }

    let JobCommands::List(JobListArgs { json, .. }) = parse(&["tendril", "list", "--json"]) else {
        panic!("expected list");
    };
    assert!(json);
}

#[test]
fn list_rejects_a_non_numeric_limit() {
    assert_eq!(
        parse_err(&["tendril", "list", "--limit", "lots"]),
        clap::error::ErrorKind::ValueValidation
    );
}

/// The `job start` help text is the only place an operator or an agent learns which job types exist,
/// so it has to list all of them. `build_job_args` is the actual gate; this pins the documentation
/// against it.
#[test]
fn start_help_documents_every_job_type() {
    let help = TestCli::command()
        .find_subcommand_mut("start")
        .expect("start subcommand")
        .render_long_help()
        .to_string();
    for job_type in JOB_TYPES {
        assert!(
            help.contains(job_type),
            "`job start --help` does not mention {}: {}",
            job_type,
            help
        );
    }
}

#[test]
fn start_requires_a_job_type() {
    assert_eq!(
        parse_err(&["tendril", "start"]),
        clap::error::ErrorKind::MissingRequiredArgument
    );
}

#[test]
fn start_collects_wait_for_once_per_flag() {
    let JobCommands::Start(args) = parse(&[
        "tendril",
        "start",
        "ExecutePlan",
        "00123",
        "--wait-for",
        "00100",
        "--wait-for",
        "00101",
    ]) else {
        panic!("expected start");
    };
    assert_eq!(
        args.wait_for,
        vec!["00100".to_string(), "00101".to_string()],
        "--wait-for is repeatable, not last-wins"
    );
}

#[test]
fn start_parses_priority_force_and_idempotency_key() {
    let JobCommands::Start(args) = parse(&[
        "tendril",
        "start",
        "CreatePlan",
        "--description",
        "Do the thing",
        "--project",
        "Tendril",
        "--priority",
        "7",
        "--force",
        "--idempotency-key",
        "retry-key-1",
    ]) else {
        panic!("expected start");
    };
    assert_eq!(args.priority, Some(7));
    assert!(args.force);
    assert_eq!(args.idempotency_key.as_deref(), Some("retry-key-1"));

    // A negative priority (deprioritise below the default 0) needs the `=` form, because the flag is
    // not declared `allow_negative_numbers` and clap would otherwise read `-5` as a short flag.
    let JobCommands::Start(args) =
        parse(&["tendril", "start", "ExecutePlan", "00123", "--priority=-5"])
    else {
        panic!("expected start");
    };
    assert_eq!(args.priority, Some(-5));
}

#[test]
fn start_parses_the_whole_per_type_option_bag() {
    let JobCommands::Start(args) = parse(&[
        "tendril",
        "start",
        "CreatePr",
        "00123",
        "--description",
        "desc",
        "--project",
        "Tendril",
        "--source-path",
        "/tmp/source.md",
        "--change-request",
        "please fix",
        "--note",
        "a note",
        "--instructions",
        "refine it",
        "--repo",
        "owner/repo",
        "--assignee",
        "alice",
        "--reviewer",
        "bob",
        "--reviewer",
        "carol,dave",
        "--comment",
        "a comment",
        "--labels",
        "bug,urgent",
        "--no-merge",
        "--no-delete-branch",
        "--no-artifacts",
        "--draft",
        "--repo-path",
        "/tmp/repo",
        "--base-branch",
        "develop",
        "--untracked-policy",
        "Stash",
    ]) else {
        panic!("expected start");
    };
    assert_eq!(args.job_type, "CreatePr");
    assert_eq!(args.plan_id.as_deref(), Some("00123"));
    assert_eq!(args.description.as_deref(), Some("desc"));
    assert_eq!(args.project.as_deref(), Some("Tendril"));
    assert_eq!(args.source_path.as_deref(), Some("/tmp/source.md"));
    assert_eq!(args.change_request.as_deref(), Some("please fix"));
    assert_eq!(args.note.as_deref(), Some("a note"));
    assert_eq!(args.instructions.as_deref(), Some("refine it"));
    assert_eq!(args.repo.as_deref(), Some("owner/repo"));
    assert_eq!(args.assignee.as_deref(), Some("alice"));
    assert_eq!(
        args.reviewer,
        vec!["bob".to_string(), "carol,dave".to_string()],
        "--reviewer is repeatable; the comma split happens downstream in build_job_args"
    );
    assert_eq!(args.comment.as_deref(), Some("a comment"));
    assert_eq!(args.labels.as_deref(), Some("bug,urgent"));
    assert!(args.no_merge);
    assert!(args.no_delete_branch);
    assert!(args.no_artifacts);
    assert!(args.draft);
    assert_eq!(args.repo_path.as_deref(), Some("/tmp/repo"));
    assert_eq!(args.base_branch.as_deref(), Some("develop"));
    assert_eq!(args.untracked_policy.as_deref(), Some("Stash"));
}

#[test]
fn start_defaults_every_optional_flag_to_absent() {
    let JobCommands::Start(args) = parse(&["tendril", "start", "ExpandPlan", "00123"]) else {
        panic!("expected start");
    };
    assert_eq!(args.priority, None);
    assert!(args.wait_for.is_empty());
    assert!(!args.force);
    assert_eq!(args.idempotency_key, None);
    assert!(args.reviewer.is_empty());
    assert!(!args.no_merge && !args.no_delete_branch && !args.no_artifacts && !args.draft);
}

#[test]
fn status_takes_a_required_message_and_optional_plan_identity() {
    let JobCommands::Status(args) = parse(&[
        "tendril",
        "status",
        "00123",
        "--message",
        "halfway",
        "--plan-id",
        "00456",
        "--plan-title",
        "Fix the thing",
    ]) else {
        panic!("expected status");
    };
    assert_eq!(args.job_id, "00123");
    assert_eq!(args.message, "halfway");
    assert_eq!(args.plan_id.as_deref(), Some("00456"));
    assert_eq!(args.plan_title.as_deref(), Some("Fix the thing"));

    // `-m` is the form the promptware corpus uses everywhere.
    let JobCommands::Status(args) = parse(&["tendril", "status", "00123", "-m", "halfway"]) else {
        panic!("expected status");
    };
    assert_eq!(args.message, "halfway");
    assert_eq!(args.plan_id, None);
    assert_eq!(args.plan_title, None);

    assert_eq!(
        parse_err(&["tendril", "status", "00123"]),
        clap::error::ErrorKind::MissingRequiredArgument,
        "a status report with no message says nothing"
    );
    assert_eq!(
        parse_err(&["tendril", "status", "-m", "halfway"]),
        clap::error::ErrorKind::MissingRequiredArgument
    );
}

#[test]
fn fail_requires_both_a_job_id_and_a_message() {
    let JobCommands::Fail(args) = parse(&["tendril", "fail", "00123", "-m", "the build broke"])
    else {
        panic!("expected fail");
    };
    assert_eq!(args.job_id, "00123");
    assert_eq!(args.message, "the build broke");

    assert_eq!(
        parse_err(&["tendril", "fail", "00123"]),
        clap::error::ErrorKind::MissingRequiredArgument
    );
}

#[test]
fn cancel_message_is_optional() {
    let JobCommands::Cancel(args) = parse(&["tendril", "cancel", "00123"]) else {
        panic!("expected cancel");
    };
    assert_eq!(args.job_id, "00123");
    assert_eq!(args.message, None);

    let JobCommands::Cancel(args) =
        parse(&["tendril", "cancel", "00123", "-m", "no longer needed"])
    else {
        panic!("expected cancel");
    };
    assert_eq!(args.message.as_deref(), Some("no longer needed"));
}

#[test]
fn add_log_takes_a_job_id_an_action_and_an_optional_summary() {
    let JobCommands::AddLog(JobAddLogArgs {
        job_id,
        action,
        summary,
    }) = parse(&[
        "tendril",
        "add-log",
        "00123",
        "ExecutePlan",
        "--summary",
        "ran the verifications",
    ])
    else {
        panic!("expected add-log");
    };
    assert_eq!(job_id, "00123");
    assert_eq!(action, "ExecutePlan");
    assert_eq!(summary.as_deref(), Some("ran the verifications"));

    assert_eq!(
        parse_err(&["tendril", "add-log", "00123"]),
        clap::error::ErrorKind::MissingRequiredArgument,
        "the action is what the log entry is about"
    );
}

#[test]
fn clear_parses_each_scope_and_the_yes_flag() {
    let JobCommands::Clear(JobClearArgs {
        completed,
        failed,
        all,
        yes,
    }) = parse(&["tendril", "clear"])
    else {
        panic!("expected clear");
    };
    assert!(
        !completed && !failed && !all && !yes,
        "bare `clear` sets no flag; the handler treats that as --completed"
    );

    for (args, expect) in [
        (["tendril", "clear", "--completed"], (true, false, false)),
        (["tendril", "clear", "--failed"], (false, true, false)),
        (["tendril", "clear", "--all"], (false, false, true)),
    ] {
        let JobCommands::Clear(c) = parse(&args) else {
            panic!("expected clear");
        };
        assert_eq!((c.completed, c.failed, c.all), expect, "{:?}", args);
    }

    for args in [
        ["tendril", "clear", "--all", "-y"],
        ["tendril", "clear", "--all", "--yes"],
    ] {
        let JobCommands::Clear(c) = parse(&args) else {
            panic!("expected clear");
        };
        assert!(c.yes, "{:?}", args);
    }
}

#[test]
fn queue_takes_only_json() {
    let JobCommands::Queue(args) = parse(&["tendril", "queue"]) else {
        panic!("expected queue");
    };
    assert!(!args.json);
    let JobCommands::Queue(args) = parse(&["tendril", "queue", "--json"]) else {
        panic!("expected queue");
    };
    assert!(args.json);
}

#[test]
fn an_unknown_flag_is_a_parse_error_not_a_silent_ignore() {
    assert_eq!(
        parse_err(&["tendril", "list", "--bogus"]),
        clap::error::ErrorKind::UnknownArgument
    );
    assert_eq!(
        parse_err(&["tendril", "stop-all", "--force"]),
        clap::error::ErrorKind::UnknownArgument
    );
}

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------

/// Every job type `build_job_args` accepts, in the order `job start --help` lists them.
const JOB_TYPES: [&str; 11] = [
    "ExecutePlan",
    "CreatePlan",
    "RetryPlan",
    "UpdatePlan",
    "ExpandPlan",
    "SplitPlan",
    "CreatePr",
    "CreateIssue",
    "SetupProject",
    "AddProject",
    "SyncRepo",
];

/// A finished `tendril` invocation.
struct Run {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl Run {
    fn ok(&self) -> bool {
        self.code == Some(0)
    }
}

/// A throwaway `TENDRIL_HOME`, removed on drop.
struct Home {
    path: PathBuf,
}

impl Home {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-job-cli-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(path.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(path.join("Plans")).unwrap();
        // A short budget so a wedged fixture fails the test instead of hanging it.
        std::fs::write(
            tendril_core::config::get_config_path(&path),
            "daemonRequestTimeout: 5\nenrichModels: false\n",
        )
        .unwrap();
        Self { path }
    }

    fn plans_dir(&self) -> PathBuf {
        self.path.join("Plans")
    }

    /// A plan folder an `ExecutePlan`-family submission can resolve. The absolute path is what is
    /// passed on the command line, so `resolve_plan_folder` short-circuits and the ambient
    /// `TENDRIL_PLANS` can never matter.
    fn write_plan(&self, folder_name: &str) -> PathBuf {
        let folder = self.plans_dir().join(folder_name);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("plan.yaml"),
            "id: \"09990\"\ntitle: Job CLI Fixture\nstate: Approved\nproject: Tendril\n",
        )
        .unwrap();
        folder
    }

    fn job_log(&self, job_id: &str) -> PathBuf {
        self.path
            .join("Logs")
            .join("Jobs")
            .join(job_id)
            .with_extension("md")
    }

    /// Runs the built binary against this home. The child's `TENDRIL_*` environment is pinned to the
    /// fixture so a developer's real Tendril home cannot leak in.
    fn run(&self, args: &[&str]) -> Run {
        let output = std::process::Command::new(env!("CARGO_BIN_EXE_tendril"))
            .arg("--home")
            .arg(&self.path)
            .args(args)
            .env("TENDRIL_HOME", &self.path)
            .env("TENDRIL_PLANS", self.plans_dir())
            .env_remove("TENDRIL_CONFIG")
            // `job clear --all` prompts on a terminal. Under `cargo test` the child would inherit the
            // developer's TTY and block forever waiting for an answer, so stdin is always closed.
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap_or_else(|e| panic!("run tendril {:?}: {}", args, e));

        Run {
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        }
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        assert!(self.path.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// One request the stub daemon answered.
#[derive(Clone, Debug)]
struct Recorded {
    method: String,
    uri: String,
    auth: Option<String>,
    body: serde_json::Value,
}

/// A daemon that records every request and answers from a closure. Hand-rolled rather than
/// `tendril_server::create_router` so a specific status code — a 404, a 409, a 401 — can be produced
/// on demand.
struct Stub {
    home: Home,
    secret: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Stub {
    /// The daemon runs on its own thread with its own runtime, so the tests themselves stay
    /// synchronous and can block on the child process.
    fn new<F>(label: &str, respond: F) -> Self
    where
        F: Fn(&str, &str) -> (axum::http::StatusCode, serde_json::Value)
            + Clone
            + Send
            + Sync
            + 'static,
    {
        let home = Home::new(label);
        let secret = format!("stub-secret-{}", uuid::Uuid::new_v4().simple());

        // Bound the port before the server thread starts, so `.master` is on disk by the time any
        // child process looks for it.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        write_master(&home.path, port, &secret, "127.0.0.1", "http").unwrap();

        let requests: Arc<Mutex<Vec<Recorded>>> = Arc::new(Mutex::new(Vec::new()));
        let recorder = Arc::clone(&requests);

        let app = Router::new().fallback(any(move |req: axum::extract::Request| {
            let respond = respond.clone();
            let recorder = Arc::clone(&recorder);
            async move {
                let (parts, body) = req.into_parts();
                let bytes = axum::body::to_bytes(body, 1 << 20)
                    .await
                    .unwrap_or_default();
                let recorded = Recorded {
                    method: parts.method.to_string(),
                    uri: parts.uri.to_string(),
                    auth: parts
                        .headers
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .map(|v| v.to_string()),
                    body: serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
                };
                let (status, payload) = respond(&recorded.method, &recorded.uri);
                recorder.lock().unwrap().push(recorded);
                (status, Json(payload))
            }
        }));

        let (shutdown, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let thread = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async move {
                let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                let _ = axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = shutdown_rx.await;
                    })
                    .await;
            });
        });

        Self {
            home,
            secret,
            requests,
            shutdown: Some(shutdown),
            thread: Some(thread),
        }
    }

    /// A stub that answers every request with `200 {}`.
    fn accepting(label: &str) -> Self {
        Self::new(label, |_, _| {
            (axum::http::StatusCode::OK, serde_json::json!({}))
        })
    }

    fn run(&self, args: &[&str]) -> Run {
        self.home.run(args)
    }

    fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }

    fn only_request(&self) -> Recorded {
        let all = self.requests();
        assert_eq!(all.len(), 1, "expected exactly one request, got {:?}", all);
        all.into_iter().next().unwrap()
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Daemon-down contract
// ---------------------------------------------------------------------------------------------

/// The contract this whole file exists for: telemetry never fails an agent run.
#[test]
fn status_and_fail_warn_on_stderr_and_exit_zero_without_a_daemon() {
    let home = Home::new("telemetry-no-master");

    let run = home.run(&["job", "status", "00123", "-m", "halfway through"]);
    assert_eq!(
        run.code,
        Some(0),
        "`job status` must never fail an agent run: {}{}",
        run.stdout,
        run.stderr
    );
    assert!(
        run.stderr
            .contains("Warning: could not report status for job 00123"),
        "the operator still has to be told the report was lost: {}",
        run.stderr
    );
    assert!(
        run.stdout.is_empty(),
        "nothing was updated, so nothing should claim it was: {}",
        run.stdout
    );

    let run = home.run(&["job", "fail", "00123", "-m", "the build broke"]);
    assert_eq!(
        run.code,
        Some(0),
        "`job fail` runs on the failure path; exiting non-zero kills the report itself: {}{}",
        run.stdout,
        run.stderr
    );
    assert!(
        run.stderr
            .contains("Warning: could not report failure for job 00123"),
        "{}",
        run.stderr
    );
    assert!(run.stdout.is_empty(), "{}", run.stdout);
}

/// Same contract with a `.master` file that points at nothing — the stale-daemon case, which is how
/// this shows up in practice after a crash.
#[test]
fn status_and_fail_still_exit_zero_against_a_stale_master_file() {
    let home = Home::new("telemetry-stale-master");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    write_master(&home.path, port, "secret", "127.0.0.1", "http").unwrap();

    for args in [
        vec!["job", "status", "00123", "-m", "halfway"],
        vec!["job", "fail", "00123", "-m", "boom"],
    ] {
        let run = home.run(&args);
        assert_eq!(
            run.code,
            Some(0),
            "{:?}: {}{}",
            args,
            run.stdout,
            run.stderr
        );
        assert!(
            run.stderr.contains("Warning: could not report"),
            "{:?}: {}",
            args,
            run.stderr
        );
    }
}

/// A 500 from a daemon that *is* running is still telemetry, and still must not fail the run.
#[test]
fn a_rejected_status_report_is_a_warning_not_a_failure() {
    let stub = Stub::new("telemetry-500", |_, _| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "database is locked" }),
        )
    });

    let run = stub.run(&["job", "status", "00123", "-m", "halfway"]);
    assert_eq!(run.code, Some(0), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Warning: could not report status"),
        "{}",
        run.stderr
    );

    let run = stub.run(&["job", "fail", "00123", "-m", "boom"]);
    assert_eq!(run.code, Some(0), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Warning: could not report failure"),
        "{}",
        run.stderr
    );
}

/// Everything that is *not* telemetry fails loudly, and says how to start the daemon. `tendril run`
/// rather than `tendril serve`: only `run` migrates the database and checks the port first.
#[test]
fn every_non_telemetry_subcommand_fails_naming_tendril_run() {
    let home = Home::new("no-master");
    let plan = home.write_plan("09990-NoMaster");
    let plan = plan.to_string_lossy().to_string();

    let invocations: Vec<Vec<&str>> = vec![
        vec!["job", "list"],
        vec!["job", "start", "ExecutePlan", &plan],
        vec!["job", "cancel", "00123"],
        vec!["job", "delete", "00123"],
        vec!["job", "force-start", "00123"],
        vec!["job", "stop-all"],
        vec!["job", "clear", "--completed"],
        vec!["job", "clear", "--failed"],
        vec!["job", "queue"],
        vec!["job", "maintenance"],
    ];

    for args in invocations {
        let run = home.run(&args);
        assert_eq!(
            run.code,
            Some(1),
            "{:?} should be a plain runtime failure: {}{}",
            args,
            run.stdout,
            run.stderr
        );
        assert!(
            run.stderr.contains("No Tendril server is running"),
            "{:?} should say the daemon is not running: {}",
            args,
            run.stderr
        );
        assert!(
            run.stderr.contains("tendril run"),
            "{:?} should name the documented daemon starter: {}",
            args,
            run.stderr
        );
    }
}

/// A stale `.master` is a different failure from a missing one — the daemon was never reached, which
/// is unambiguous, so `job start` reports it as a plain failure rather than as an ambiguous
/// submission. Naming host and port is what lets an operator spot the stale file.
#[test]
fn start_against_a_stale_master_file_is_a_plain_failure() {
    let home = Home::new("start-stale-master");
    let plan = home.write_plan("09991-StaleMaster");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    write_master(&home.path, port, "secret", "127.0.0.1", "http").unwrap();

    let run = home.run(&["job", "start", "ExecutePlan", &plan.to_string_lossy()]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Could not reach the Tendril daemon"),
        "{}",
        run.stderr
    );
    assert!(
        run.stderr.contains(&port.to_string()),
        "the message should name the port from the stale .master: {}",
        run.stderr
    );
    assert!(
        !run.stderr.contains("may or may not have been created"),
        "a refused connection proves the job was never submitted: {}",
        run.stderr
    );
}

// ---------------------------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------------------------

/// Three distinct exit codes, and the promptware corpus depends on all three: 2 for a usage error,
/// 1 for a runtime failure, 0 for telemetry that could not be delivered.
#[test]
fn exit_codes_distinguish_usage_errors_runtime_failures_and_telemetry() {
    let home = Home::new("exit-codes");

    let run = home.run(&["job", "list", "--bogus"]);
    assert_eq!(
        run.code,
        Some(2),
        "clap reports a usage error as exit 2: {}{}",
        run.stdout,
        run.stderr
    );

    let run = home.run(&["job", "list", "--limit", "not-a-number"]);
    assert_eq!(run.code, Some(2), "{}{}", run.stdout, run.stderr);

    let run = home.run(&["job", "status", "00123"]);
    assert_eq!(
        run.code,
        Some(2),
        "a missing --message is a usage error, not a lost report: {}{}",
        run.stdout,
        run.stderr
    );

    // Runtime failure.
    assert_eq!(home.run(&["job", "queue"]).code, Some(1));
    // Telemetry.
    assert_eq!(home.run(&["job", "fail", "00123", "-m", "x"]).code, Some(0));

    // `--help` is a success, not an error.
    let run = home.run(&["job", "--help"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert!(run.stdout.contains("add-log"), "{}", run.stdout);
}

/// The scope flags are mutually exclusive, and `--all` will not run unattended. Both checks happen
/// before the daemon is contacted, so they are the same with or without one running.
#[test]
fn clear_rejects_conflicting_scopes_and_refuses_an_unattended_all() {
    let home = Home::new("clear-guards");

    let run = home.run(&["job", "clear", "--completed", "--failed"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr
            .contains("Pass only one of --completed, --failed or --all"),
        "{}",
        run.stderr
    );

    // Piped stdin, so there is nobody to answer the prompt.
    let run = home.run(&["job", "clear", "--all"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Clear all jobs?") && run.stderr.contains("--yes"),
        "the refusal has to say how to proceed: {}",
        run.stderr
    );
    assert!(
        !run.stderr.contains("No Tendril server is running"),
        "the guard runs before the daemon is contacted: {}",
        run.stderr
    );
}

// ---------------------------------------------------------------------------------------------
// `job add-log` — filesystem only
// ---------------------------------------------------------------------------------------------

/// `add-log` is the one job subcommand that needs no daemon at all: it appends straight to
/// `<home>/Logs/Jobs/<id>.md`. The agent instructions promise exactly that, so it has to hold with
/// no `.master` file present.
#[test]
fn add_log_creates_then_appends_to_the_job_log_without_a_daemon() {
    let home = Home::new("add-log");
    let log = home.job_log("00123");
    assert!(!log.exists());

    let run = home.run(&[
        "job",
        "add-log",
        "00123",
        "ExecutePlan",
        "--summary",
        "first",
    ]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stdout
            .contains(&format!("Log written: {}", log.display())),
        "the path is printed so a script can find it: {}",
        run.stdout
    );

    let first = std::fs::read_to_string(&log).expect("the log was created");
    assert!(first.contains("## Agent Log ["), "{}", first);
    assert!(first.contains("**Action:** ExecutePlan"), "{}", first);
    assert!(first.contains("first"), "{}", first);

    let run = home.run(&[
        "job",
        "add-log",
        "00123",
        "Verifying",
        "--summary",
        "second",
    ]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    let second = std::fs::read_to_string(&log).unwrap();
    assert!(
        second.starts_with(&first),
        "the second entry must append, never rewrite: {}",
        second
    );
    assert!(second.contains("**Action:** Verifying"), "{}", second);
    assert!(second.contains("second"), "{}", second);

    // The summary is optional; an entry without one still records the action.
    let run = home.run(&["job", "add-log", "00123", "Cleanup"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert!(std::fs::read_to_string(&log)
        .unwrap()
        .contains("**Action:** Cleanup"));
}

/// V1 rejected a job id that is not alphanumeric, and it was right to: `add-log` builds a filename
/// out of the id, so an unsubstituted `{{TendrilJobId}}` placeholder or a `../` segment either
/// litters the log directory or escapes it entirely. Nothing may be written for such an id.
#[test]
fn add_log_rejects_a_malformed_job_id_and_writes_nothing() {
    let home = Home::new("add-log-bad-id");

    for job_id in [
        "{{TendrilJobId}}",
        "../../etc/passwd",
        "00123/../escape",
        "",
        "0012 3",
    ] {
        let run = home.run(&["job", "add-log", job_id, "ExecutePlan"]);
        assert_eq!(
            run.code,
            Some(1),
            "job id {:?} should be rejected: {}{}",
            job_id,
            run.stdout,
            run.stderr
        );
        assert!(
            run.stderr.contains("Invalid job id"),
            "job id {:?}: {}",
            job_id,
            run.stderr
        );
    }

    // Not one byte was written anywhere under the home beyond the config the fixture seeded.
    let logs_dir = home.path.join("Logs");
    let wrote_something = std::fs::read_dir(logs_dir.join("Jobs"))
        .map(|entries| entries.count() > 0)
        .unwrap_or(false);
    assert!(
        !wrote_something,
        "a rejected job id must not leave a log file behind"
    );
    assert!(
        !home.path.join("etc").exists() && !home.path.join("Logs/etc").exists(),
        "a `../` segment must not escape the log directory"
    );
}

/// Agents and operators type the unpadded form. V1 normalized it on every surface that accepts a job
/// id, so `add-log 123` has to land in the same file as `add-log 00123` rather than starting an
/// orphan `123.md` beside the real log.
#[test]
fn add_log_normalizes_an_unpadded_job_id() {
    let home = Home::new("add-log-normalize");

    let run = home.run(&[
        "job",
        "add-log",
        "123",
        "ExecutePlan",
        "--summary",
        "padded",
    ]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);

    let log = home.job_log("00123");
    assert!(
        log.exists(),
        "`add-log 123` should write 00123.md, the name the daemon allocates"
    );
    assert!(!home.job_log("123").exists(), "no orphan 123.md");
    assert!(std::fs::read_to_string(&log).unwrap().contains("padded"));
}

// ---------------------------------------------------------------------------------------------
// Wire contract, against a recording stub
// ---------------------------------------------------------------------------------------------

/// Empty states print the table header and nothing else — never a bare blank screen, and never a
/// row built from missing keys.
#[test]
fn list_and_queue_have_readable_empty_states() {
    let stub = Stub::new("empty-states", |method, uri| {
        let payload = if uri.starts_with("/api/jobs/queue") {
            serde_json::json!({ "queued": [], "maxConcurrent": 3 })
        } else {
            serde_json::json!([])
        };
        assert_eq!(method, "GET");
        (axum::http::StatusCode::OK, payload)
    });

    let run = stub.run(&["job", "list"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    let lines: Vec<&str> = run.stdout.lines().collect();
    assert!(lines[0].starts_with("ID"), "{:?}", lines);
    assert!(
        lines[0].contains("TYPE") && lines[0].contains("STATUS"),
        "{:?}",
        lines
    );
    assert_eq!(lines[1], "-".repeat(75));
    assert_eq!(lines.len(), 2, "no rows for an empty job list: {:?}", lines);

    let run = stub.run(&["job", "list", "--json"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&run.stdout).unwrap(),
        serde_json::json!([]),
        "--json prints valid JSON even when empty"
    );

    let run = stub.run(&["job", "queue"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        run.stdout, "0 job(s) queued, 3 concurrent slot(s).\n",
        "an empty queue prints the summary line and no table"
    );
}

#[test]
fn list_renders_a_row_per_job_and_passes_status_and_limit_to_the_daemon() {
    let stub = Stub::new("list-rows", |_, _| {
        (
            axum::http::StatusCode::OK,
            serde_json::json!([
                {
                    "id": "00101",
                    "type": "ExecutePlan",
                    "status": "Running",
                    "project": "Tendril",
                    "planFile": "/plans/00123-Fix",
                },
                {
                    "id": "00102",
                    "type": "CreatePlan",
                    "status": "Queued",
                    "project": "Tendril",
                    "planFile": "",
                },
            ]),
        )
    });

    let run = stub.run(&["job", "list", "--status", "Running", "--limit", "5"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);

    let request = stub.only_request();
    assert_eq!(request.method, "GET");
    assert_eq!(
        request.uri, "/api/jobs?limit=5&status=Running",
        "the filter is a query parameter, not client-side"
    );
    assert_eq!(
        request.auth.as_deref(),
        Some(format!("Bearer {}", stub.secret).as_str()),
        "every daemon call carries the .master secret"
    );

    let lines: Vec<&str> = run.stdout.lines().collect();
    assert_eq!(
        lines.len(),
        4,
        "header, rule and one row per job: {:?}",
        lines
    );
    assert!(lines[2].starts_with("00101"), "{:?}", lines);
    assert!(
        lines[2].contains("ExecutePlan") && lines[2].contains("Running"),
        "{:?}",
        lines
    );
    assert!(lines[2].ends_with("/plans/00123-Fix"), "{:?}", lines);
    assert!(lines[3].starts_with("00102"), "{:?}", lines);
}

#[test]
fn queue_reports_dispatch_order_and_concurrency() {
    let stub = Stub::new("queue-rows", |_, _| {
        (
            axum::http::StatusCode::OK,
            serde_json::json!({
                "queued": [
                    { "id": "00201", "priority": 10 },
                    { "id": "00202", "priority": 0 },
                ],
                "maxConcurrent": 2,
            }),
        )
    });

    let run = stub.run(&["job", "queue"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(stub.only_request().uri, "/api/jobs/queue");
    let lines: Vec<&str> = run.stdout.lines().collect();
    assert_eq!(lines[0], "2 job(s) queued, 2 concurrent slot(s).");
    assert!(
        lines[1].starts_with("ID") && lines[1].contains("PRIORITY"),
        "{:?}",
        lines
    );
    assert!(
        lines[3].starts_with("00201") && lines[3].ends_with("10"),
        "{:?}",
        lines
    );
    assert!(
        lines[4].starts_with("00202") && lines[4].ends_with('0'),
        "{:?}",
        lines
    );

    let run = stub.run(&["job", "queue", "--json"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    let doc: serde_json::Value = serde_json::from_str(&run.stdout).expect("--json is JSON");
    assert_eq!(doc["maxConcurrent"], 2);
    assert_eq!(doc["queued"][0]["id"], "00201");
}

#[test]
fn stop_all_and_clear_report_what_they_touched() {
    let stub = Stub::new("bulk", |_, uri| {
        let payload = if uri.starts_with("/api/jobs/stop-all") {
            serde_json::json!({ "stopped": ["00301", "00302"] })
        } else {
            serde_json::json!({ "cleared": 4 })
        };
        (axum::http::StatusCode::OK, payload)
    });

    let run = stub.run(&["job", "stop-all"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "Stopped 2 job(s): 00301, 00302\n");

    let run = stub.run(&["job", "clear", "--failed"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "Cleared 4 failed job(s).\n");

    let run = stub.run(&["job", "clear"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        run.stdout, "Cleared 4 completed job(s).\n",
        "a bare `clear` is the completed scope"
    );

    let run = stub.run(&["job", "clear", "--all", "--yes"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "Cleared 4 all job(s).\n");

    let clears: Vec<serde_json::Value> = stub
        .requests()
        .into_iter()
        .filter(|r| r.uri.starts_with("/api/jobs/clear"))
        .map(|r| r.body)
        .collect();
    assert_eq!(
        clears,
        vec![
            serde_json::json!({ "status": "failed" }),
            serde_json::json!({ "status": "completed" }),
            serde_json::json!({ "status": "all" }),
        ],
        "the scope travels in the body, and `--all` is only sent once confirmed"
    );
}

#[test]
fn stop_all_with_nothing_running_says_so() {
    let stub = Stub::new("stop-all-empty", |_, _| {
        (
            axum::http::StatusCode::OK,
            serde_json::json!({ "stopped": [] }),
        )
    });
    let run = stub.run(&["job", "stop-all"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "No jobs to stop.\n");
}

#[test]
fn maintenance_prints_the_daemons_report_verbatim() {
    let stub = Stub::new("maintenance", |method, uri| {
        assert_eq!((method, uri), ("POST", "/api/jobs/maintenance"));
        (
            axum::http::StatusCode::OK,
            serde_json::json!({ "timedOut": 1, "unblocked": ["00401"] }),
        )
    });

    let run = stub.run(&["job", "maintenance"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    let doc: serde_json::Value = serde_json::from_str(&run.stdout).expect("stdout is JSON");
    assert_eq!(doc["timedOut"], 1);
    assert_eq!(doc["unblocked"][0], "00401");
}

#[test]
fn delete_and_force_start_name_the_job_they_could_not_find() {
    let stub = Stub::new("not-found", |_, _| {
        (
            axum::http::StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "Job not found" }),
        )
    });

    let run = stub.run(&["job", "delete", "00501"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(run.stderr.contains("Job 00501 not found"), "{}", run.stderr);
    assert_eq!(stub.only_request().method, "DELETE");

    let run = stub.run(&["job", "force-start", "00502"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(run.stderr.contains("Job 00502 not found"), "{}", run.stderr);
}

#[test]
fn a_refused_force_start_surfaces_the_daemons_reason() {
    let stub = Stub::new("force-start-conflict", |_, _| {
        (
            axum::http::StatusCode::CONFLICT,
            serde_json::json!({ "error": "Job 00601 is already running" }),
        )
    });

    let run = stub.run(&["job", "force-start", "00601"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Job 00601 is already running"),
        "reqwest's generic status message would be useless here: {}",
        run.stderr
    );
}

#[test]
fn cancel_delete_and_force_start_confirm_success_by_name() {
    let stub = Stub::accepting("mutations-ok");

    let run = stub.run(&["job", "cancel", "00701", "-m", "no longer needed"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "Job 00701 cancelled.\n");

    let run = stub.run(&["job", "delete", "00702"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "Job 00702 deleted.\n");

    let run = stub.run(&["job", "force-start", "00703"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "Job 00703 force-started.\n");

    let requests = stub.requests();
    assert_eq!(requests[0].uri, "/api/jobs/00701/cancel");
    assert_eq!(requests[0].method, "POST");
    assert_eq!(
        requests[0].body,
        serde_json::json!({ "message": "no longer needed" })
    );
    assert_eq!(requests[1].uri, "/api/jobs/00702");
    assert_eq!(requests[1].method, "DELETE");
    assert_eq!(requests[2].uri, "/api/jobs/00703/force-start");
}

/// A 401 is opaque through `error_for_status`, so every arm names it. This is what an operator sees
/// when `.master` is stale in a way that keeps the port but loses the secret.
#[test]
fn an_unauthorized_daemon_is_named_rather_than_left_as_a_status_code() {
    let stub = Stub::new("unauthorized", |_, _| {
        (
            axum::http::StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "unauthorized" }),
        )
    });

    for args in [
        vec!["job", "list"],
        vec!["job", "cancel", "00801"],
        vec!["job", "delete", "00801"],
        vec!["job", "force-start", "00801"],
    ] {
        let run = stub.run(&args);
        assert_eq!(
            run.code,
            Some(1),
            "{:?}: {}{}",
            args,
            run.stdout,
            run.stderr
        );
        assert!(
            run.stderr.contains("Authentication failed"),
            "{:?}: {}",
            args,
            run.stderr
        );
    }

    // Telemetry names it too, but still exits 0.
    let run = stub.run(&["job", "status", "00801", "-m", "halfway"]);
    assert_eq!(run.code, Some(0), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("authentication failed"),
        "{}",
        run.stderr
    );
}

#[test]
fn a_delivered_status_and_failure_report_put_their_message_to_the_daemon() {
    let stub = Stub::accepting("telemetry-ok");

    let run = stub.run(&[
        "job",
        "status",
        "00901",
        "-m",
        "halfway",
        "--plan-id",
        "00456",
        "--plan-title",
        "Fix the thing",
    ]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "Status updated for job 00901\n");
    assert!(run.stderr.is_empty(), "{}", run.stderr);

    let run = stub.run(&["job", "fail", "00902", "-m", "the build broke"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, "Failure reported for job 00902\n");

    let requests = stub.requests();
    assert_eq!(
        requests[0].method, "PUT",
        "a report is idempotent, hence PUT"
    );
    assert_eq!(requests[0].uri, "/api/jobs/00901/status");
    assert_eq!(
        requests[0].body,
        serde_json::json!({
            "message": "halfway",
            "planId": "00456",
            "planTitle": "Fix the thing",
        })
    );
    assert_eq!(requests[1].method, "PUT");
    assert_eq!(requests[1].uri, "/api/jobs/00902/fail");
    assert_eq!(
        requests[1].body,
        serde_json::json!({ "message": "the build broke" })
    );

    // The optional plan identity is sent as an explicit null rather than omitted, which is what the
    // daemon's deserializer expects for an absent value.
    let run = stub.run(&["job", "status", "00903", "-m", "halfway"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        stub.requests()[2].body,
        serde_json::json!({ "message": "halfway", "planId": null, "planTitle": null })
    );
}

/// Every job type `build_job_args` accepts, submitted for real and checked on the wire. The CLI and
/// the MCP `tendril_start_job` tool share `build_job_args`, so this is also what stops the two front
/// ends drifting apart on required arguments.
#[test]
fn start_submits_every_job_type_with_its_required_arguments() {
    let stub = Stub::new("start-types", |_, _| {
        (
            axum::http::StatusCode::OK,
            serde_json::json!({ "jobId": "01001" }),
        )
    });
    let plan = stub.home.write_plan("09990-StartTypes");
    let plan = plan.to_string_lossy().to_string();

    let invocations: Vec<(&str, Vec<&str>)> = vec![
        ("ExecutePlan", vec!["ExecutePlan", &plan, "--note", "go"]),
        (
            "CreatePlan",
            vec![
                "CreatePlan",
                "--description",
                "Do the thing",
                "--project",
                "Tendril",
            ],
        ),
        (
            "RetryPlan",
            vec!["RetryPlan", &plan, "--change-request", "please fix"],
        ),
        (
            "UpdatePlan",
            vec!["UpdatePlan", &plan, "--instructions", "refine it"],
        ),
        ("ExpandPlan", vec!["ExpandPlan", &plan]),
        ("SplitPlan", vec!["SplitPlan", &plan]),
        ("CreatePr", vec!["CreatePr", &plan, "--reviewer", "alice"]),
        (
            "CreateIssue",
            vec!["CreateIssue", &plan, "--repo", "owner/repo"],
        ),
        ("SetupProject", vec!["SetupProject", "Tendril"]),
        ("AddProject", vec!["AddProject", "Tendril"]),
        ("SyncRepo", vec!["SyncRepo", "--repo-path", "/tmp/repo"]),
    ];
    assert_eq!(
        invocations.len(),
        JOB_TYPES.len(),
        "every job type in the help text needs a case here"
    );

    for (job_type, tail) in invocations {
        let mut args = vec!["job", "start"];
        args.extend(tail);
        let run = stub.run(&args);
        assert!(
            run.ok(),
            "{} should submit: {}{}",
            job_type,
            run.stdout,
            run.stderr
        );
        assert_eq!(run.stdout, "Job started: ID 01001\n", "{}", job_type);

        let request = stub.requests().pop().expect("a POST was recorded");
        assert_eq!(request.method, "POST");
        assert_eq!(request.uri, "/api/jobs");
        assert_eq!(
            request.body["type"], job_type,
            "the daemon reads the job type from the internally tagged args: {}",
            request.body
        );
        assert!(
            request.body["idempotencyKey"].is_string(),
            "an unkeyed submission still gets a key, so the POST is safe to replay: {}",
            request.body
        );
    }

    // `--case-insensitive` is not a flag; the *type* is matched case-insensitively, and the daemon
    // gets the canonical spelling back regardless.
    let run = stub.run(&["job", "start", "executeplan", &plan]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        stub.requests().pop().unwrap().body["type"],
        "ExecutePlan",
        "a lower-case job type is accepted and canonicalised"
    );
}

#[test]
fn start_reports_a_missing_per_type_argument_before_touching_the_daemon() {
    let stub = Stub::accepting("start-missing-args");
    let plan = stub.home.write_plan("09990-MissingArgs");
    let plan = plan.to_string_lossy().to_string();

    let cases: Vec<(Vec<&str>, &str)> = vec![
        (
            vec!["CreatePlan", "--project", "Tendril"],
            "--description is required for CreatePlan",
        ),
        (
            vec!["CreatePlan", "--description", "Do it"],
            "--project is required for CreatePlan",
        ),
        (vec!["ExecutePlan"], "<plan-id> is required for ExecutePlan"),
        (
            vec!["RetryPlan", &plan],
            "--change-request is required for RetryPlan",
        ),
        (
            vec!["UpdatePlan", &plan],
            "--instructions is required for UpdatePlan",
        ),
        (
            vec!["CreateIssue", &plan],
            "--repo is required for CreateIssue",
        ),
        (vec!["SyncRepo"], "--repo-path is required for SyncRepo"),
        (vec!["Bogus", &plan], "Unsupported job type: bogus"),
    ];

    for (tail, expected) in cases {
        let mut args = vec!["job", "start"];
        args.extend(tail.clone());
        let run = stub.run(&args);
        assert_eq!(
            run.code,
            Some(1),
            "{:?}: {}{}",
            tail,
            run.stdout,
            run.stderr
        );
        assert!(
            run.stderr.contains(expected),
            "{:?} should say {:?}: {}",
            tail,
            expected,
            run.stderr
        );
    }

    assert!(
        stub.requests().is_empty(),
        "an invalid submission must never reach the daemon: {:?}",
        stub.requests()
    );
}

/// The start options that do not belong to any one job type: they ride alongside the flattened job
/// args, and `--force` additionally becomes a query parameter because only `CreatePlan` carries
/// `force` in its body.
#[test]
fn start_sends_wait_for_priority_force_and_the_idempotency_key_on_the_wire() {
    let stub = Stub::new("start-options", |_, _| {
        (
            axum::http::StatusCode::OK,
            serde_json::json!({ "jobId": "01101" }),
        )
    });
    let plan = stub.home.write_plan("09990-StartOptions");
    let plan = plan.to_string_lossy().to_string();

    let run = stub.run(&[
        "job",
        "start",
        "ExecutePlan",
        &plan,
        "--wait-for",
        "00100",
        "--wait-for",
        "00101",
        "--priority",
        "9",
        "--force",
        "--idempotency-key",
        "retry-key-1",
    ]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);

    let request = stub.only_request();
    assert_eq!(
        request.uri, "/api/jobs?force=true",
        "--force has to reach the non-CreatePlan types as a query parameter"
    );
    assert_eq!(
        request.body["waitForJobs"],
        serde_json::json!(["00100", "00101"])
    );
    assert_eq!(request.body["priority"], 9);
    assert_eq!(
        request.body["idempotencyKey"], "retry-key-1",
        "an explicit key wins, because only the caller can make a retry reuse one"
    );
    assert_eq!(request.body["type"], "ExecutePlan");
}

/// A submission the daemon refuses because another job owns the plan. The daemon's own message names
/// that job, which is the whole point of unwrapping the 409.
#[test]
fn start_surfaces_the_daemons_conflict_message() {
    let stub = Stub::new("start-conflict", |_, _| {
        (
            axum::http::StatusCode::CONFLICT,
            serde_json::json!({ "error": "Job 01201 is already executing plan 00123" }),
        )
    });
    let plan = stub.home.write_plan("09990-Conflict");

    let run = stub.run(&["job", "start", "ExecutePlan", &plan.to_string_lossy()]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr
            .contains("Job 01201 is already executing plan 00123"),
        "{}",
        run.stderr
    );
}

// ---------------------------------------------------------------------------------------------
// Against the real daemon
// ---------------------------------------------------------------------------------------------

/// One happy path through the real `tendril_server` router, so the wire contract is covered by
/// something a stub cannot quietly diverge from: the job id in `job start`'s output really does come
/// out of the daemon, `job list` really does find it, and telemetry really is accepted.
///
/// The fixture home has no `Promptwares` folder, so the submitted job stops at the promptware gate
/// before any agent process is spawned. Nothing here depends on whether it is still in flight.
#[test]
fn a_real_daemon_accepts_a_submission_and_lists_it_back() {
    let home = Home::new("real-daemon");
    let plan = home.write_plan("09990-RealDaemon");
    let secret = "real-daemon-secret".to_string();

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    write_master(&home.path, port, &secret, "127.0.0.1", "http").unwrap();

    let (shutdown, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let state_home = home.path.clone();
    let plans_dir = home.plans_dir();
    let server = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            let state = Arc::new(tendril_server::AppState::with_plans_dir(
                state_home, plans_dir, secret,
            ));
            let app = tendril_server::create_router(state);
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await;
        });
    });

    let outcome = std::panic::catch_unwind(|| {
        let run = home.run(&["job", "start", "ExecutePlan", &plan.to_string_lossy()]);
        assert!(run.ok(), "start failed: {}{}", run.stdout, run.stderr);
        let job_id = run
            .stdout
            .trim()
            .strip_prefix("Job started: ID ")
            .unwrap_or_else(|| panic!("unexpected start output: {:?}", run.stdout))
            .to_string();
        assert!(
            !job_id.is_empty() && job_id.chars().all(|c| c.is_ascii_alphanumeric()),
            "the id must be the one the daemon allocated: {:?}",
            job_id
        );

        let run = home.run(&["job", "list", "--json"]);
        assert!(run.ok(), "list failed: {}{}", run.stdout, run.stderr);
        let jobs: serde_json::Value = serde_json::from_str(&run.stdout).expect("list --json");
        let found = jobs
            .as_array()
            .expect("a JSON array")
            .iter()
            .find(|j| j["id"] == serde_json::json!(job_id))
            .unwrap_or_else(|| panic!("job {} is not in the list: {}", job_id, run.stdout));
        assert_eq!(found["type"], "ExecutePlan");

        // Telemetry against a real daemon: accepted, and reported as accepted.
        let run = home.run(&["job", "status", &job_id, "-m", "halfway through"]);
        assert_eq!(run.code, Some(0), "{}{}", run.stdout, run.stderr);
        assert_eq!(
            run.stdout,
            format!("Status updated for job {}\n", job_id),
            "stderr was: {}",
            run.stderr
        );

        let run = home.run(&["job", "queue", "--json"]);
        assert!(run.ok(), "queue failed: {}{}", run.stdout, run.stderr);
        let queue: serde_json::Value = serde_json::from_str(&run.stdout).expect("queue --json");
        assert!(
            queue["maxConcurrent"].is_number() && queue["queued"].is_array(),
            "the queue payload shape the CLI renders from: {}",
            run.stdout
        );

        let run = home.run(&["job", "delete", &job_id]);
        assert!(run.ok(), "delete failed: {}{}", run.stdout, run.stderr);
        assert_eq!(run.stdout, format!("Job {} deleted.\n", job_id));
    });

    let _ = shutdown.send(());
    let _ = server.join();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// `Home::new` seeds `Plans/`, and nothing in this file may look outside its own fixture.
#[test]
fn the_fixture_never_points_at_a_real_tendril_home() {
    let home = Home::new("isolation");
    assert!(home.path.starts_with(std::env::temp_dir()));
    assert!(!home.path.join(".master").exists());
    let real = tendril_core::config::get_default_tendril_home();
    assert_ne!(home.path, real);
    assert!(!home.path.starts_with(Path::new(&real)));
}

// ---------------------------------------------------------------------------------------------
// `--status` validation (issue #135)
// ---------------------------------------------------------------------------------------------

/// A mistyped `--status` must be an error, not a silently dropped filter.
///
/// `GET /api/jobs` parses `?status=` with `and_then` (`tendril-server/src/routes/jobs.rs:25`), so an
/// unparseable value there means *no filter*: `job list --status Runing` used to answer with every
/// job and exit 0, which is the worst possible answer for a script asking "is anything running?".
/// The CLI therefore rejects the value before it ever reaches the daemon — which is also why this
/// test needs no daemon at all.
#[test]
fn job_list_rejects_an_unknown_status_before_calling_the_daemon() {
    let home = Home::new("bad-status");

    for bogus in ["Runing", "run", "complete", "cancelled", ""] {
        let run = home.run(&["job", "list", "--status", bogus]);
        assert_eq!(
            run.code,
            Some(1),
            "--status {:?} must fail rather than list everything: {}",
            bogus,
            run.stdout
        );
        assert!(
            run.stdout.is_empty(),
            "--status {:?} must print no table: {:?}",
            bogus,
            run.stdout
        );
        assert!(
            run.stderr
                .contains(&format!("Unknown job status '{}'", bogus)),
            "stderr must name the status it rejected: {}",
            run.stderr
        );
        // Rejected before the daemon lookup, so the message is about the status, not the daemon.
        assert!(
            !run.stderr.contains("No Tendril server is running"),
            "the value is validated before the daemon is contacted: {}",
            run.stderr
        );
        for valid in [
            "Pending",
            "Queued",
            "Running",
            "Completed",
            "Failed",
            "Timeout",
            "Stopped",
            "Blocked",
        ] {
            assert!(
                run.stderr.contains(valid),
                "the supported-status list must include {}: {}",
                valid,
                run.stderr
            );
        }
    }
}

/// The counterpart: a status that *is* valid gets past the guard, in any case, and then fails for the
/// only remaining reason — there is no daemon.
#[test]
fn job_list_accepts_every_supported_status() {
    let home = Home::new("good-status");

    for good in ["Running", "running", "RUNNING", "Timeout", "Blocked"] {
        let run = home.run(&["job", "list", "--status", good]);
        assert_eq!(run.code, Some(1), "no daemon, so this still fails");
        assert!(
            run.stderr.contains("No Tendril server is running"),
            "--status {} must reach the daemon lookup: {}",
            good,
            run.stderr
        );
    }
}
