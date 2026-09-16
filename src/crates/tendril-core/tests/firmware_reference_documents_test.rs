//! Pins the firmware's `## Reference Documents` section against the promptwares that cite it.
//!
//! Seven shipped promptwares tell the agent to consult that section — ten times between them, for
//! load-bearing detail like the question-block schema and the plan link rules. For a while the
//! firmware template emitted no such section, so an agent following its instructions went looking
//! for guidance it had never been given and could not tell whether the section was missing or it
//! had misread its own prompt.
//!
//! The valuable test here is [`every_reference_documents_citation_names_a_real_heading`]: it walks
//! every citation in `src/promptwares/**/Program.md`, resolves the heading each one names, and
//! asserts the *compiled firmware for that promptware* actually contains it. That is what stops the
//! gap reopening — whether by deleting the section, renaming a heading inside it, or adding a
//! citation to a heading that was never written.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use tendril_core::promptware::{
    cites_reference_documents, compile_firmware, compile_firmware_with_skills, PLAN_REFERENCE,
};

// ---------------------------------------------------------------------------------------------
// Locating the shipped promptwares
// ---------------------------------------------------------------------------------------------

/// The workspace's `src/promptwares`, found by walking up from this crate. `None` when this crate is
/// built away from its workspace (a packaged crate, a vendored build), in which case the
/// promptware-facing tests skip rather than fail.
fn promptwares_dir() -> Option<PathBuf> {
    let mut dir: &Path = &PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        let candidate = dir.join("src").join("promptwares");
        if candidate.join("ExecutePlan").join("Program.md").is_file() {
            return Some(candidate);
        }
        dir = dir.parent()?;
    }
}

/// Every shipped promptware folder that has a `Program.md`, by name.
fn shipped_promptwares(dir: &Path) -> BTreeMap<String, PathBuf> {
    let mut found = BTreeMap::new();
    for entry in std::fs::read_dir(dir).expect("promptwares dir is readable") {
        let path = entry.expect("readable dir entry").path();
        if path.join("Program.md").is_file() {
            let name = path
                .file_name()
                .expect("promptware folder has a name")
                .to_string_lossy()
                .to_string();
            found.insert(name, path);
        }
    }
    assert!(
        found.len() >= 10,
        "only {} promptwares were found — the discovery walk is broken",
        found.len()
    );
    found
}

fn compile(program_folder: &Path) -> String {
    compile_firmware(program_folder, &Default::default())
        .unwrap_or_else(|e| panic!("failed to compile {}: {e}", program_folder.display()))
}

/// A throwaway promptware folder holding just a `Program.md`, cleaned up on drop. Follows the same
/// `temp_dir()` + uuid convention as `promptware_overlay_test`, so the crate keeps one temp-dir
/// idiom rather than gaining a `tempfile` dependency for three tests.
struct Fixture {
    root: PathBuf,
    folder: PathBuf,
}

