//! Argument parsing for `tendril plan remove-pr`/`add-pr` and the top-level `tendril run`.
//!
//! Parsing only: no daemon is started and no plan is created. `PlanCommands` is public, so it is
//! exercised directly like `vault_cli_test.rs` does for `VaultCommands`. The top-level `Cli`/`Commands`
//! types in `main.rs` are private to the `tendril` binary crate, so `run`'s flags are instead checked
//! by spawning the compiled binary: a failing parse (e.g. a non-numeric `--port`) exits non-zero before
//! any port check, database open or server start, and `--help` lists the flags without running them.

use clap::{CommandFactory, Parser};
use tendril_cli::commands::plan::{PlanAddPrArgs, PlanCommands, PlanRemovePrArgs};

/// A minimal parser so `try_parse_from` can exercise the real derive output.
#[derive(Parser)]
#[command(name = "tendril")]
struct TestCli {
    #[command(subcommand)]
    command: PlanCommands,
}

fn parse(args: &[&str]) -> PlanCommands {
    TestCli::try_parse_from(args).expect("parse").command
}

#[test]
fn the_clap_definition_is_internally_consistent() {
    // Catches conflicting flags and malformed arg definitions at test time rather than on the
    // user's first `tendril plan --help`.
    TestCli::command().debug_assert();
}

#[test]
fn remove_pr_parses_reason_and_chat_session() {
    let PlanCommands::RemovePr(PlanRemovePrArgs {
        plan_id,
        url,
        reason,
        chat_session,
    }) = parse(&[
        "tendril",
        "remove-pr",
        "587",
        "https://github.com/owner/repo/pull/42",
        "--reason",
        "PR was closed without merging",
        "--chat-session",
        "session-123",
    ])
    else {
        panic!("expected remove-pr");
    };
    assert_eq!(plan_id, "587");
    assert_eq!(url, "https://github.com/owner/repo/pull/42");
    assert_eq!(reason, Some("PR was closed without merging".to_string()));
    assert_eq!(chat_session, Some("session-123".to_string()));
}

#[test]
fn remove_pr_reason_and_chat_session_are_optional() {
    let PlanCommands::RemovePr(PlanRemovePrArgs {
        reason,
        chat_session,
        ..
    }) = parse(&[
        "tendril",
        "remove-pr",
        "587",
        "https://github.com/owner/repo/pull/42",
    ])
    else {
        panic!("expected remove-pr");
    };
    assert_eq!(reason, None);
    assert_eq!(chat_session, None);
}

#[test]
fn remove_pr_without_a_url_fails_as_a_missing_argument() {
    match TestCli::try_parse_from(["tendril", "remove-pr", "587"]) {
        Ok(_) => panic!("expected a missing-argument error"),
        Err(err) => assert_eq!(err.kind(), clap::error::ErrorKind::MissingRequiredArgument),
    }
}

#[test]
fn add_pr_parses_reason_and_chat_session() {
    let PlanCommands::AddPr(PlanAddPrArgs {
        reason,
        chat_session,
        ..
    }) = parse(&[
        "tendril",
        "add-pr",
        "587",
        "https://github.com/owner/repo/pull/42",
        "--reason",
        "opened the fix",
        "--chat-session",
        "session-123",
    ])
    else {
        panic!("expected add-pr");
    };
    assert_eq!(reason, Some("opened the fix".to_string()));
    assert_eq!(chat_session, Some("session-123".to_string()));
}

/// A `tendril` invocation that must fail or return before touching a port, database or socket.
fn run_tendril(args: &[&str]) -> std::process::Output {
    std::process::Command::new(env!("CARGO_BIN_EXE_tendril"))
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("run tendril {:?}: {}", args, e))
}

#[test]
fn run_help_documents_port_and_host() {
    let out = run_tendril(&["run", "--help"]);
    assert!(out.status.success());
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert!(stdout.contains("--port"));
    assert!(stdout.contains("-p"));
    assert!(stdout.contains("--host"));
}

#[test]
fn run_rejects_a_non_numeric_port() {
    let out = run_tendril(&["run", "--port", "abc"]);
    assert!(!out.status.success());
    let stderr = String::from_utf8(out.stderr).unwrap();
    assert!(stderr.contains("--port") || stderr.contains("port"));
}

#[test]
fn run_rejects_an_unknown_flag() {
    let out = run_tendril(&["run", "--bogus"]);
    assert!(!out.status.success());
}
