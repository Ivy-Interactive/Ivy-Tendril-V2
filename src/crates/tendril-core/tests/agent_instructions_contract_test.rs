//! Pins the contract between `agents/agent_instructions.md` and the rest of the product.
//!
//! The asset is the only description of Tendril the interactive chat agent gets. When it names a
//! command, a flag, a plan field or a status that does not exist, the agent runs it, the command
//! fails, and the failure looks like the agent's fault. Three such drifts had already reached
//! `main` before this file existed.
//!
//! ## What can and cannot be checked from here
//!
//! `tendril-cli` depends on `tendril-core`, so this crate cannot depend on `tendril-cli` to build
//! its clap tree — and the binary's top-level `Cli` type is private to `tendril-cli` anyway, so
//! even a dependency in that direction would not expose the root command. `tendril-cli`'s own
//! `every_command_the_instructions_document_exists` is therefore the only place the *command paths*
//! can be walked against real clap metadata.
//!
//! What is checkable from here:
//!
//! * Anything the instructions say about types `tendril-core` owns — plan states, verification
//!   statuses, recommendation states, plan field names, job types. Those are exact assertions.
//! * Flags, by reading `tendril-cli`'s command modules as **text** out of the workspace. That is a
//!   weaker check than clap metadata — it proves the identifier is still declared in the right
//!   module, not that it is still spelled the same on the command line — but it is what catches a
//!   renamed or deleted flag, which is the drift that actually happened. It is skipped when the
//!   sibling source is not reachable (a packaged crate, a vendored build).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use tendril_core::agents::instructions::TEMPLATE;
use tendril_core::models::{
    JobArgs, PlanStatus, RecommendationStatus, SplitPlanArgs, VerificationStatus,
};
use tendril_core::plans::SUPPORTED_PLAN_FIELDS;

// ---------------------------------------------------------------------------------------------
// Markdown extraction
// ---------------------------------------------------------------------------------------------

/// The contents of every inline code span and fenced code block. Prose is skipped: `` `tendril
/// plan` CLI commands `` would otherwise read as a `plan commands` invocation.
fn code_snippets(markdown: &str) -> Vec<String> {
    let mut snippets = Vec::new();
    let mut in_fence = false;

    for line in markdown.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            snippets.push(line.to_string());
            continue;
        }
        let mut parts = line.split('`');
        parts.next();
        while let Some(span) = parts.next() {
            snippets.push(span.to_string());
            parts.next();
        }
    }

    snippets
}

/// One documented `tendril ...` invocation: the lowercase command path that leads it, and every
/// long flag named after it.
#[derive(Debug)]
struct Invocation {
    path: Vec<String>,
    flags: Vec<String>,
}

/// The long flag a token names, if any. `--flag=value`, `--flag`, and the trailing punctuation a
/// markdown table row leaves behind are all handled.
fn long_flag(token: &str) -> Option<String> {
    let name = token
        .strip_prefix("--")?
        .split(['=', '"', '<', ',', ')', '`', '|', '.', ';', ':'])
        .next()?;
    (!name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c == '-'))
        .then(|| name.to_string())
}

/// Extraction is **line-oriented**, because that is how the document associates a command with its
/// options: a table row names the command in one code span and its flags in later spans on the same
/// row. Taking the whole line as one context is what lets `` | `tendril plan doctor` | ... (`--fix`,
/// `--prs`) | `` be read as two flags on `plan doctor` rather than two orphans.
fn invocations(markdown: &str) -> Vec<Invocation> {
    let mut found = Vec::new();
    let mut in_fence = false;

    for line in markdown.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }

        // Inside a fence the whole line is code; outside it, only the backticked spans are.
        let code = if in_fence {
            line.to_string()
        } else {
            let mut spans = Vec::new();
            let mut parts = line.split('`');
            parts.next();
            while let Some(span) = parts.next() {
                spans.push(span.to_string());
                parts.next();
            }
            spans.join(" ")
        };

        let Some(rest) = code.split("tendril ").nth(1) else {
            continue;
        };

        let mut path = Vec::new();
        for token in rest.split_whitespace() {
            // A placeholder (`<plan-id>`), a literal job type (`CreatePlan`), a flag or prose all
            // end the command path.
            let is_command_word = !token.is_empty()
                && !token.starts_with('-')
                && token
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            if !is_command_word {
                break;
            }
            path.push(token.to_string());
        }
        if path.is_empty() {
            continue;
        }

        let flags = code.split_whitespace().filter_map(long_flag).collect();
        found.push(Invocation { path, flags });
    }

    found
}

