//! `tendril agent-instructions` end-to-end, through the real binary — plus `tendril version`, the
//! other standalone command whose whole contract is the exact bytes it prints.
//!
//! `agent-instructions` output is piped straight into a coding agent's system prompt, so the shape of
//! stdout *is* the feature:
//!
//! * both `{TENDRIL_HOME}` and `{PLAN_FOLDER}` are substituted, and no placeholder survives — an
//!   agent handed a literal `{PLAN_FOLDER}` writes plans to a folder of that name;
//! * paths are normalised to forward slashes with no trailing separator, because the agent pastes
//!   them into shell commands and markdown;
//! * the command adds no newline of its own on top of the asset's single trailing one, and prints
//!   nothing else at all.

use std::path::{Path, PathBuf};
use std::process::Command;
use tendril_core::agents::instructions;

/// A throwaway `--home`, removed on drop.
struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-cli-agent-instructions-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(home.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(&home).expect("create fixture home");
        Self { home }
    }

    fn plans_dir(&self) -> PathBuf {
        self.home.join("Plans")
    }

    /// Runs `tendril --home <home> agent-instructions` and returns stdout, asserting a clean exit.
    fn instructions(&self) -> String {
        self.instructions_with(&self.home.to_string_lossy(), &[])
    }

    /// Runs the command with an explicit `--home` string and extra environment, so path normalisation
    /// and `TENDRIL_PLANS` can be exercised.
    fn instructions_with(&self, home_arg: &str, env: &[(&str, &str)]) -> String {
        let mut command = Command::new(env!("CARGO_BIN_EXE_tendril"));
        command
            .arg("--home")
            .arg(home_arg)
            .arg("agent-instructions")
            // `--home` already wins, but the ambient value points at a real installation.
            .env_remove("TENDRIL_HOME")
            .env_remove("TENDRIL_PLANS")
            .env_remove("TENDRIL_CONFIG");
        for (key, value) in env {
            command.env(key, value);
        }

        let output = command.output().expect("run tendril agent-instructions");
        let stdout = String::from_utf8(output.stdout).expect("stdout is utf-8");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success(),
            "agent-instructions failed: {}{}",
            stdout,
            stderr
        );
        assert_eq!(stderr, "", "nothing belongs on stderr");
        stdout
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// The command prints exactly the compiled template — no banner, no summary, no extra newline. Anything
/// added here becomes part of the agent's system prompt.
#[test]
fn stdout_is_the_compiled_template_byte_for_byte() {
    let fixture = Fixture::new("exact");
    let stdout = fixture.instructions();

    assert_eq!(
        stdout,
        instructions::compile(&fixture.home, &fixture.plans_dir()),
        "stdout must be exactly what `compile` returns"
    );
}

/// The asset ends with one newline and the command adds none, so the output must too. A `println!`
/// here would leave a trailing blank line inside the system prompt.
#[test]
fn no_newline_is_added_on_top_of_the_assets_own() {
    let fixture = Fixture::new("newline");
    let stdout = fixture.instructions();

    assert!(
        stdout.ends_with('\n'),
        "the asset's own trailing newline must survive"
    );
    assert!(
        !stdout.ends_with("\n\n"),
        "the command must not add a newline of its own"
    );
    assert_eq!(
        stdout.trim_end_matches('\n').len() + 1,
        stdout.len(),
        "exactly one trailing newline"
    );
    assert!(
        !stdout.starts_with('\n'),
        "nothing is printed before the template either"
    );
}

