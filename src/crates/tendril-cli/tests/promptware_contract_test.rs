//! The contract between the promptwares and the `tendril` CLI they shell out to.
//!
//! A promptware in `src/promptwares/**` is a markdown program a coding agent executes, and the only
//! way it drives Tendril is by running `tendril ...`. Nothing else in the build sees those command
//! lines, so a renamed subcommand or a dropped flag ships silently and only fails inside a live job,
//! hours later, with the plan already half-written. `main.rs`'s
//! `every_command_the_instructions_document_exists` walks command *paths* only, which is exactly how
//! `verification set <name> <field> <value>` and `plan rec add ... -d "..."` drifted into the shipped
//! promptwares.
//!
//! This test closes that gap in two halves:
//!
//! * **Parsing.** Every `tendril ...` invocation in `src/promptwares/**/*.md` and in the chat agent's
//!   instruction template is extracted, its placeholders (`<plan-id>`, `$PLAN_ID`, `[--base <b>]`,
//!   heredocs, `&&` chains, pipes, line continuations) are replaced with the concrete values an agent
//!   would type, and the resulting argv is handed to the real clap definition. The check is a spawn of
//!   the compiled binary with `--help` appended to the invocation: clap validates the subcommand path,
//!   every flag name, every flag's arity and the positional count, then short-circuits on `--help`
//!   before a single line of the command body runs. That keeps the check side-effect free (no daemon,
//!   no database, no `tendril reset`) while still being the real parser rather than a copy of it.
//! * **Output shape.** Where a promptware *parses* what a command printed — `plan add-worktree`'s
//!   first two lines are read as a path and a branch, `plan verification list --json` is walked in
//!   order — the format is pinned against a real invocation in an isolated temp home. Only the
//!   promptware-specific consumers live here: `output_contract_test.rs` owns the general stdout
//!   contract (`plan get`'s fields, `plan create`'s block, `plan list --format`, `verification
//!   get`/`list`, `project get`'s labels and bullets) and is not duplicated.
//!
//! Known-broken invocations are listed in `KNOWN_BROKEN` rather than left failing, so the suite stays
//! green while the breakage is recorded where the next contributor will trip over it. Removing an
//! entry from that list is the definition of done for fixing one, and
//! `known_broken_invocations_are_still_broken` fails if an entry is fixed but left behind.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// Invocations that do **not** parse against today's CLI, keyed by (repo-relative file, invocation as
/// written in the markdown). Each entry is a shipped promptware line that exits 2 the moment an agent
/// runs it, plus the change that would fix it. Fix the CLI (or the promptware) and delete the entry.
/// Invocations that do **not** parse against today's CLI, keyed by (repo-relative file, invocation as
/// written in the markdown). Each entry is a shipped promptware line that exits 2 the moment an agent
/// runs it, plus the change that would fix it. Fix the CLI (or the promptware) and delete the entry.
///
/// Empty, and worth keeping that way: every shipped promptware invocation parses. The three entries
/// this list was created with are fixed — the two `verification set` doc lines now use
/// `--new-name`/`--prompt`, and `plan rec add` got V1's `-d` short back.
const KNOWN_BROKEN: &[(&str, &str, &str)] = &[];

// ---------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------

/// One `tendril ...` command line lifted out of a markdown source.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Invocation {
    /// Repo-relative path, so a failure message can be pasted into an editor.
    file: String,
    /// 1-based line the command starts on.
    line: usize,
    /// The command exactly as the markdown writes it, placeholders and all.
    written: String,
    /// The argv after `tendril`, with placeholders resolved to values an agent would type.
    argv: Vec<String>,
}

