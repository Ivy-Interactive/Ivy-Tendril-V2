use crate::error::Result;
use crate::models::ProjectSkillInfo;
use chrono::Utc;
use std::collections::HashMap;
use std::path::Path;

const FIRMWARE_TEMPLATE: &str = r#"---
{HEADER}
---
You are an agentic application that evolves over time.

This prompt is your Firmware and is never allowed to change.

The header above contains your named parameters for this execution.

Your program folder is: {PROGRAMFOLDER}

## Goal

Your goal is to complete the instructions in the **Program** section below (inlined from {PROGRAMFOLDER}/Program.md) with the following priority:

1. Completeness
2. Speed
3. Token efficiency
4. Improvement over time

**Tools:** 
{TOOLS}

**Memory:**
{MEMORY}

To read memory files (batch multiple files in one call to reduce spin-up overhead):
```bash
tendril promptware read-memory {PROMPTWARE_NAME} <filename1>.md [filename2.md ...]
```

A `[[name]]` cross-reference inside a memory means the file `name.md`. If a read fails, the memory was likely pruned: run `tendril promptware list-memory {PROMPTWARE_NAME}` for the current list instead of guessing filenames.

Complete your task and present the user with a summary.

## Reflection

Every execution needs to end with a reflection step. This is your opportunity to improve over time. What did we learn during this session? Save reflections using the CLI:

```bash
tendril promptware write-memory {PROMPTWARE_NAME} <filename>.md <<'EOF'
<reflection content>
EOF
```

To delete a memory file that is no longer true:
```bash
tendril promptware delete-memory {PROMPTWARE_NAME} <filename>.md
```

## Program

{PROGRAM}{PROJECT_SKILLS}{REFERENCE_DOCUMENTS}
"#;

/// The plan-and-CLI reference appended as the firmware's `## Reference Documents` section.
///
/// Seven of the shipped promptwares point the agent at this section by name — "the plan structure
/// and CLI commands are in the **Reference Documents** section of your firmware", "the schema,
/// answer semantics and lint rules are in the **Question Blocks** section of **Reference
/// Documents**" — and for a while no such section was emitted at all. An agent following those
/// instructions went looking for guidance it had never been given, with no way to tell whether the
/// section was missing or it had misread its own prompt.
///
/// It is deliberately *not* a copy of the original Tendril's `Prompts/Plans.md`. The CLI has
/// diverged (no `.counter`, `plan create` takes `<TITLE> <PROJECT>` and inherits the project's
/// repos and verifications, an unknown `plan get` field is an error, unknown `plan.yaml` fields are
/// preserved rather than stripped, `write-revision` polishes links), and shipping stale commands to
/// an agent is the failure this section exists to fix.
pub const PLAN_REFERENCE: &str = include_str!("plan_reference.md");

/// The wireframe guidance, appended after [`PLAN_REFERENCE`] for the promptwares that mention
/// wireframes at all.
///
/// It is a separate document, and separately gated, for a reason the reference's own size test
/// states: the reference is appended to a prompt on every run of seven promptwares, so its length is
/// a real and recurring token cost, and it is held under V1's 479 lines. Wireframe guidance is 98
/// lines that only some of those runs can act on -- CreatePr is told to run one command and never
/// writes a wireframe, and the four promptwares that author no plan content at all never see either
/// document. Folding it into `plan_reference.md` put that file 99 lines over its ceiling, which is
/// what the size test caught; splitting it keeps every promptware paying for exactly the guidance it
/// cites.
pub const WIREFRAME_REFERENCE: &str = include_str!("wireframe_reference.md");

/// Whether a `Program.md` sends the agent to the `## Reference Documents` section.
///
/// The section is appended **only** to promptwares that cite it, rather than to every promptware as
/// the original Tendril did. Citation is the scope, not an allowlist: a Program that starts citing
/// the section gets it on the next compile with no code change, and one that never mentions it never
/// pays for it. Four of the twelve shipped promptwares (AddProject, CreateIssue, SetupProject,
/// SyncRepo) do not author plan content and would otherwise carry the whole appendix on every run.
///
/// Matched case-insensitively on the bare phrase, because the citations are not uniformly bold —
/// ExecutePlan writes "see the plan link rules in the Reference Documents" with no emphasis.
pub fn cites_reference_documents(program: &str) -> bool {
    program.to_ascii_lowercase().contains("reference documents")
}

