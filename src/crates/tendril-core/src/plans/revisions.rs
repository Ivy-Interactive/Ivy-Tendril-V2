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

/// Overwrites the newest revision in place, returning its (unchanged) number.
///
/// This exists for one reason: **answering a question is not a new revision of the plan, it is
/// filling in a blank the plan left.** V1 says so explicitly and routes answers through
/// `IPlanReaderService.UpdateLatestRevision` for exactly that purpose. Appending instead would be
/// wrong twice over — it would claim the agent produced a new plan, and it would inflate
/// `revisionCount`, which `execute_guards`' unfolded-answer check reads as `revisionCount === 1`, so
/// a single answer would silently switch that guard off.
///
/// Question blocks are checked on the way in, but **only for errors this write introduces** — see
/// `introduced_question_errors`. Links are polished exactly as `write_revision` does, so a revision
/// does not change shape depending on which door it came through.
///
/// A plan with no revisions yet is an error rather than an implicit create: there is no blank to
/// fill, and silently creating `001.md` here would hide a caller that meant `write_revision`.
pub fn update_latest_revision(plan_folder: &Path, content: &str) -> Result<i32> {
    let rev_dir = plan_folder.join("Revisions");
    let mut highest = 0;
    if rev_dir.is_dir() {
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
    }

    if highest == 0 {
        return Err(TendrilError::Plan(format!(
            "Plan has no revision to update at {}",
            rev_dir.display()
        )));
    }

    let target = rev_dir.join(format!("{:03}.md", highest));

    // Locked, unlike `write_revision`: that function writes a number it just allocated for itself,
    // whereas this one overwrites a file the agent may be appending to at the same moment. Taken
    // before the read so the comparison below is against the bytes this write actually replaces.
    let _lock = crate::fs_lock::FileLock::acquire(&target)?;

    let before = std::fs::read_to_string(&target).unwrap_or_default();
    let introduced = introduced_question_errors(&before, content);
    if !introduced.is_empty() {
        return Err(TendrilError::Validation(reject_message(
            &introduced,
            &question_error_messages(&before),
        )));
    }

    let plans_dir = plan_folder.parent().unwrap_or(plan_folder);
    let polished = polish_links(content, plans_dir);
    crate::fs_lock::write_atomic(&target, polished.as_bytes())?;

    Ok(highest)
}

/// Every question-block **error** a document has, as the validator words it.
///
/// Warnings are left out on purpose: a legacy-format block is a warning, and refusing to record an
/// answer because the plan uses an older fence style would be absurd.
fn question_error_messages(content: &str) -> Vec<String> {
    validate_question_blocks(&parse_question_blocks(content))
        .into_iter()
        .filter(|issue| issue.severity == IssueSeverity::Error)
        .map(|issue| issue.message)
        .collect()
}

/// A parse error's message carries coordinates from inside its own block, so it must be compared by
/// location rather than by text: the same broken block reports a different column once an `answer:`
/// line lands above it. Every other rule's message is already stable.
fn parse_error_scope(message: &str) -> Option<&str> {
    let end = message.find("parse error:")? + "parse error:".len();
    Some(&message[..end])
}

/// The question-block errors `after` has that `before` did not — the only ones an in-place write is
/// allowed to be refused for.
///
/// **Why this is a difference and not an absolute check.** An answer is written into a revision an
/// agent wrote, and agents write invalid question blocks: a single-option question, a block of five,
/// a duplicate id. Validating the whole document made every question in such a plan permanently
/// unanswerable, and blamed a block the operator had never touched. V1 does not have that problem
/// because `PlanReaderService.UpdateLatestRevision` does not validate at all — it writes the bytes.
///
/// So V1's behaviour is the floor: a defect that was already on disk must not block an answer. What
/// is kept beyond it is the one thing worth keeping — this path serialises an answer merged in a
/// webview and sent over a wire, and it must not be able to mangle a plan's question blocks. An error
/// the write *introduces* is that, and nothing else is.
pub fn introduced_question_errors(before: &str, after: &str) -> Vec<String> {
    let existing = question_error_messages(before);
    if existing.is_empty() {
        return question_error_messages(after);
    }
    let existing_parse_scopes: Vec<&str> = existing
        .iter()
        .filter_map(|message| parse_error_scope(message))
        .collect();

    question_error_messages(after)
        .into_iter()
        .filter(|message| {
            if existing.iter().any(|prior| prior == message) {
                return false;
            }
            match parse_error_scope(message) {
                Some(scope) => !existing_parse_scopes.contains(&scope),
                None => true,
            }
        })
        .collect()
}

/// The refusal an operator reads.
///
/// It says two things, because a message that only listed errors would be read as "your answer broke
/// all of this": what this write would introduce, and — separately, and named as such — what was
/// already wrong with the plan and is *not* the reason for the refusal.
fn reject_message(introduced: &[String], pre_existing: &[String]) -> String {
    let mut text = format!(
        "Writing this revision would introduce {} question-block error(s), so nothing was written:\n{}",
        introduced.len(),
        introduced
            .iter()
            .map(|message| format!("  - {message}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
    if !pre_existing.is_empty() {
        text.push_str(&format!(
            "\nThe plan also has {} pre-existing question-block error(s), which did not cause this \
             refusal and are listed only so they are not mistaken for it:\n{}",
            pre_existing.len(),
            pre_existing
                .iter()
                .map(|message| format!("  - {message}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    text
}