impl Fixture {
    fn new(name: &str, program: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-firmware-reference-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let folder = root.join(name);
        std::fs::create_dir_all(&folder).expect("create promptware folder");
        std::fs::write(folder.join("Program.md"), program).expect("write Program.md");
        Fixture { root, folder }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

// ---------------------------------------------------------------------------------------------
// Headings and citations
// ---------------------------------------------------------------------------------------------

/// Every ATX heading in a markdown document, by its text. Content inside a fenced code block is
/// skipped: the reference section documents `# {title}` H1s and shell prompts, and neither is a
/// heading of the firmware.
fn headings(markdown: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut fence: Option<usize> = None;

    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('`') {
            let ticks = trimmed.chars().take_while(|c| *c == '`').count();
            if ticks >= 3 {
                match fence {
                    // A closing fence is at least as long as the one it closes and carries no info
                    // string, which is what keeps the nested ```` ```questions ```` samples from
                    // ending their outer fence early.
                    Some(open) if ticks >= open && trimmed[ticks..].trim().is_empty() => {
                        fence = None;
                    }
                    None => fence = Some(ticks),
                    _ => {}
                }
                continue;
            }
        }
        if fence.is_some() {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('#') {
            let text = rest.trim_start_matches('#').trim();
            if !text.is_empty() {
                found.insert(text.to_string());
            }
        }
    }

    found
}

/// The heading names a `Program.md` sends the agent to.
///
/// Every citation implies the section itself. A citation of the form "the **X** section of
/// **Reference Documents**" also names the subsection `X`, which is how the question-block rules are
/// referenced from six different promptwares.
fn cited_headings(program: &str) -> BTreeSet<String> {
    let mut cited = BTreeSet::new();
    if !cites_reference_documents(program) {
        return cited;
    }
    cited.insert("Reference Documents".to_string());

    // `**X** section of **Reference Documents**`, matched without a regex dependency.
    const NEEDLE: &str = "** section of **Reference Documents**";
    let mut rest = program;
    while let Some(at) = rest.find(NEEDLE) {
        let before = &rest[..at];
        if let Some(open) = before.rfind("**") {
            let name = &before[open + 2..];
            if !name.is_empty() && !name.contains('\n') {
                cited.insert(name.to_string());
            }
        }
        rest = &rest[at + NEEDLE.len()..];
    }

    cited
}

// ---------------------------------------------------------------------------------------------
// The section exists
// ---------------------------------------------------------------------------------------------

#[test]
fn a_citing_promptware_gets_the_reference_documents_section() {
    let fx = Fixture::new(
        "CitingPromptware",
        "The plan structure and CLI commands are in the **Reference Documents** section of your \
         firmware.\n",
    );

    let firmware = compile(&fx.folder);

    assert!(
        firmware.contains("\n## Reference Documents\n"),
        "the compiled firmware has no `## Reference Documents` section:\n{firmware}"
    );
    // The section must follow the program it belongs to, not precede it.
    assert!(
        firmware.find("## Program").expect("## Program section")
            < firmware
                .find("## Reference Documents")
                .expect("## Reference Documents section"),
        "`## Reference Documents` must be appended after `## Program`"
    );
    assert!(
        firmware.contains("### Question Blocks"),
        "the reference section is missing its `### Question Blocks` subsection"
    );
    assert!(
        firmware.ends_with('\n'),
        "the compiled firmware must end with exactly one newline"
    );
    assert!(
        !firmware.ends_with("\n\n"),
        "the compiled firmware must not end with a blank line"
    );
    assert!(
        !firmware.contains("{REFERENCE_DOCUMENTS}"),
        "the {{REFERENCE_DOCUMENTS}} placeholder was left unsubstituted"
    );
}

#[test]
fn a_non_citing_promptware_is_unchanged() {
    let fx = Fixture::new("QuietPromptware", "Sync the repo and stop.\n");

    let firmware = compile(&fx.folder);

    assert!(
        !firmware.contains("Reference Documents"),
        "a promptware that never cites the section must not carry it:\n{firmware}"
    );
    assert!(
        !firmware.contains("{REFERENCE_DOCUMENTS}"),
        "the {{REFERENCE_DOCUMENTS}} placeholder was left unsubstituted"
    );
}

#[test]
fn the_section_is_appended_after_project_skills() {
    let fx = Fixture::new("SkilledPromptware", "See the Reference Documents.\n");

    let firmware = compile_firmware_with_skills(
        &fx.folder,
        &Default::default(),
        &[tendril_core::models::ProjectSkillInfo {
            name: "House Style".to_string(),
            description: "How this project writes code".to_string(),
            instructions: "Two spaces, never tabs.".to_string(),
        }],
    )
    .expect("compile with skills");

    let skills = firmware
        .find("## Project Skills")
        .expect("## Project Skills section");
    let reference = firmware
        .find("## Reference Documents")
        .expect("## Reference Documents section");
    assert!(
        skills < reference,
        "a project's own skills must be read before the general reference"
    );
}

// ---------------------------------------------------------------------------------------------
// The citation contract — the test that stops this regressing
// ---------------------------------------------------------------------------------------------

#[test]
fn every_reference_documents_citation_names_a_real_heading() {
    let Some(dir) = promptwares_dir() else {
        eprintln!("skipped: src/promptwares is not reachable from this build");
        return;
    };

    let mut checked = 0usize;
    let mut citing = 0usize;
    let mut dangling: Vec<String> = Vec::new();

    for (name, folder) in shipped_promptwares(&dir) {
        let program = std::fs::read_to_string(folder.join("Program.md")).expect("readable Program");
        let cited = cited_headings(&program);
        if cited.is_empty() {
            continue;
        }
        citing += 1;

        // Headings are collected from the `## Reference Documents` section only, not the whole
        // firmware. A Program that happens to have its own `### Question Blocks` heading must not
        // satisfy a citation that explicitly says "of **Reference Documents**".
        let firmware = compile(&folder);
        let section = firmware
            .find("\n## Reference Documents\n")
            .map(|at| &firmware[at + 1..])
            .unwrap_or("");
        let available = headings(section);

        for heading in cited {
            checked += 1;
            if !available.contains(&heading) {
                dangling.push(format!(
                    "{name}/Program.md points the agent at the '{heading}' section, but the \
                     compiled firmware has no such heading"
                ));
            }
        }
    }

    assert!(
        citing >= 7,
        "only {citing} promptwares were seen to cite Reference Documents — the citation scan is \
         broken (7 did when this test was written)"
    );
    assert!(
        checked >= 8,
        "only {checked} citations were checked — the citation scan is broken"
    );
    assert!(
        dangling.is_empty(),
        "promptwares cite firmware sections that do not exist. Either add the heading to \
         tendril-core/src/promptware/plan_reference.md, or fix the citation in the promptware:\n  \
         {}",
        dangling.join("\n  ")
    );
}

#[test]
fn every_promptware_that_authors_plan_content_cites_the_section() {
    let Some(dir) = promptwares_dir() else {
        eprintln!("skipped: src/promptwares is not reachable from this build");
        return;
    };

    // A promptware that writes a revision or plan metadata needs the reference; the four that only
    // touch projects and repos (AddProject, CreateIssue, SetupProject, SyncRepo) do not, and are
    // the reason the section is scoped rather than appended to everything.
    const PLAN_AUTHORS: [&str; 7] = [
        "CreatePlan",
        "CreatePr",
        "ExecutePlan",
        "ExpandPlan",
        "RetryPlan",
        "SplitPlan",
        "UpdatePlan",
    ];

    let shipped = shipped_promptwares(&dir);
    for name in PLAN_AUTHORS {
        let folder = shipped
            .get(name)
            .unwrap_or_else(|| panic!("{name} is no longer a shipped promptware"));
        let program = std::fs::read_to_string(folder.join("Program.md")).expect("readable Program");
        assert!(
            cites_reference_documents(&program),
            "{name} authors plan content but no longer cites the Reference Documents section, so \
             its firmware will not carry the plan.yaml, CLI and question-block rules"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The reference must not contradict what the CLI actually does
// ---------------------------------------------------------------------------------------------

#[test]
fn the_documented_plan_fields_are_the_real_ones() {
    for field in tendril_core::plans::SUPPORTED_PLAN_FIELDS {
        assert!(
            PLAN_REFERENCE.contains(field),
            "plan field `{field}` is readable with `plan get` but is not documented"
        );
    }
}

#[test]
fn the_documented_plan_states_and_statuses_are_the_real_ones() {
    use tendril_core::models::{PlanStatus, RecommendationStatus, VerificationStatus};

    for state in [
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
    ] {
        assert!(
            PLAN_REFERENCE.contains(&format!("`{}`", state.as_str())),
            "plan state {} is not documented",
            state.as_str()
        );
    }

    for status in [
        VerificationStatus::Pending,
        VerificationStatus::Pass,
        VerificationStatus::Fail,
        VerificationStatus::Skipped,
    ] {
        assert!(
            PLAN_REFERENCE.contains(&format!("`{}`", status.as_str())),
            "verification status {} is not documented",
            status.as_str()
        );
    }

    for state in RecommendationStatus::ALL {
        assert!(
            PLAN_REFERENCE.contains(state),
            "recommendation state {state} is not documented"
        );
    }
}

/// The lint messages in the reference table are quoted from the validator. If a message is reworded
/// there and not here, an agent greps its own output for a string that never appears.
#[test]
fn the_documented_lint_messages_are_the_real_ones() {
    use tendril_core::questions::{
        parse_question_blocks, validate_question_blocks, IssueSeverity, QuestionIssue,
    };

    fn messages(markdown: &str) -> Vec<String> {
        validate_question_blocks(&parse_question_blocks(markdown))
            .into_iter()
            .filter(|i: &QuestionIssue| i.severity == IssueSeverity::Error)
            .map(|i| i.message)
            .collect()
    }

    // One revision that trips as many distinct rules as a single document can.
    let bad = "\
```questions
questions:
  - id: dupe
    title: One?
    options:
      - title: Yes
        value: same
        recommended: true
      - title: Other
        value: same
        recommended: true
  - id: dupe
    title: Two?
    header: far too long a header
    multiple: true
    answer: p
    options:
      - title: P
        value: p
      - title: Q
        value: q
  - id: BadId
    title: Three?
    answer:
    options:
      - title: R
        value: r
      - title: S
        value: s
```
";

    let produced = messages(bad);
    assert!(
        produced.len() >= 7,
        "the fixture no longer trips enough rules: {produced:?}"
    );

    let mut undocumented = Vec::new();
    for message in &produced {
        // Two normalisations before comparing:
        //   * drop the `block N: question N: ` prefix, which the reference documents in prose rather
        //     than repeating on every table row;
        //   * truncate at the first quote, because the reference writes the interpolated id/value as
        //     `'<id>'` while the validator interpolates the real one.
        let bare = message
            .split_once("question ")
            .and_then(|(_, rest)| rest.split_once(": "))
            .map_or(&message[..], |(_, m)| m);
        let stem = bare.split_once('\'').map_or(bare, |(head, _)| head).trim();
        if !PLAN_REFERENCE.contains(stem) {
            undocumented.push(stem.to_string());
        }
    }
    assert!(
        undocumented.is_empty(),
        "the validator produces lint messages the reference does not document verbatim: \
         {undocumented:?}"
    );
}

/// The reference is the promptware-facing twin of `agents/agent_instructions.md`, which is the
/// chat-facing one. They overlap on plan states, verification statuses, the completion guard and the
/// question-block rules, and two documents that disagree are worse than one that is missing.
#[test]
fn the_reference_does_not_contradict_the_chat_agent_instructions() {
    let chat = tendril_core::agents::instructions::TEMPLATE;

    // Shared facts, phrased differently in each document but asserted here on both.
    let shared: [(&str, &str); 6] = [
        ("--allow-failed-verifications", "the partial-delivery flag"),
        ("partialDelivery", "the partial-delivery field"),
        (
            "does not consume a revision number",
            "the rejection contract",
        ),
        ("--no-question-check", "the validation escape hatch"),
        ("Title Case", "the title casing rule"),
        ("plan://", "the plan link scheme"),
    ];
    for (needle, what) in shared {
        assert!(
            chat.contains(needle),
            "{what} (`{needle}`) is documented in the promptware reference but not in \
             agent_instructions.md"
        );
        assert!(
            PLAN_REFERENCE.contains(needle),
            "{what} (`{needle}`) is documented in agent_instructions.md but not in the promptware \
             reference"
        );
    }

    // The one flat contradiction between the two documents, asserted on the side this crate's
    // promptware module owns. `agent_instructions.md` still carries V1's "Unknown fields are
    // stripped by the normalizer", which V2's `PlanYaml::extra` flatten map makes false — that
    // asset is owned elsewhere and is reported rather than asserted here, so this test does not
    // fail on a file it cannot fix.
    assert!(
        !PLAN_REFERENCE.to_ascii_lowercase().contains("stripped"),
        "the reference must not claim unknown plan.yaml fields are stripped; V2 preserves them"
    );
    assert!(
        PLAN_REFERENCE.contains("preserved"),
        "the reference must state that unknown plan.yaml fields are preserved"
    );
}

/// The corrections this document makes to the original Tendril's `Prompts/Plans.md`, pinned
/// individually so a well-meaning "restore parity" edit names what it is breaking.
#[test]
fn the_known_divergences_from_v1_stay_corrected() {
    // Phrases from V1's Plans.md that are now false. Each is specific enough that it could only
    // arrive by copying the original back in.
    for stale in [
        "Next plan ID (integer, auto-incremented)",
        "first 24 chars",       // V2 does not truncate SafeTitle
        "logs/{NNN}",           // job logs live in {TendrilHome}/Logs/Jobs/<job-id>.md
        "will be stripped",     // unknown plan.yaml fields are preserved
        "Updated state to",     // `plan set` prints `Set <field> = <value>`
        "duplicates the Other", // now "duplicates what other: true provides"
        "-d <description>",     // `rec add` has no `-d` short form
    ] {
        assert!(
            !PLAN_REFERENCE.contains(stale),
            "the reference has picked up the stale V1 claim `{stale}`"
        );
    }

    // The corrected statements, each verified against the built binary.
    for current in [
        "There is no `.counter` file",
        "not truncated",
        "{TendrilHome}/Logs/Jobs/<job-id>.md",
        "Set <field> = <value>",
        "an error (exit 1), not a blank line",
        "tendril plan create <TITLE> <PROJECT>",
        "inherits the project's configuration",
        "does not consume a revision number",
        "duplicates what other: true provides",
        "no `-d` short form",
        "exit 0",
    ] {
        assert!(
            PLAN_REFERENCE.contains(current),
            "the reference no longer documents the current behaviour `{current}`"
        );
    }
}

/// The reference is appended to a prompt on every run of seven promptwares, so its size is a real
/// and recurring token cost. Kept under the original's 479 lines on purpose.
#[test]
fn the_reference_stays_shorter_than_the_v1_original() {
    let lines = PLAN_REFERENCE.lines().count();
    assert!(
        (200..=479).contains(&lines),
        "the reference is {lines} lines; it must stay between 200 and 479 (V1's Plans.md was 479) \
         — if it has genuinely outgrown that, move detail into the promptware that needs it"
    );
}