// ---------------------------------------------------------------------------------------------
// Locating the sibling CLI source
// ---------------------------------------------------------------------------------------------

/// `tendril-cli/src/commands`, or `None` when this crate is being built away from its workspace.
fn cli_commands_dir() -> Option<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("tendril-cli")
        .join("src")
        .join("commands");
    dir.is_dir().then_some(dir)
}

/// Every `.rs` file under `dir`, at any depth, concatenated.
///
/// Recursive because a command module is not necessarily one file. `plan.rs` and `project.rs` are
/// each now a small facade over a `plan/` / `project/` directory, and a flag declared in
/// `plan/recommendations.rs` is every bit as declared as one that used to sit in `plan.rs`. A
/// non-recursive read reported twenty-two perfectly good flags as missing the moment that split
/// landed -- a test failing on where the code lives rather than on what it says.
fn rs_sources_under(dir: &Path) -> String {
    let mut out = String::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            out.push_str(&rs_sources_under(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push_str(&std::fs::read_to_string(&path).expect("readable module"));
        }
    }
    out
}

/// The full text of a command module: `<module>.rs` plus, when the module has been split, every
/// file in the `<module>/` directory beside it.
fn module_source(dir: &Path, module: &str) -> String {
    let mut source = std::fs::read_to_string(dir.join(format!("{module}.rs"))).unwrap_or_default();
    source.push_str(&rs_sources_under(&dir.join(module)));
    assert!(
        !source.is_empty(),
        "cannot read any source for command module {module}"
    );
    source
}

/// The command module a documented path belongs to. Root commands live in their own modules or, for
/// the ones declared inline in `main.rs`, nowhere this test can see — those return `None` and are
/// skipped rather than guessed at.
fn module_for(path: &[String]) -> Option<&'static str> {
    match path.first()?.as_str() {
        "plan" => Some("plan"),
        "job" => Some("job"),
        "chat" => Some("chat"),
        "project" => Some("project"),
        "vault" => Some("vault"),
        "verification" => Some("verification"),
        "promptware" => Some("promptware"),
        "config" => Some("config"),
        "db" => Some("db"),
        "reset" => Some("reset"),
        "update" => Some("update"),
        "update-promptwares" => Some("update_promptwares"),
        "report-bug" => Some("report_bug"),
        _ => None,
    }
}

/// A long flag is declared in the module if the module names it either as an explicit clap
/// `long = "..."` / `long_flag` string, or as the snake_case field clap derives it from.
fn declares_flag(source: &str, flag: &str) -> bool {
    let snake = flag.replace('-', "_");
    source.contains(&format!("\"{flag}\"")) || source.contains(&snake)
}

// ---------------------------------------------------------------------------------------------
// The flag contract
// ---------------------------------------------------------------------------------------------

#[test]
fn every_long_flag_the_instructions_document_is_declared_by_its_command_module() {
    let Some(dir) = cli_commands_dir() else {
        eprintln!("skipped: tendril-cli sources are not reachable from this build");
        return;
    };

    // Global to the binary, declared on `main.rs`'s private `Cli` rather than in any command
    // module, so no module would ever name them.
    const GLOBAL: [&str; 1] = ["home"];

    let mut checked = 0usize;
    let mut missing: Vec<String> = Vec::new();

    for invocation in invocations(TEMPLATE) {
        let Some(module) = module_for(&invocation.path) else {
            continue;
        };
        let source = module_source(&dir, module);

        for flag in &invocation.flags {
            if GLOBAL.contains(&flag.as_str()) {
                continue;
            }
            checked += 1;
            if !declares_flag(&source, flag) {
                missing.push(format!(
                    "`tendril {} --{}` — {}.rs declares no such option",
                    invocation.path.join(" "),
                    flag,
                    module
                ));
            }
        }
    }

    assert!(
        checked > 40,
        "only {checked} flags were checked — the snippet extraction is broken"
    );
    assert!(
        missing.is_empty(),
        "the agent instructions document flags that do not exist:\n  {}",
        missing.join("\n  ")
    );
}