/// Both placeholders are filled in with this installation's paths, and nothing that looks like a
/// placeholder is left for the agent to read literally.
#[test]
fn both_placeholders_are_substituted_and_none_survive() {
    let fixture = Fixture::new("placeholders");
    let stdout = fixture.instructions();

    let home = fixture.home.to_string_lossy().to_string();
    let plans = fixture.plans_dir().to_string_lossy().to_string();

    assert!(
        stdout.contains(&format!("**TENDRIL_HOME**: `{}`", home)),
        "the home is not substituted: {}",
        first_lines(&stdout)
    );
    assert!(
        stdout.contains(&format!("**Plans folder**: `{}`", plans)),
        "the plans folder is not substituted: {}",
        first_lines(&stdout)
    );
    // The derived paths in the same block come from the same substitution.
    assert!(stdout.contains(&format!("**Config**: `{}/config.yaml`", home)));
    assert!(stdout.contains(&format!("**Database**: `{}/tendril.db`", home)));

    assert!(
        !stdout.contains("{TENDRIL_HOME}") && !stdout.contains("{PLAN_FOLDER}"),
        "an unsubstituted placeholder reached the agent"
    );

    // `{ID}`/`{SafeTitle}` are the document's own description of the plan folder naming scheme, so
    // only the two real placeholders are checked by name; this catches any other `{UPPER_SNAKE}` one.
    let leftovers = upper_snake_placeholders(&stdout);
    assert!(
        leftovers.is_empty(),
        "unsubstituted placeholders: {:?}",
        leftovers
    );
}

/// Every `{UPPER_SNAKE}` token in the text, minus the ones the document uses to describe itself.
fn upper_snake_placeholders(text: &str) -> Vec<&str> {
    const DOCUMENTED: [&str; 1] = ["{ID}"];

    text.match_indices('{')
        .filter_map(|(start, _)| {
            let rest = &text[start + 1..];
            let end = rest.find('}')?;
            let inner = &rest[..end];
            let looks_like_a_placeholder = !inner.is_empty()
                && inner
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit());
            let token = &text[start..start + end + 2];
            (looks_like_a_placeholder && !DOCUMENTED.contains(&token)).then_some(token)
        })
        .collect()
}

/// The substituted paths have to be usable verbatim in a shell command or a markdown link: forward
/// slashes, no trailing separator, no backslash anywhere for a shell to read as an escape.
#[test]
fn paths_are_normalised_before_substitution() {
    let fixture = Fixture::new("normalised");

    // A `--home` with a trailing separator is what a shell tab-completion hands over.
    let with_slash = format!("{}/", fixture.home.to_string_lossy());
    let stdout = fixture.instructions_with(&with_slash, &[]);

    assert!(
        stdout.contains(&format!(
            "**TENDRIL_HOME**: `{}`",
            fixture.home.to_string_lossy()
        )),
        "the trailing separator must be trimmed: {}",
        first_lines(&stdout)
    );
    assert!(
        !stdout.contains(&format!("{}//", fixture.home.to_string_lossy())),
        "a doubled separator reached the output: {}",
        first_lines(&stdout)
    );
    assert!(
        !stdout.contains('\\'),
        "a backslash would be read as a markdown or shell escape"
    );
    assert_eq!(
        stdout,
        instructions::compile(Path::new(&with_slash), &fixture.plans_dir()),
        "normalisation happens in `compile`, not in the command"
    );
}

/// The plans folder is this installation's, not a hard-coded `<home>/Plans`: an operator who moved it
/// with `planFolder` or `TENDRIL_PLANS` must see the folder the daemon actually uses.
#[test]
fn the_plans_folder_follows_this_installations_configuration() {
    let fixture = Fixture::new("plans-folder");

    let elsewhere = fixture.home.join("Moved").join("Plans");
    let stdout = fixture.instructions_with(
        &fixture.home.to_string_lossy(),
        &[("TENDRIL_PLANS", &elsewhere.to_string_lossy())],
    );
    assert!(
        stdout.contains(&format!(
            "**Plans folder**: `{}`",
            elsewhere.to_string_lossy()
        )),
        "TENDRIL_PLANS is ignored: {}",
        first_lines(&stdout)
    );

    // And through `config.yaml`'s `planFolder`, the form the app writes.
    let configured = Fixture::new("plans-configured");
    std::fs::write(
        configured.home.join("config.yaml"),
        "planFolder: '%TENDRIL_HOME%/CustomPlans'\n",
    )
    .unwrap();
    let stdout = configured.instructions();
    assert!(
        stdout.contains(&format!(
            "**Plans folder**: `{}/CustomPlans`",
            configured.home.to_string_lossy()
        )),
        "config.yaml's planFolder is ignored: {}",
        first_lines(&stdout)
    );
}