/// The markdown that describes the CLI to an agent: every promptware program plus the chat-session
/// instruction template.
fn sources() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let promptwares = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../promptwares");
    collect_markdown(&promptwares, "src/promptwares", &mut out);
    assert!(
        !out.is_empty(),
        "no promptware markdown found under {:?} — the path is wrong and this test would pass \
         vacuously",
        promptwares
    );
    out.push((
        "src/crates/tendril-core/src/agents/agent_instructions.md".to_string(),
        tendril_core::agents::instructions::TEMPLATE.to_string(),
    ));
    // The chat turn's prompt is markdown too, and it is assembled in Rust rather than read from a file,
    // which is exactly why it escaped this test once already: it told the agent to pass
    // `--chat-session` to `tendril job start` for as long as that flag did not exist, so every job an
    // obedient agent started died on `error: unexpected argument '--chat-session' found` and the chat's
    // jobs menu was always empty. Built with a spawned job present so the block that describes them is
    // included rather than skipped.
    out.push((
        "src/crates/tendril-core/src/chat/execution.rs (build_chat_agent_prompt)".to_string(),
        tendril_core::chat::execution::build_chat_agent_prompt(
            &[],
            "make a test job",
            "sess-1",
            "user",
            &[tendril_core::chat::execution::ChatSpawnedJob {
                id: "00042".to_string(),
                job_type: "CreatePlan".to_string(),
                status: "Running".to_string(),
                plan_id: Some("00007".to_string()),
                plan_title: Some("Port The Chat".to_string()),
                status_message: None,
            }],
        ),
    ));
    out
}

fn collect_markdown(dir: &Path, label: &str, out: &mut Vec<(String, String)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        let child = format!("{label}/{name}");
        if path.is_dir() {
            collect_markdown(&path, &child, out);
        } else if path.extension().is_some_and(|e| e == "md") {
            out.push((
                child,
                std::fs::read_to_string(&path).expect("read markdown"),
            ));
        }
    }
}

/// A shell-ish fragment lifted out of the markdown, with the 1-based line it starts on.
struct Snippet {
    line: usize,
    text: String,
}

/// Fenced code-block bodies plus the contents of every inline code span.
///
/// A fenced line contributes both itself and its code spans: fences hold real command lines, but they
/// also hold heredoc bodies (`verification add Screenshots --prompt="$(cat <<'EOF'` ... `EOF`) whose
/// prose names further commands inside backticks. Prose outside a fence contributes only its spans,
/// because "use the `tendril plan` commands" would otherwise read as a `plan commands` invocation.
/// Backslash continuations are joined first, so the multi-line `plan create` block is checked as the
/// single command an agent actually runs.
fn snippets(markdown: &str) -> Vec<Snippet> {
    let lines: Vec<&str> = markdown.lines().collect();
    let mut out = Vec::new();
    let mut in_fence = false;
    let mut i = 0;

    while i < lines.len() {
        let raw = lines[i];
        if raw.trim_start().starts_with("```") {
            in_fence = !in_fence;
            i += 1;
            continue;
        }

        let line = i + 1;
        let mut joined = raw.trim_end().to_string();
        while in_fence && joined.ends_with('\\') {
            joined.pop();
            i += 1;
            match lines.get(i) {
                Some(next) => {
                    joined.push(' ');
                    joined.push_str(next.trim());
                }
                None => break,
            }
        }

        if in_fence {
            out.push(Snippet {
                line,
                text: joined.clone(),
            });
        }
        for span in code_spans(&joined) {
            out.push(Snippet { line, text: span });
        }
        i += 1;
    }

    out
}

/// The contents of a line's inline code spans, taken in pairs of backticks.
fn code_spans(line: &str) -> Vec<String> {
    let mut spans = Vec::new();
    let mut parts = line.split('`');
    parts.next();
    while let Some(span) = parts.next() {
        if !span.is_empty() {
            spans.push(span.to_string());
        }
        parts.next();
    }
    spans
}

/// Every invocation the sources describe, deduplicated by (file, line, command).
fn invocations() -> Vec<Invocation> {
    let mut out = BTreeSet::new();
    for (file, text) in sources() {
        let lines: Vec<&str> = text.lines().collect();
        for snippet in snippets(&text) {
            // Prose that *teaches a form is wrong* names a command that must not parse. The
            // instructions do this deliberately — e.g. "`tendril plan list --home /tmp/h` — the latter
            // fails with 'unexpected argument --home found'" — because `--home` is a root global and an
            // agent has to be told where it goes. Extraction cannot tell a counter-example from an
            // example, so a line that says something fails is skipped rather than asserted on.
            let counter_example = lines
                .get(snippet.line.saturating_sub(1))
                .is_some_and(|l| l.contains("fails"));
            if counter_example {
                continue;
            }
            for variant in expand_optionals(&snippet.text) {
                for (written, argv) in tendril_commands(&variant) {
                    if argv.is_empty() {
                        // A bare `tendril` reference in prose names no command.
                        continue;
                    }
                    // `tendril plan ...` in prose names a command family, not an invocation. A literal
                    // ellipsis is never something an agent types.
                    if argv.iter().any(|a| a == "...") {
                        continue;
                    }
                    out.insert(Invocation {
                        file: file.clone(),
                        line: snippet.line,
                        written,
                        argv,
                    });
                }
            }
        }
    }
    out.into_iter().collect()
}

