use crate::models::{PlanStatus, PlanYaml, VerificationStatus};
use std::path::Path;

/// Reads the pre-execution validation report an execution promptware writes before it touches any
/// code, at `<plan folder>/Verification/PreExecution.md`.
///
/// Returns `None` when the file is absent or unparseable — a plan is never blocked on a guess.
/// `PreExecution` is deliberately not a `plan.yaml` verification row: it is a property of one
/// execution attempt, not of the plan.
pub fn read_pre_execution_result(plan_folder: &Path) -> Option<VerificationStatus> {
    let path = plan_folder.join("Verification").join("PreExecution.md");
    let content = std::fs::read_to_string(path).ok()?;
    parse_verification_result(&content)
}

/// Parses `result: Pass|Fail|Skipped` out of a verification report's YAML frontmatter, falling back
/// to the legacy `- **Result:** Pass` line for reports written before the frontmatter format.
pub fn parse_verification_result(content: &str) -> Option<VerificationStatus> {
    if let Some(result) = parse_frontmatter_result(content) {
        return Some(result);
    }

    for line in content.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("- **result:**") {
            if let Some(status) = VerificationStatus::from_str_loose(rest.trim()) {
                return Some(status);
            }
        }
    }

    None
}

fn parse_frontmatter_result(content: &str) -> Option<VerificationStatus> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("result:") {
            let value = rest.trim().trim_matches(|c| c == '"' || c == '\'');
            return VerificationStatus::from_str_loose(value);
        }
    }

    None
}

/// Verification rows that have not reached a settled outcome. `Pending` counts as incomplete: a row
/// the user left `Pending` is a row they asked to have run, so an agent that finished without
/// running it has not finished.
pub fn incomplete_verifications(plan: &PlanYaml) -> Vec<String> {
    plan.verifications
        .iter()
        .filter(|v| {
            matches!(
                v.status,
                VerificationStatus::Pending | VerificationStatus::Fail
            )
        })
        .map(|v| v.name.clone())
        .collect()
}

/// The single decision point for where a plan lands after its execution agent exits successfully.
///
/// Yields `Failed` when the pre-execution report says `Fail`, or when any verification row is still
/// `Pending` or is `Fail`. Required and optional rows are treated alike, so no settings are needed:
/// a user who flips an optional row to `Pending` is asking for it to run.
pub fn resolve_post_execution_state(plan: &PlanYaml, plan_folder: &Path) -> PlanStatus {
    if read_pre_execution_result(plan_folder) == Some(VerificationStatus::Fail) {
        return PlanStatus::Failed;
    }

    if !incomplete_verifications(plan).is_empty() {
        return PlanStatus::Failed;
    }

    PlanStatus::Review
}
