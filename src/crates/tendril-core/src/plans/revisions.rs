use crate::error::{Result, TendrilError};
use crate::plans::markdown_links::polish_links;
use crate::questions::{parse_question_blocks, validate_question_blocks, IssueSeverity};
use std::path::Path;

pub fn get_revision(plan_folder: &Path, number: Option<i32>) -> Result<String> {
    let rev_dir = plan_folder.join("Revisions");
    if !rev_dir.exists() {
        return Ok(String::new());
    }

    if let Some(n) = number {
        let file_path = rev_dir.join(format!("{:03}.md", n));
        if file_path.exists() {
            return Ok(std::fs::read_to_string(file_path)?);
        }
        return Err(TendrilError::Plan(format!(
            "Revision {:03} not found in {}",
            n,
            plan_folder.display()
        )));
    }

    // Get latest revision
    let mut highest = 0;
    let mut latest_path = None;

    for entry in std::fs::read_dir(&rev_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.ends_with(".md") {
            if let Ok(num) = name_str.trim_end_matches(".md").parse::<i32>() {
                if num > highest {
                    highest = num;
                    latest_path = Some(entry.path());
                }
            }
        }
    }

    if let Some(path) = latest_path {
        Ok(std::fs::read_to_string(path)?)
    } else {
        Ok(String::new())
    }
}

pub fn write_revision(plan_folder: &Path, content: &str, validate_questions: bool) -> Result<i32> {
    if validate_questions {
        let blocks = parse_question_blocks(content);
        let issues = validate_question_blocks(&blocks);
        let errors: Vec<_> = issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Error)
            .collect();
        if !errors.is_empty() {
            let error_messages: Vec<String> = errors
                .iter()
                .map(|e| format!("{}: {}", e.line_number, e.message))
                .collect();
            return Err(TendrilError::Validation(format!(
                "Question block validation failed:\n{}",
                error_messages.join("\n")
            )));
        }
    }

    let rev_dir = plan_folder.join("Revisions");
    std::fs::create_dir_all(&rev_dir)?;

    let mut highest = 0;
    for entry in std::fs::read_dir(&rev_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.ends_with(".md") {
            if let Ok(num) = name_str.trim_end_matches(".md").parse::<i32>() {
                if num > highest {
                    highest = num;
                }
            }
        }
    }

    let next = highest + 1;
    let new_rev_file = rev_dir.join(format!("{:03}.md", next));

    // Polishing is unconditional — it runs regardless of `validate_questions`, since that flag is
    // about question *validation* (--no-question-check), while the questions-fence protection
    // inside `polish_links` does not depend on it. When `plan_folder` has no parent, or the
    // parent holds no `NNNNN-*` folders, the bare-number pass no-ops.
    let plans_dir = plan_folder.parent().unwrap_or(plan_folder);
    let polished = polish_links(content, plans_dir);

    // Atomic but unlocked: each revision file has exactly one writer (the agent that allocated the
    // number), so there is nothing to exclude — only a truncated read to prevent.
    crate::fs_lock::write_atomic(&new_rev_file, polished.as_bytes())?;

    Ok(next)
}
