//! Validates the `wireframe` fences in plan revision markdown.
//!
//! Ported from V1's `Services/Plans/WireframeFenceValidator.cs`, which checks the rules stated in
//! `Prompts/Plans.md` (`## Wireframes`).
//!
//! Every problem is an error, so `write-revision` writes nothing until the agent fixes them all.
//! Four things are checked: that each block is well formed, that the wireframe it names exists in the
//! plan folder, that every block sits in a `## Wireframe` section which is the plan's first section,
//! and that a revision embeds at most [`MAX_PER_REVISION`] of them.
//!
//! The cap is deliberate and not negotiable per plan: a wireframe is for a UX decision, and a plan
//! that wants more than two is usually several plans, or describing things prose would say better.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::questions::models::{IssueSeverity, QuestionIssue};
use crate::wireframes::{is_valid_name, FOLDER_NAME};

pub const INFO_WORD: &str = "wireframe";
pub const SECTION_HEADING: &str = "Wireframe";
pub const MAX_PER_REVISION: usize = 2;
pub const MAX_HEIGHT: i64 = 4000;

const KEYS: [&str; 3] = ["name", "height", "viewport"];
const VIEWPORTS: [&str; 3] = ["Desktop", "Tablet", "Mobile"];

/// A `wireframe` fence's fields, once validated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireframeFenceSpec {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Heading {
    line: usize,
    level: usize,
    text: String,
}

fn is_wireframe_heading(text: &str) -> bool {
    text.eq_ignore_ascii_case(SECTION_HEADING)
        || text.eq_ignore_ascii_case(&format!("{SECTION_HEADING}s"))
}

/// Every fenced block whose info string is exactly `info_word`, as (1-based line, body).
fn find_fences(markdown: &str, info_word: &str) -> Vec<(usize, String)> {
    let mut fences = Vec::new();
    let mut open: Option<(usize, usize, String)> = None; // line, fence length, body
    let mut body = String::new();

    for (index, raw) in markdown.split('\n').enumerate() {
        let line = raw.trim_end_matches('\r');
        let trimmed = line.trim_start();
        let tick_count = trimmed.chars().take_while(|c| *c == '`').count();

        match &open {
            None => {
                if tick_count >= 3 && trimmed[tick_count..].trim() == info_word {
                    open = Some((index + 1, tick_count, String::new()));
                    body.clear();
                }
            }
            Some((start, len, _)) => {
                // A closing fence is at least as long as the opening one and carries no info string.
                if tick_count >= *len && trimmed[tick_count..].trim().is_empty() {
                    fences.push((*start, body.clone()));
                    open = None;
                    body.clear();
                } else {
                    body.push_str(line);
                    body.push('\n');
                }
            }
        }
    }

    fences
}

/// ATX headings, as (1-based line, level, text). Fenced regions are skipped so a `#` inside a code
/// block is not read as a section.
fn find_headings(markdown: &str) -> Vec<Heading> {
    let mut headings = Vec::new();
    let mut fence: Option<usize> = None;

    for (index, raw) in markdown.split('\n').enumerate() {
        let line = raw.trim_end_matches('\r');
        let trimmed = line.trim_start();
        let tick_count = trimmed.chars().take_while(|c| *c == '`').count();

        match fence {
            Some(len) if tick_count >= len && trimmed[tick_count..].trim().is_empty() => {
                fence = None;
                continue;
            }
            Some(_) => continue,
            None if tick_count >= 3 => {
                fence = Some(tick_count);
                continue;
            }
            None => {}
        }

        let level = trimmed.chars().take_while(|c| *c == '#').count();
        if level == 0 || level > 6 {
            continue;
        }
        let rest = &trimmed[level..];
        if !rest.starts_with(' ') && !rest.is_empty() {
            continue;
        }
        headings.push(Heading {
            line: index + 1,
            level,
            text: rest.trim().trim_end_matches('#').trim().to_string(),
        });
    }

    headings
}

fn error(line: usize, message: impl Into<String>) -> QuestionIssue {
    QuestionIssue {
        severity: IssueSeverity::Error,
        line_number: line,
        message: format!("wireframe: {}", message.into()),
    }
}