/// The per-command check above can only attribute a flag to a command when the command is named on
/// the same line. The `tendril job start` matrix and the bullet lists that follow it name flags with
/// no command beside them, and those are the most-used flags in the document — so every long flag
/// anywhere in the asset is also checked against the union of the CLI's sources.
#[test]
fn no_long_flag_the_instructions_document_is_unknown_to_the_cli() {
    let Some(dir) = cli_commands_dir() else {
        eprintln!("skipped: tendril-cli sources are not reachable from this build");
        return;
    };

    let mut all_sources = rs_sources_under(&dir);
    // The root command's own options (`--home`, `--rebuild-search-index`, `--refresh`, `--tls-cert`)
    // are declared inline in `main.rs`, not in a command module.
    if let Some(main_rs) = dir.parent().map(|p| p.join("main.rs")) {
        all_sources.push_str(&std::fs::read_to_string(main_rs).expect("main.rs is readable"));
    }

    let documented: BTreeSet<String> = code_snippets(TEMPLATE)
        .iter()
        .flat_map(|s| {
            s.split_whitespace()
                .filter_map(long_flag)
                .collect::<Vec<_>>()
        })
        .collect();

    let unknown: Vec<&String> = documented
        .iter()
        .filter(|flag| !declares_flag(&all_sources, flag))
        .collect();

    assert!(
        documented.len() > 60,
        "only {} distinct flags were found — the snippet extraction is broken",
        documented.len()
    );
    assert!(
        unknown.is_empty(),
        "the agent instructions document flags the CLI does not declare anywhere: {unknown:?}"
    );
}

/// The three drifts that were found in the wild, pinned individually so a regression names itself.
#[test]
fn the_known_flag_drifts_stay_fixed() {
    // `verification set` takes `--new-name`/`--prompt`, not V1's `<field> <value>` positionals.
    assert!(
        TEMPLATE.contains("--new-name"),
        "`verification set` must document --new-name"
    );
    assert!(
        !TEMPLATE.contains("`tendril verification set <name> <field> <value>`"),
        "V1's `verification set <name> <field> <value>` signature no longer exists"
    );

    // `plan rec add` has `--description` and no `-d` short form.
    assert!(
        TEMPLATE.contains("--description"),
        "`plan rec add` must document --description"
    );
    for snippet in code_snippets(TEMPLATE) {
        assert!(
            !snippet.contains("rec add") || !snippet.contains("-d "),
            "`plan rec add` has no `-d` short form: {snippet}"
        );
    }

    // `promptware write-memory`/`write-tool` read stdin by default; `--stdin` is the explicit form.
    assert!(
        TEMPLATE.contains("`--stdin`"),
        "the stdin contract for write-memory/write-tool must be documented"
    );
}

// ---------------------------------------------------------------------------------------------
// Types `tendril-core` owns
// ---------------------------------------------------------------------------------------------

#[test]
fn the_documented_plan_states_are_exactly_the_real_ones() {
    const DOCUMENTED: [PlanStatus; 10] = [
        PlanStatus::Draft,
        PlanStatus::Creating,
        PlanStatus::Updating,
        PlanStatus::Executing,
        PlanStatus::Review,
        PlanStatus::Failed,
        PlanStatus::Completed,
        PlanStatus::Skipped,
        PlanStatus::Blocked,
        PlanStatus::Icebox,
    ];

    // The "Plan states:" line in Important Notes is the canonical list an agent reads back.
    let line = TEMPLATE
        .lines()
        .find(|l| l.contains("Plan states:"))
        .expect("Important Notes must list the plan states");

    for state in DOCUMENTED {
        assert!(
            line.contains(&format!("`{}`", state.as_str())),
            "plan state {} is missing from the documented list",
            state.as_str()
        );
        assert!(
            PlanStatus::from_str_loose(state.as_str()).is_some(),
            "documented plan state {} does not parse",
            state.as_str()
        );
    }

    // No extra: any backticked capitalised word on that line has to be a real state.
    for token in line.split('`').skip(1).step_by(2) {
        assert!(
            PlanStatus::from_str_loose(token).is_some(),
            "`{token}` is documented as a plan state but is not one"
        );
    }
}