/// `--home` beats the ambient `TENDRIL_HOME`. This is what keeps every test in the suite off a real
/// installation, so it is worth an assertion of its own.
#[test]
fn an_explicit_home_beats_the_environment() {
    let fixture = Fixture::new("home-precedence");
    let ambient = Fixture::new("home-ambient");

    let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--home")
        .arg(&fixture.home)
        .arg("agent-instructions")
        .env("TENDRIL_HOME", &ambient.home)
        .env_remove("TENDRIL_PLANS")
        .output()
        .expect("run tendril agent-instructions");
    assert!(output.status.success());

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(
        stdout.contains(&format!(
            "**TENDRIL_HOME**: `{}`",
            fixture.home.to_string_lossy()
        )),
        "--home lost to TENDRIL_HOME: {}",
        first_lines(&stdout)
    );
    assert!(
        !stdout.contains(&ambient.home.to_string_lossy().to_string()),
        "the ambient home leaked into the output"
    );
}

/// A home that does not exist yet still produces instructions: this command is how an agent is told
/// where things *will* go, so it must not require them to be there, or create them.
#[test]
fn a_home_that_does_not_exist_yet_is_not_created() {
    let fixture = Fixture::new("missing-home");
    let missing = fixture.home.join("not-created-yet");

    let stdout = fixture.instructions_with(&missing.to_string_lossy(), &[]);
    assert!(stdout.contains(&format!(
        "**TENDRIL_HOME**: `{}`",
        missing.to_string_lossy()
    )));
    assert!(
        !missing.exists(),
        "printing instructions must not create a home"
    );
}

/// The document is the only description of the CLI the chat agent gets, so its shape matters as much
/// as its substitutions. That every `tendril ...` it names really exists is asserted by the binary's
/// own `every_command_the_instructions_document_exists`; this pins the sections an agent depends on
/// being able to find.
#[test]
fn the_template_keeps_the_sections_an_agent_navigates_by() {
    let fixture = Fixture::new("shape");
    let stdout = fixture.instructions();

    for expected in [
        "**TENDRIL_HOME**:",
        "**Plans folder**:",
        "tendril plan",
        "tendril job start",
        "tendril promptware write-memory",
        "tendril promptware write-tool",
    ] {
        assert!(
            stdout.contains(expected),
            "the instructions no longer mention {}",
            expected
        );
    }

    // The command tables are markdown, and an agent reads them as such.
    assert!(
        stdout.contains("| `tendril plan update <plan-id>` |"),
        "the command table rows have lost their shape"
    );
    // `--stdin` is documented for the write commands, and does exist on them; a table row promising a
    // flag the CLI rejects would send the agent into a loop.
    assert!(stdout.contains("(`--file`/`--stdin`)"));
}

fn first_lines(text: &str) -> String {
    text.lines().take(20).collect::<Vec<_>>().join("\n")
}

/// `tendril version` — one line, `tendril v<semver>`, matching the crate version the build was cut
/// from. Scripts and the doctor report parse this, and `--version` has to agree with it.
#[test]
fn version_prints_one_line_naming_the_crate_version() {
    let expected = format!("tendril v{}\n", env!("CARGO_PKG_VERSION"));

    let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("version")
        .env_remove("TENDRIL_HOME")
        .output()
        .expect("run tendril version");

    assert!(output.status.success(), "version must exit 0");
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        expected,
        "the exact output shape is `tendril v<version>` and nothing else"
    );
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");

    // `version` needs no home, and must not invent one.
    let missing = std::env::temp_dir().join(format!(
        "tendril-cli-version-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--home")
        .arg(&missing)
        .arg("version")
        .output()
        .expect("run tendril version");
    assert_eq!(String::from_utf8_lossy(&output.stdout), expected);
    assert!(!missing.exists(), "version must not create a home");

    // The clap `--version` flag reports the same version, in clap's own `<name> <version>` form.
    let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--version")
        .env_remove("TENDRIL_HOME")
        .output()
        .expect("run tendril --version");
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        format!("tendril {}\n", env!("CARGO_PKG_VERSION")),
        "--version must not drift from `version`"
    );
}