/// `plan_folder` is the plan the revision belongs to, so a block naming a wireframe that does not
/// exist is caught. `None` skips that check.
pub fn validate(markdown: &str, plan_folder: Option<&Path>) -> Vec<QuestionIssue> {
    let fences = find_fences(markdown, INFO_WORD);
    let mut issues = Vec::new();
    if fences.is_empty() {
        return issues;
    }

    // Wireframes are the first thing a reviewer sees: a `## Wireframe` section directly under the
    // title, before `## Problem`, holding every wireframe block the plan has.
    let sections: Vec<Heading> = find_headings(markdown)
        .into_iter()
        .filter(|h| h.level <= 2)
        .collect();
    let first_section = sections.iter().find(|h| h.level == 2);
    let wireframe_section = sections
        .iter()
        .find(|h| h.level == 2 && is_wireframe_heading(&h.text));

    if let (Some(wireframe), Some(first)) = (wireframe_section, first_section) {
        if first.line != wireframe.line {
            issues.push(error(
                wireframe.line,
                format!(
                    "the `## {SECTION_HEADING}` section must be the first section, directly under \
                     the title and before `## {}`",
                    first.text
                ),
            ));
        }
    }

    for (index, (line, body)) in fences.iter().enumerate() {
        let enclosing = sections.iter().filter(|h| h.line < *line).next_back();
        let in_wireframe_section = enclosing
            .map(|h| h.level == 2 && is_wireframe_heading(&h.text))
            .unwrap_or(false);
        if !in_wireframe_section {
            let where_it_is = match enclosing {
                None => "before it".to_string(),
                Some(h) => format!("under `{} {}`", "#".repeat(h.level), h.text),
            };
            issues.push(error(
                *line,
                format!(
                    "put wireframe blocks in a `## {SECTION_HEADING}` section directly under the \
                     title, not {where_it_is}"
                ),
            ));
        }

        if index == MAX_PER_REVISION {
            issues.push(error(
                *line,
                format!(
                    "{} wireframe blocks; a revision may embed at most {MAX_PER_REVISION}. Keep the \
                     ones the design decision depends on and describe the rest in prose",
                    fences.len()
                ),
            ));
        }

        let spec = match parse(body) {
            Ok(spec) => spec,
            Err(message) => {
                issues.push(error(*line, message));
                continue;
            }
        };

        let Some(plan_folder) = plan_folder else {
            continue;
        };
        let project = plan_folder.join(FOLDER_NAME).join(&spec.name);
        if !project.join("src").join("main.tsx").is_file() {
            issues.push(error(
                *line,
                format!(
                    "this plan has no wireframe named '{}'. Create it with: tendril wireframe setup \"{}\"",
                    spec.name,
                    project.display()
                ),
            ));
        }
    }

    issues
}