/// Expands the docs' `[optional]` notation into the concrete command lines an agent would type:
/// `[--base <b>]` keeps its contents, `[--before=<o>|--after=<o>]` becomes one variant per
/// alternative (so both flags get checked), a trailing `...` is dropped, and the meta-placeholder
/// `[options]` disappears. Groups inside quotes are left alone — a `--condition="...[x]..."` value is
/// not option syntax.
fn expand_optionals(fragment: &str) -> Vec<String> {
    let chars: Vec<char> = fragment.chars().collect();
    let (mut single, mut double) = (false, false);

    for (i, c) in chars.iter().enumerate() {
        match c {
            '\'' if !double => single = !single,
            '"' if !single => double = !double,
            '[' if !single && !double => {
                let Some(close) = chars[i..].iter().position(|c| *c == ']').map(|p| p + i) else {
                    break;
                };
                let inner: String = chars[i + 1..close].iter().collect();
                let mut rest_start = close + 1;
                while chars.get(rest_start) == Some(&'.') {
                    rest_start += 1;
                }
                let head: String = chars[..i].iter().collect();
                let tail: String = chars[rest_start..].iter().collect();
                let alternatives: Vec<&str> = if inner.trim() == "options" {
                    vec![""]
                } else {
                    inner.split('|').collect()
                };
                return alternatives
                    .into_iter()
                    .flat_map(|alt| expand_optionals(&format!("{head}{alt}{tail}")))
                    .collect();
            }
            _ => {}
        }
    }

    vec![fragment.to_string()]
}

/// One shell word, or the separator that ends a command.
enum Token {
    Word(String),
    Separator,
}