/// Whether a `Program.md` needs the wireframe guidance appended.
///
/// Same rule as [`cites_reference_documents`], on the bare word: a Program that never mentions
/// wireframes never pays for the section, and one that starts mentioning them gets it on the next
/// compile with no code change. The citations are not uniformly bold or uniformly phrased --
/// CreatePlan writes "**Wireframes** in the Reference Documents", RetryPlan writes "Wireframes are a
/// layout reference, never code" -- so matching the word is what covers them all.
pub fn cites_wireframes(program: &str) -> bool {
    program.to_ascii_lowercase().contains("wireframe")
}

pub fn compile_firmware(program_folder: &Path, values: &HashMap<String, String>) -> Result<String> {
    compile_firmware_with_skills(program_folder, values, &[])
}

pub fn compile_firmware_with_skills(
    program_folder: &Path,
    values: &HashMap<String, String>,
    skills: &[ProjectSkillInfo],
) -> Result<String> {
    let mut header_values = values.clone();
    if !header_values.contains_key("CurrentTime") {
        header_values.insert("CurrentTime".to_string(), Utc::now().to_rfc3339());
    }

    let mut header_lines: Vec<String> = header_values
        .iter()
        .map(|(k, v)| format!("{}: {}", k, v))
        .collect();
    header_lines.sort();
    let header = header_lines.join("\n");

    let tools_dir = program_folder.join("Tools");
    let tools_listing = list_directory_files(&tools_dir, "(no tools yet)");

    let memory_dir = program_folder.join("Memory");
    let memory_listing = list_directory_files(&memory_dir, "(no memory yet)");

    let promptware_name = program_folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Promptware");

    let program_md_path = program_folder.join("Program.md");
    let program_content = if program_md_path.exists() {
        std::fs::read_to_string(&program_md_path)?
    } else {
        "(no Program.md found)".to_string()
    };

    let project_skills = render_project_skills(skills);

    let prompt = FIRMWARE_TEMPLATE
        .replace("{HEADER}", &header)
        .replace("{PROGRAMFOLDER}", &program_folder.to_string_lossy())
        .replace("{TOOLS}", &tools_listing)
        .replace("{MEMORY}", &memory_listing)
        .replace("{PROMPTWARE_NAME}", promptware_name)
        .replace("{PROGRAM}", &program_content)
        .replace("{PROJECT_SKILLS}", &project_skills)
        .replace(
            "{REFERENCE_DOCUMENTS}",
            &render_reference_documents(&program_content),
        );

    Ok(prompt)
}

/// Renders the `## Reference Documents` firmware section, or nothing when the Program does not cite
/// it. Appended after `## Project Skills` so the promptware's own instructions — and any
/// project-specific override in a skill — are read before the general reference, and so a firmware
/// for a non-citing promptware is byte-for-byte what it was before this section existed.
fn render_reference_documents(program_content: &str) -> String {
    if !cites_reference_documents(program_content) {
        return String::new();
    }

    let mut rendered = format!("\n{}", PLAN_REFERENCE.trim_end());
    if cites_wireframes(program_content) {
        rendered.push_str("\n\n");
        rendered.push_str(WIREFRAME_REFERENCE.trim_end());
    }
    rendered
}

/// Renders the `## Project Skills` firmware section. Empty when there are no skills, so the
/// template collapses to exactly today's output.
fn render_project_skills(skills: &[ProjectSkillInfo]) -> String {
    if skills.is_empty() {
        return String::new();
    }

    let mut sb = String::from("\n## Project Skills\n");
    for skill in skills {
        sb.push_str("\n#### Skill: ");
        sb.push_str(&skill.name);
        sb.push('\n');
        if !skill.description.is_empty() {
            sb.push('*');
            sb.push_str(&skill.description);
            sb.push_str("*\n");
        }
        if !skill.instructions.is_empty() {
            sb.push('\n');
            sb.push_str(&skill.instructions);
            sb.push('\n');
        }
    }

    sb
}

fn list_directory_files(dir: &Path, empty_placeholder: &str) -> String {
    if !dir.exists() {
        return empty_placeholder.to_string();
    }

    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_file() {
                    files.push(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
    }

    if files.is_empty() {
        empty_placeholder.to_string()
    } else {
        files.sort();
        files
            .into_iter()
            .map(|f| format!("- {}", f))
            .collect::<Vec<_>>()
            .join("\n")
    }
}