#[test]
fn the_documented_verification_statuses_are_exactly_the_real_ones() {
    let line = TEMPLATE
        .lines()
        .find(|l| l.contains("Verification statuses:"))
        .expect("Important Notes must list the verification statuses");

    let documented: BTreeSet<&str> = line
        .split('`')
        .skip(1)
        .step_by(2)
        .filter(|t| VerificationStatus::from_str_loose(t).is_some())
        .collect();

    let real: BTreeSet<&str> = [
        VerificationStatus::Pending,
        VerificationStatus::Pass,
        VerificationStatus::Fail,
        VerificationStatus::Skipped,
    ]
    .iter()
    .map(|s| s.as_str())
    .collect();

    assert_eq!(
        documented, real,
        "the documented verification statuses have drifted from VerificationStatus"
    );
}

#[test]
fn the_documented_recommendation_states_are_the_real_ones() {
    for state in RecommendationStatus::ALL {
        assert!(
            TEMPLATE.contains(state),
            "recommendation state {state} is not documented"
        );
    }
}

#[test]
fn every_plan_field_the_instructions_name_is_readable() {
    // The "plan.yaml key fields:" line, which an agent uses to pick an argument for `plan get`.
    let line = TEMPLATE
        .lines()
        .find(|l| l.contains("plan.yaml key fields:"))
        .expect("Plan Structure must list the plan.yaml fields");

    let listed: Vec<&str> = line
        .split("key fields:**")
        .nth(1)
        .expect("the field list must follow the bolded label")
        .split(',')
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .collect();

    // `allocatedPorts` is read straight from plan.yaml by the CLI rather than through
    // `get_plan_field`, so it is legitimately absent from SUPPORTED_PLAN_FIELDS.
    const CLI_ONLY: [&str; 1] = ["allocatedPorts"];

    for field in &listed {
        assert!(
            CLI_ONLY.contains(field)
                || SUPPORTED_PLAN_FIELDS
                    .iter()
                    .any(|f| f.eq_ignore_ascii_case(field)),
            "the instructions name plan field `{field}`, but `plan get` cannot read it"
        );
    }

    for field in SUPPORTED_PLAN_FIELDS {
        assert!(
            listed.iter().any(|l| l.eq_ignore_ascii_case(field)),
            "`plan get` reads `{field}`, but the instructions never mention it"
        );
    }
}

#[test]
fn the_documented_list_field_output_shapes_match_the_code() {
    // Two of the seven list fields render `Key=Value` pairs; the other five render bare values.
    // An agent parses these, so the instructions have to name which is which.
    assert!(
        TEMPLATE.contains("`verifications` | `Name=Status`"),
        "`plan get <id> verifications` renders Name=Status and must say so"
    );
    assert!(
        TEMPLATE.contains("`recommendations` | `Title=State`"),
        "`plan get <id> recommendations` renders Title=State and must say so"
    );
    assert!(
        TEMPLATE.contains("one item per line"),
        "the one-item-per-line contract for list fields must be documented"
    );
    // The fix that made these fields return content rather than a blank line also made an unknown
    // field an error. Guidance written around the old behaviour would tell an agent to treat empty
    // output as "unknown field".
    assert!(
        TEMPLATE.contains("unrecognised field is an error"),
        "an unknown field errors rather than printing a blank line — that has to be documented"
    );
}