/// Reads one fence body, or returns the reason it could not.
pub fn parse(body: &str) -> Result<WireframeFenceSpec, String> {
    let text = body.trim();

    if text.is_empty() {
        return Err(
            "the block names no wireframe; add a line such as 'name: checkout-payment'".to_string(),
        );
    }

    // The shorthand: the body is just the name.
    if is_valid_name(text) {
        return Ok(WireframeFenceSpec {
            name: text.to_string(),
            height: None,
            viewport: None,
        });
    }

    let value: serde_yaml::Value =
        serde_yaml::from_str(text).map_err(|_| "the block is not valid YAML".to_string())?;
    let Some(mapping) = value.as_mapping() else {
        return Err(
            "write the block as 'name: <wireframe>', optionally with height and viewport"
                .to_string(),
        );
    };

    let mut name = None;
    let mut height = None;
    let mut viewport = None;

    for (key_node, value_node) in mapping {
        let key = key_node.as_str().unwrap_or("");
        if !KEYS.contains(&key) {
            return Err(format!("unknown key '{key}'; use name, height or viewport"));
        }
        // A nested mapping or sequence is not a value this understands.
        if value_node.is_mapping() || value_node.is_sequence() {
            return Err(format!("{key} must be a single value"));
        }
        let raw = match value_node {
            serde_yaml::Value::String(s) => s.clone(),
            serde_yaml::Value::Number(n) => n.to_string(),
            serde_yaml::Value::Bool(b) => b.to_string(),
            _ => String::new(),
        };
        match key {
            "name" => name = Some(raw),
            "height" => height = Some(raw),
            "viewport" => viewport = Some(raw),
            _ => unreachable!("keys are checked above"),
        }
    }

    let name = match name {
        Some(name) if is_valid_name(&name) => name,
        _ => return Err("name must be a lowercase slug such as checkout-payment".to_string()),
    };

    let height = match height {
        None => None,
        Some(raw) => match raw.parse::<i64>() {
            Ok(parsed) if (1..=MAX_HEIGHT).contains(&parsed) => Some(parsed),
            _ => {
                return Err(format!(
                    "height must be a whole number of pixels between 1 and {MAX_HEIGHT}"
                ))
            }
        },
    };

    let viewport = match viewport {
        None => None,
        Some(raw) if VIEWPORTS.contains(&raw.as_str()) => Some(raw),
        Some(_) => return Err("viewport must be Desktop, Tablet or Mobile".to_string()),
    };

    Ok(WireframeFenceSpec {
        name,
        height,
        viewport,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan_with(name: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let plan = dir.path().to_path_buf();
        let src = plan.join(FOLDER_NAME).join(name).join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("main.tsx"), "// entry").unwrap();
        (dir, plan)
    }

    fn revision(body: &str) -> String {
        format!("# Plan\n\n## Wireframe\n\n```wireframe\n{body}\n```\n\n## Problem\n\nText.\n")
    }

    #[test]
    fn the_shorthand_is_just_a_name() {
        assert_eq!(
            parse("checkout").unwrap(),
            WireframeFenceSpec {
                name: "checkout".into(),
                height: None,
                viewport: None
            }
        );
    }

    #[test]
    fn the_long_form_takes_height_and_viewport() {
        let spec = parse("name: checkout\nheight: 720\nviewport: Mobile\n").unwrap();
        assert_eq!(spec.name, "checkout");
        assert_eq!(spec.height, Some(720));
        assert_eq!(spec.viewport.as_deref(), Some("Mobile"));
    }

    #[test]
    fn every_field_error_names_what_to_write_instead() {
        // The message is the whole value of this validator: an agent reads it and fixes the block.
        assert!(parse("").unwrap_err().contains("name: checkout-payment"));
        assert!(parse("name: Checkout")
            .unwrap_err()
            .contains("lowercase slug"));
        assert!(parse("name: checkout\ncolour: red")
            .unwrap_err()
            .contains("unknown key 'colour'"));
        assert!(parse("name: checkout\nheight: 99999")
            .unwrap_err()
            .contains("between 1 and 4000"));
        assert!(parse("name: checkout\nheight: tall")
            .unwrap_err()
            .contains("between 1 and 4000"));
        assert!(parse("name: checkout\nviewport: Watch")
            .unwrap_err()
            .contains("Desktop, Tablet or Mobile"));
        assert!(parse("- checkout")
            .unwrap_err()
            .contains("write the block as"));
    }

    #[test]
    fn a_well_formed_revision_passes() {
        let (_g, plan) = plan_with("checkout");
        let issues = validate(&revision("name: checkout"), Some(&plan));
        assert!(issues.is_empty(), "got {issues:?}");
    }

    #[test]
    fn a_block_naming_a_wireframe_the_plan_does_not_have_is_caught() {
        let (_g, plan) = plan_with("checkout");
        let issues = validate(&revision("name: sign-in"), Some(&plan));
        assert_eq!(issues.len(), 1);
        assert!(issues[0].message.contains("no wireframe named 'sign-in'"));
        // And it says exactly how to create it.
        assert!(issues[0].message.contains("tendril wireframe setup"));
    }

    #[test]
    fn the_wireframe_section_must_come_first() {
        let (_g, plan) = plan_with("checkout");
        let markdown =
            "# Plan\n\n## Problem\n\nText.\n\n## Wireframe\n\n```wireframe\nname: checkout\n```\n";
        let issues = validate(markdown, Some(&plan));
        assert!(
            issues
                .iter()
                .any(|i| i.message.contains("must be the first section")),
            "got {issues:?}"
        );
    }

    #[test]
    fn a_block_outside_the_wireframe_section_is_caught() {
        let (_g, plan) = plan_with("checkout");
        let markdown = "# Plan\n\n## Problem\n\n```wireframe\nname: checkout\n```\n";
        let issues = validate(markdown, Some(&plan));
        assert!(
            issues
                .iter()
                .any(|i| i.message.contains("under `## Problem`")),
            "got {issues:?}"
        );
    }

    #[test]
    fn a_third_block_is_refused() {
        let (_g, plan) = plan_with("checkout");
        let mut markdown = String::from("# Plan\n\n## Wireframe\n\n");
        for _ in 0..3 {
            markdown.push_str("```wireframe\nname: checkout\n```\n\n");
        }
        let issues = validate(&markdown, Some(&plan));
        let cap = issues
            .iter()
            .find(|i| i.message.contains("at most 2"))
            .expect("the cap is reported");
        assert!(
            cap.message.contains("3 wireframe blocks"),
            "got {}",
            cap.message
        );
    }

    #[test]
    fn two_blocks_are_allowed() {
        let (_g, plan) = plan_with("checkout");
        let mut markdown = String::from("# Plan\n\n## Wireframe\n\n");
        for _ in 0..2 {
            markdown.push_str("```wireframe\nname: checkout\n```\n\n");
        }
        assert!(validate(&markdown, Some(&plan)).is_empty());
    }

    #[test]
    fn a_revision_with_no_wireframe_blocks_is_not_examined_at_all() {
        // Most plans have no wireframe, so none of the section rules may apply to them.
        let markdown = "# Plan\n\n## Problem\n\nText.\n";
        assert!(validate(markdown, None).is_empty());
    }

    #[test]
    fn a_fence_inside_a_code_block_is_not_a_heading_source() {
        // A `#` inside a fenced example must not be read as a section, or a plan that documents
        // markdown gets nonsense errors.
        let (_g, plan) = plan_with("checkout");
        let markdown = "# Plan\n\n## Wireframe\n\n```wireframe\nname: checkout\n```\n\n\
                        ## Problem\n\n```md\n## Not A Section\n```\n";
        assert!(validate(markdown, Some(&plan)).is_empty());
    }

    #[test]
    fn the_plural_heading_is_accepted_too() {
        let (_g, plan) = plan_with("checkout");
        let markdown = "# Plan\n\n## Wireframes\n\n```wireframe\nname: checkout\n```\n";
        assert!(validate(markdown, Some(&plan)).is_empty());
    }
}