/// Tokenizes a fragment the way the agent's shell would: quotes are stripped, `&&`/`||`/`|`/`;` end a
/// command, an unquoted `#` starts a comment, and redirections and heredoc markers (`<<'EOF'`) are
/// shell plumbing rather than CLI arguments, so they and everything after them are dropped. A lone
/// `<` is *not* plumbing: it opens the docs' `<plan-id>` placeholder notation.
fn tokenize(fragment: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut started = false;
    let (mut single, mut double) = (false, false);
    let mut chars = fragment.chars().peekable();

    macro_rules! flush {
        () => {
            if started {
                tokens.push(Token::Word(std::mem::take(&mut word)));
                started = false;
            }
        };
    }

    while let Some(c) = chars.next() {
        if single {
            if c == '\'' {
                single = false;
            } else {
                word.push(c);
            }
            continue;
        }
        if double {
            match c {
                '"' => double = false,
                '\\' => {
                    if let Some(next) = chars.next() {
                        word.push(next);
                    }
                }
                _ => word.push(c),
            }
            continue;
        }
        match c {
            '\'' => {
                single = true;
                started = true;
            }
            '"' => {
                double = true;
                started = true;
            }
            '\\' => {
                if let Some(next) = chars.next() {
                    word.push(next);
                    started = true;
                }
            }
            '#' if !started => break,
            // `<<'EOF'` is a heredoc and `> file` / `>> file` are redirections; `<name>` is a
            // placeholder and belongs to the word.
            '<' if chars.peek() == Some(&'<') => break,
            '<' => {
                word.push('<');
                started = true;
                // A placeholder can contain spaces — `--base <baseBranch from RepoConfigs>` is one
                // argument, not three — so it is consumed whole.
                for c in chars.by_ref() {
                    word.push(c);
                    if c == '>' {
                        break;
                    }
                }
            }
            '>' if !started => break,
            '&' | '|' | ';' => {
                flush!();
                while chars.peek() == Some(&c) {
                    chars.next();
                }
                tokens.push(Token::Separator);
            }
            c if c.is_whitespace() => flush!(),
            _ => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        tokens.push(Token::Word(word));
    }

    tokens
}

/// The `tendril` commands a fragment runs, as (command as written, argv after `tendril`).
fn tendril_commands(fragment: &str) -> Vec<(String, Vec<String>)> {
    let mut out = Vec::new();
    let mut current: Vec<String> = Vec::new();

    let finish = |words: Vec<String>, out: &mut Vec<(String, Vec<String>)>| {
        let mut words = words;
        // The docs write commands as `$ tendril ...` in places.
        if words.first().map(String::as_str) == Some("$") {
            words.remove(0);
        }
        if words.first().map(String::as_str) != Some("tendril") {
            return;
        }
        let written = render(&words);
        let argv = words[1..]
            .iter()
            .enumerate()
            // `words[i]` is the word before `words[i + 1]`, which is what this iteration yields.
            .filter_map(|(i, w)| substitute(w, words.get(i)))
            .collect();
        out.push((written, argv));
    };

    for token in tokenize(fragment) {
        match token {
            Token::Word(w) => current.push(w),
            Token::Separator => finish(std::mem::take(&mut current), &mut out),
        }
    }
    finish(current, &mut out);

    out
}

/// Re-renders tokenized words as a command line, re-quoting the words that needed quotes. This is the
/// `KNOWN_BROKEN` key and the text in a failure message, so it has to read like the markdown it came
/// from.
fn render(words: &[String]) -> String {
    words
        .iter()
        .map(|w| {
            if w.contains(char::is_whitespace) {
                format!("\"{w}\"")
            } else {
                w.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Options whose value clap parses as a number, so a placeholder has to become a digit rather than a
/// word or the invocation fails on the value instead of on the contract under test.
const NUMERIC_OPTIONS: &[&str] = &[
    "--priority",
    "--position",
    "--port",
    "--number",
    "--limit",
    "-p",
];

/// Replaces the docs' placeholder notation in one word with a value an agent would type. `None` drops
/// the word entirely (it was pure notation, e.g. an emptied `[options]`).
fn substitute(word: &str, previous: Option<&String>) -> Option<String> {
    let numeric = |name: &str| NUMERIC_OPTIONS.contains(&name);
    let (prefix, value) = match word.strip_prefix("--").and_then(|_| word.split_once('=')) {
        Some((flag, value)) => (format!("{flag}="), value.to_string()),
        None => (String::new(), word.to_string()),
    };
    let want_number = if prefix.is_empty() {
        previous.is_some_and(|p| numeric(p))
    } else {
        numeric(prefix.trim_end_matches('='))
    };
    let dummy = if want_number { "1" } else { "X" };

    let mut resolved = String::new();
    let mut rest = value.as_str();
    // `--prompt="$(cat <<'EOF'` and friends: a command substitution is a value, not CLI syntax.
    if let Some(head) = rest.split_once("$(").map(|(head, _)| head) {
        resolved.push_str(head);
        resolved.push_str(dummy);
        rest = "";
    }
    while !rest.is_empty() {
        match rest.find(['<', '$']) {
            Some(at) => {
                resolved.push_str(&rest[..at]);
                resolved.push_str(dummy);
                let after = &rest[at..];
                rest = if after.starts_with('<') {
                    // `<plan-id>`, and a stray unclosed `<` at end of a truncated doc line.
                    after.find('>').map_or("", |end| &after[end + 1..])
                } else {
                    // `$PLAN_ID` / `${PLAN_ID}`.
                    let end = after[1..]
                        .find(|c: char| !c.is_alphanumeric() && c != '_' && c != '{' && c != '}')
                        .map_or(after.len(), |p| p + 1);
                    &after[end..]
                };
            }
            None => {
                resolved.push_str(rest);
                rest = "";
            }
        }
    }

    if prefix.is_empty() && resolved.is_empty() {
        return None;
    }
    // A resolved value must not look like an option, or clap reads it as one.
    if prefix.is_empty() && resolved.starts_with('-') && !word.starts_with('-') {
        resolved.insert(0, 'X');
    }
    if !prefix.is_empty() && resolved.is_empty() {
        resolved.push_str(dummy);
    }
    Some(format!("{prefix}{resolved}"))
}

// ---------------------------------------------------------------------------------------------
// Parsing the extracted invocations against the real clap definition
// ---------------------------------------------------------------------------------------------

/// A throwaway home, so nothing here can read or write the developer's real Tendril installation —
/// the ambient `TENDRIL_HOME` on a dev machine points at a live V1 home.
fn scratch_home(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tendril-promptware-contract-{tag}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).expect("create scratch home");
    dir
}

/// Runs the compiled `tendril` against an isolated home, with the ambient Tendril environment
/// stripped so a developer's real installation and plans folder are invisible.
fn run_tendril(home: &Path, args: &[String]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--home")
        .arg(home)
        .args(args)
        .env("TENDRIL_HOME", home)
        .env_remove("TENDRIL_PLANS")
        .output()
        .unwrap_or_else(|e| panic!("spawn tendril {args:?}: {e}"))
}

/// Asks clap to parse `argv` and then stop. `--help` is handled after the path, the flags, their
/// arities and the positional count have all been validated, and before the command body runs, so a
/// clap usage error (exit 2) means the invocation is broken and success means it parses. Missing
/// required positionals are deliberately not an error: prose references a command by name
/// (``the `tendril plan add-commit` CLI command``) and that is not a bug.
fn parse_error(home: &Path, argv: &[String]) -> Option<String> {
    let attempt = |extra: &[&str]| -> Option<String> {
        let mut with_help = argv.to_vec();
        with_help.extend(extra.iter().map(|s| s.to_string()));
        with_help.push("--help".to_string());
        let out = run_tendril(home, &with_help);
        if out.status.success() {
            return None;
        }
        let stderr = String::from_utf8_lossy(&out.stderr);
        Some(
            stderr
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("(no diagnostic)")
                .to_string(),
        )
    };

    let error = attempt(&[])?;
    // Prose names a flag without its value — ``never call `tendril job status --plan-id` with a value
    // you did not receive`` — which is the same shorthand as naming a command without its positionals.
    // The flag existing is what matters, so retry with a value supplied.
    if error.contains("a value is required for") {
        return attempt(&["X"]);
    }
    Some(error)
}

/// Every extracted invocation that does not parse, in source order.
fn parse_failures(home: &Path) -> Vec<(Invocation, String)> {
    let mut cache: BTreeMap<Vec<String>, Option<String>> = BTreeMap::new();
    let mut failures = Vec::new();
    for invocation in invocations() {
        let error = cache
            .entry(invocation.argv.clone())
            .or_insert_with(|| parse_error(home, &invocation.argv))
            .clone();
        if let Some(error) = error {
            failures.push((invocation, error));
        }
    }
    failures
}

fn is_known_broken(invocation: &Invocation) -> bool {
    KNOWN_BROKEN
        .iter()
        .any(|(file, written, _)| *file == invocation.file && *written == invocation.written)
}

/// The load-bearing test: every `tendril ...` line the promptwares tell an agent to run has to parse
/// against the shipped CLI, flags included.
#[test]
fn every_promptware_invocation_parses() {
    let home = scratch_home("parse");
    let invocations = invocations();

    // Extraction silently returning nothing is the one way this test can pass while checking
    // nothing, so the corpus size is asserted rather than trusted.
    assert!(
        invocations.len() > 150,
        "only {} invocations were extracted from the promptwares — the extraction is broken, not \
         the CLI",
        invocations.len()
    );
    let commands: BTreeSet<&str> = invocations
        .iter()
        .filter_map(|i| i.argv.first().map(String::as_str))
        .collect();
    for expected in ["plan", "job", "project", "verification", "promptware"] {
        assert!(
            commands.contains(expected),
            "no `tendril {expected} ...` invocation was extracted — the extraction is broken"
        );
    }

    let failures = parse_failures(&home);
    let _ = std::fs::remove_dir_all(&home);

    let unexpected: Vec<_> = failures
        .iter()
        .filter(|(invocation, _)| !is_known_broken(invocation))
        .collect();

    assert!(
        unexpected.is_empty(),
        "{} promptware invocation(s) do not parse against this CLI. An agent running one gets a \
         clap usage error (exit 2) and the job dies mid-plan. Fix the CLI or the promptware — or, if \
         the breakage is being accepted for now, add it to KNOWN_BROKEN in {} with the fix it needs.\
         \n\n{}",
        unexpected.len(),
        file!(),
        unexpected
            .iter()
            .map(|(invocation, error)| format!(
                "  {}:{}\n    invocation: {}\n    argv:       tendril {}\n    error:      {}",
                invocation.file,
                invocation.line,
                invocation.written,
                invocation.argv.join(" "),
                error
            ))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}

/// The allow-list has to rot loudly. An entry that now parses means the bug was fixed and the entry
/// is stale; an entry that matches nothing means the promptware line was reworded or deleted.
#[test]
fn known_broken_invocations_are_still_broken() {
    let home = scratch_home("known-broken");
    let failures = parse_failures(&home);
    let _ = std::fs::remove_dir_all(&home);

    let all = invocations();
    for (file, written, why) in KNOWN_BROKEN {
        let matched: Vec<_> = all
            .iter()
            .filter(|i| i.file == *file && i.written == *written)
            .collect();
        assert!(
            !matched.is_empty(),
            "KNOWN_BROKEN names an invocation that no longer appears in {file}:\n  {written}\n\
             ({why})\nIf the promptware was reworded, update or delete the entry."
        );
        for invocation in matched {
            assert!(
                failures.iter().any(|(f, _)| f == invocation),
                "KNOWN_BROKEN entry now parses, so it is fixed and the entry is stale — delete it \
                 from {}:\n  {}:{}\n  {}\n  ({})",
                file!(),
                invocation.file,
                invocation.line,
                written,
                why
            );
        }
    }
}

/// The agent-instruction template documents flags in the description column of its command tables
/// (`` `tendril plan get-revision <plan-id>` | Print revision content (latest by default, or
/// `--number <n>`) ``). Those flags never appear in an argv, so the parse test above cannot see them,
/// and `--stdin` on `promptware write-memory` was documented before it existed. Each documented flag
/// has to exist on the command it is documented against.
#[test]
fn flags_documented_in_the_instruction_tables_exist() {
    let home = scratch_home("doc-flags");
    let template = tendril_core::agents::instructions::TEMPLATE;
    let mut checked = 0usize;
    let mut missing = Vec::new();

    for (index, line) in template.lines().enumerate() {
        let line = line.trim();
        if !line.starts_with('|') {
            continue;
        }
        let mut columns = line.split('|').filter(|c| !c.trim().is_empty());
        let Some(first) = columns.next() else {
            continue;
        };
        let spans = code_spans(first);
        let [command] = spans.as_slice() else {
            continue;
        };
        let Some(path) = command_path(command) else {
            continue;
        };

        let flags: BTreeSet<String> = columns
            .flat_map(code_spans)
            .flat_map(|span| {
                span.split_whitespace()
                    .filter(|w| w.starts_with('-') && w.len() > 1)
                    // The instructions write a flag with its example value attached — `--prompt="<text>"`
                    // — because a value beginning with `-` is otherwise read as an option name. Only the
                    // name is a contract, so compare that: `--help` renders the value its own way.
                    .map(|w| {
                        let name = w.split('=').next().unwrap_or(w);
                        name.trim_end_matches([',', '.', ')', '"']).to_string()
                    })
                    .filter(|w| w.len() > 1)
                    .collect::<Vec<_>>()
            })
            .collect();
        if flags.is_empty() {
            continue;
        }

        let mut help_argv = path.clone();
        help_argv.push("--help".to_string());
        let out = run_tendril(&home, &help_argv);
        let help = String::from_utf8_lossy(&out.stdout).to_string();
        for flag in flags {
            checked += 1;
            if !help.contains(&flag) {
                missing.push(format!(
                    "  src/crates/tendril-core/src/agents/agent_instructions.md:{}\n    \
                     `tendril {}` is documented as taking `{}`, but that flag is not in its --help",
                    index + 1,
                    path.join(" "),
                    flag
                ));
            }
        }
    }

    let _ = std::fs::remove_dir_all(&home);
    assert!(
        checked > 10,
        "only {checked} documented flags were checked — the table extraction is broken"
    );
    assert!(
        missing.is_empty(),
        "the agent instructions document flags that do not exist. An agent told about a flag will \
         use it, and clap will exit 2.\n\n{}",
        missing.join("\n\n")
    );
}

/// The leading subcommand path of a documented command: the run of plain lowercase tokens before the
/// first placeholder or value (`tendril plan verification list <plan-id>` -> `plan verification
/// list`).
fn command_path(command: &str) -> Option<Vec<String>> {
    let mut words = command.split_whitespace();
    if words.next() != Some("tendril") {
        return None;
    }
    let path: Vec<String> = words
        .take_while(|w| {
            !w.is_empty()
                && w.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
        .map(str::to_string)
        .collect();
    (!path.is_empty()).then_some(path)
}

// ---------------------------------------------------------------------------------------------
// Output shapes the promptwares parse
// ---------------------------------------------------------------------------------------------

/// An isolated Tendril home with one project, one verification and one git repo whose `origin` is a
/// local bare clone — enough to create plans and cut worktrees with no network and nothing outside the
/// temp directory.
struct Fixture {
    home: PathBuf,
    repo: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

impl Fixture {
    fn new(tag: &str) -> Fixture {
        let home = scratch_home(tag);
        std::fs::create_dir_all(home.join("Plans")).unwrap();
        let repo = home.join("repo");
        let origin = home.join("origin.git");
        std::fs::create_dir_all(&repo).unwrap();

        git(
            &home,
            &["init", "--quiet", "--bare", origin.to_str().unwrap()],
        );
        git(&repo, &["init", "--quiet", "-b", "main"]);
        git(&repo, &["commit", "--quiet", "--allow-empty", "-m", "init"]);
        git(
            &repo,
            &["remote", "add", "origin", origin.to_str().unwrap()],
        );
        git(&repo, &["push", "--quiet", "origin", "main"]);

        let fixture = Fixture { home, repo };
        fixture.ok(&[
            "verification",
            "add",
            "Build",
            "--prompt=Run the build and report Pass or Fail.",
        ]);
        fixture.ok(&["project", "add", "Demo"]);
        fixture.ok(&["project", "add-verification", "Demo", "Build", "--required"]);
        fixture.ok(&[
            "project",
            "add-repo",
            "Demo",
            fixture.repo.to_str().unwrap(),
        ]);
        fixture
    }

    fn run(&self, args: &[&str]) -> Output {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        run_tendril(&self.home, &args)
    }

    /// Runs a command that must succeed and returns its stdout.
    fn ok(&self, args: &[&str]) -> String {
        let out = self.run(args);
        assert!(
            out.status.success(),
            "tendril {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).expect("utf-8 stdout")
    }

    /// Creates the fixture plan and returns its id.
    fn create_plan(&self, title: &str) -> String {
        let plans_dir = self.home.join("Plans");
        let stdout = self.ok(&[
            "plan",
            "create",
            title,
            "Demo",
            &format!("--plans-dir={}", plans_dir.display()),
            "--level=Feature",
            "--initial-prompt=do the thing",
            "--execution-profile=balanced",
        ]);
        // `plan create`'s own `PlanId:` / `Directory:` / `Verifications:` block is pinned by
        // `output_contract_test.rs::plan_create_prints_the_id_directory_and_seeded_verifications`;
        // here it is only read the way CreatePlan reads it, to get an id for the tests below.
        stdout
            .lines()
            .next()
            .and_then(|l| l.strip_prefix("PlanId: "))
            .unwrap_or_else(|| panic!("`plan create` must print `PlanId: <id>` first:\n{stdout}"))
            .to_string()
    }
}

fn git(cwd: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        // A developer's global config (signing, hooks, default branch) must not change the fixture.
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Tendril Test")
        .env("GIT_AUTHOR_EMAIL", "test@tendril.invalid")
        .env("GIT_COMMITTER_NAME", "Tendril Test")
        .env("GIT_COMMITTER_EMAIL", "test@tendril.invalid")
        .output()
        .unwrap_or_else(|e| panic!("spawn git {args:?}: {e}"));
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// `ExecutePlan` and `RetryPlan` get their run-set from `tendril plan verification list <plan-id>
/// --json`: "a JSON array of `{ name, status }` **in run order**", filtered on `Pending` and
/// `Skipped`.
#[test]
fn plan_verification_list_json_is_an_ordered_name_status_array() {
    let fixture = Fixture::new("run-set");
    fixture.ok(&["verification", "add", "Test", "--prompt=Run the tests."]);
    fixture.ok(&["project", "add-verification", "Demo", "Test", "--required"]);
    let id = fixture.create_plan("Run Set Plan");
    fixture.ok(&["plan", "set-verification", &id, "Test", "Skipped"]);

    let json = fixture.ok(&["plan", "verification", "list", &id, "--json"]);
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("must be JSON");
    let entries = parsed.as_array().expect("must be a JSON array");
    let pairs: Vec<(&str, &str)> = entries
        .iter()
        .map(|e| {
            (
                e["name"].as_str().expect("each entry needs `name`"),
                e["status"].as_str().expect("each entry needs `status`"),
            )
        })
        .collect();
    assert_eq!(
        pairs,
        vec![("Build", "Pending"), ("Test", "Skipped")],
        "`plan verification list --json` must be `{{name, status}}` in the project's configured run \
         order — the promptwares run the array in order and skip `Skipped`:\n{json}"
    );
}

/// `ExecutePlan` step 2 takes the worktree path from `add-worktree`'s own output ("never assume a
/// depth") and needs the branch it cut. The first two lines are the whole contract.
#[test]
fn plan_add_worktree_reports_the_path_then_the_branch() {
    let fixture = Fixture::new("worktree");
    let id = fixture.create_plan("Worktree Shape Plan");

    let out = fixture.ok(&[
        "plan",
        "add-worktree",
        &id,
        fixture.repo.to_str().unwrap(),
        "--base",
        "main",
    ]);
    let mut lines = out.lines();
    let path = lines
        .next()
        .and_then(|l| l.strip_prefix("Worktree created: "))
        .unwrap_or_else(|| {
            panic!("`plan add-worktree` must print `Worktree created: <path>` first:\n{out}")
        });
    assert!(
        Path::new(path).join(".git").exists(),
        "the reported worktree path must be the usable worktree ExecutePlan then builds in: {path}"
    );
    let branch = lines
        .next()
        .and_then(|l| l.strip_prefix("Branch: "))
        .unwrap_or_else(|| {
            panic!("`plan add-worktree` must print `Branch: <branch>` second:\n{out}")
        });
    assert!(
        branch.starts_with("tendril/"),
        "the branch must be the `tendril/<planFolderName>` name ExecutePlan and CreatePr push: \
         {branch}"
    );

    // Same shape on the way out — CreatePr's closeout prints it.
    let removed = fixture.ok(&["plan", "remove-worktree", &id, "repo"]);
    assert!(
        removed.starts_with("Worktree removed: ") || removed.starts_with("Worktree directory"),
        "`plan remove-worktree` must say what it did:\n{removed}"
    );
}

/// The `Screenshots` verification `SetupProject` installs runs `tendril project get "<project>"` and
/// "pick[s] the first review action whose condition holds", then launches that action's command — so
/// both the name and the command have to survive into `project get`'s output. The labels and bullets
/// of the rest of that block are pinned by `output_contract_test.rs::project_list_and_get_output_shape`;
/// what is unique here is the review-action section and its ranked form.
#[test]
fn project_get_and_review_actions_expose_the_command_to_launch() {
    let fixture = Fixture::new("review-actions");
    fixture.ok(&[
        "project",
        "add-review-action",
        "Demo",
        "App",
        "--command=pnpm dev",
        "--condition=Test-Path \"Worktrees/repo\"",
        "--paths=src/app",
    ]);

    let out = fixture.ok(&["project", "get", "Demo"]);
    assert!(
        out.contains("App") && out.contains("pnpm dev"),
        "the review action's name and command must both be visible — the Screenshots verification \
         launches the command it reads here:\n{out}"
    );

    // The ranked form the same step uses to choose an action for a plan.
    let id = fixture.create_plan("Review Action Plan");
    let ranked = fixture.run(&["project", "review-actions", "Demo", &format!("--plan={id}")]);
    assert!(
        ranked.status.success(),
        "`project review-actions <project> --plan=<id>` must work on a fresh plan: {}",
        String::from_utf8_lossy(&ranked.stderr)
    );
    assert!(
        String::from_utf8_lossy(&ranked.stdout).contains("App"),
        "the ranking must name the review actions it ranked:\n{}",
        String::from_utf8_lossy(&ranked.stdout)
    );
}

/// `UpdatePlan`, `ExpandPlan`, `RetryPlan` and `SplitPlan` all read the current revision with
/// `tendril plan get-revision <plan-id>` and write the next one with `plan write-revision --file` /
/// `--stdin`. The round trip has to be byte-exact: the agent edits what it reads.
#[test]
fn write_revision_and_get_revision_round_trip_verbatim() {
    let fixture = Fixture::new("revision");
    let id = fixture.create_plan("Revision Shape Plan");

    let revision = "# Revision Shape Plan\n\n## Problem\n\nIt is `broken`.\n";
    let file = fixture.home.join("revision.md");
    std::fs::write(&file, revision).unwrap();
    fixture.ok(&[
        "plan",
        "write-revision",
        &id,
        &format!("--file={}", file.display()),
        "--reason=pinning the output shape",
    ]);

    let read_back = fixture.ok(&["plan", "get-revision", &id]);
    assert_eq!(
        read_back.trim_end_matches('\n'),
        revision.trim_end_matches('\n'),
        "`plan get-revision` must return the revision verbatim — the promptwares hand it straight \
         back to the agent as the plan to implement"
    );
}