#[test]
fn every_documented_job_type_exists() {
    let real: BTreeSet<&str> = [
        "CreatePlan",
        "ExecutePlan",
        "RetryPlan",
        "ExpandPlan",
        "UpdatePlan",
        "SplitPlan",
        "CreatePr",
        "CreateIssue",
        "SetupProject",
        "SyncRepo",
        "AddProject",
    ]
    .into_iter()
    .collect();

    // Guard the list above against `JobArgs` growing a variant.
    let sample = JobArgs::SplitPlan(SplitPlanArgs {
        folder_path: String::new(),
    });
    assert!(
        real.contains(sample.job_type()),
        "JobArgs::job_type() returned an unlisted job type: {}",
        sample.job_type()
    );

    // The `tendril job start` matrix and the Promptwares table both enumerate the types.
    for job_type in &real {
        assert!(
            TEMPLATE.contains(&format!("`{job_type}`")),
            "job type {job_type} is not documented"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Behavioural promises
// ---------------------------------------------------------------------------------------------

#[test]
fn the_daemon_guidance_reflects_what_the_commands_actually_do() {
    // `job status`/`job fail` warn on stderr and exit 0 when the daemon is unreachable, so telling
    // an agent to guard them is worse than saying nothing: it adds a health check that can only
    // produce false negatives on the failure path.
    assert!(
        TEMPLATE.contains("exit 0"),
        "the instructions must say `job status`/`job fail` exit 0 without a daemon"
    );
    assert!(
        !TEMPLATE.contains("`tendril job start` and `tendril job status` require"),
        "`job status` no longer requires a running daemon"
    );
    // The daemon is started with `tendril run`, which the root command table has to name.
    assert!(
        TEMPLATE.contains("`tendril run`"),
        "the instructions must name `tendril run` as the way to start the daemon"
    );
}

#[test]
fn the_promptware_deployment_promise_is_documented() {
    // `tendril-server` deploys the standard promptwares on every startup, so an agent should not be
    // told to run `promptware deploy` before starting a job.
    assert!(
        TEMPLATE.contains("deploys the standard promptwares"),
        "the startup deployment has to be documented, or agents run `promptware deploy` needlessly"
    );
}

#[test]
fn the_plan_create_inheritance_promise_is_documented() {
    assert!(
        TEMPLATE.contains("inherits its project's repos"),
        "`plan create` seeds repos and verifications from the project — say so"
    );
    assert!(
        TEMPLATE.contains("PlanId:"),
        "`plan create`'s parseable stdout has to be documented"
    );
}

#[test]
fn the_home_option_placement_is_documented() {
    // `--home` is declared on the root command, so it has to precede the subcommand. Every agent
    // that reached for an isolated home wrote `tendril plan list --home ...` first.
    assert!(
        TEMPLATE.contains("before the subcommand"),
        "`--home` is a global option and its placement has to be documented"
    );
}

// ---------------------------------------------------------------------------------------------
// The asset's own shape
// ---------------------------------------------------------------------------------------------

#[test]
fn the_documented_home_layout_names_every_directory_the_instructions_reference() {
    // `Projects/` is referenced by the project-setup section, so the tree has to show it.
    for dir in ["Plans/", "Projects/", "Promptwares/", "Logs/Jobs/"] {
        assert!(
            TEMPLATE.contains(dir),
            "the Tendril home layout must show {dir}"
        );
    }
}

#[test]
fn every_example_passes_option_values_in_the_equals_form() {
    // The document tells the agent to use `--flag=value` because clap reads any token starting with
    // `-` as an option name, so a value beginning with a dash — a markdown bullet in a plan
    // description, a flag-like word in a change request — is mis-parsed and the command fails.
    // `--description "- Fix the login bug"` is a real failure, so every example has to obey the rule
    // the document states four sections earlier.
    //
    // The prose that states the rule has to show the wrong form to name it, so that one line is
    // exempt.
    let mut offenders = Vec::new();

    for snippet in code_snippets(TEMPLATE) {
        if snippet.contains("not `--description \"...\"`") {
            continue;
        }
        for invocation in snippet.split("tendril ").skip(1) {
            let tokens: Vec<&str> = invocation.split_whitespace().collect();
            for pair in tokens.windows(2) {
                let (flag, value) = (pair[0], pair[1]);
                // A value-taking long flag whose value was not glued on with `=`.
                if !flag.starts_with("--") || flag.contains('=') {
                    continue;
                }
                // `<placeholder>` and `"quoted text"` are values; a bare word could equally be the
                // next flag or prose, so only the unambiguous cases are flagged.
                if value.starts_with('"') || value.starts_with('<') {
                    offenders.push(format!("tendril {}", invocation.trim()));
                }
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "these examples pass an option value space-separated; use --flag=\"value\":\n  {}",
        offenders.join("\n  ")
    );
}
