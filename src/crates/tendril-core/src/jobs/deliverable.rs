//! Asks whether a job that exited zero actually produced what it exists to produce.
//!
//! Without this, an agent that talked for twenty minutes and wrote nothing is recorded `Completed`,
//! the plan is flipped to a terminal state, and the work is gone. Job 02643 lost a full
//! implementation exactly that way.
//!
//! **Direction of error: it is far better to mark a successful job `Failed` for review than to mark
//! an empty job `Completed`.** A job wrongly failed costs a human one look at a preserved worktree; a
//! job wrongly completed loses the work and ships a lie. So every threshold below is "produced
//! literally nothing measurable", and every ambiguous signal — an unreadable `plan.yaml`, a plan
//! folder that will not resolve — resolves to `Missing`.

use crate::db::open_database;
use crate::jobs::failure_analysis::{agent_text, try_read_failure_artifact};
use crate::models::JobItem;
use crate::plans::reader::read_plan_yaml;
use crate::plans::verification_gate::incomplete_verifications;
use crate::plans::writer::write_plan_yaml;
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// Whether a job produced its deliverable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Deliverable {
    /// The job produced what it exists to produce.
    Present,
    /// It did not. `reason` is user-facing; `cleanup` says what to tidy.
    Missing { reason: String, cleanup: Cleanup },
}

/// What to tidy up after a job that produced nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cleanup {
    /// Delete the orphan plan folder and its DB row (CreatePlan only).
    OrphanPlan(PathBuf),
    /// Touch nothing — the worktree and the plan folder are the recovery material.
    PreserveWork,
}

static PLAN_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bPlanId:\s*(\d{1,5})").unwrap());
static DUPLICATE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)identified as duplicate:\s*(\S+)").unwrap());
static PR_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"https?://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/\d+").unwrap()
});
static PLAN_FOLDER_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{5}-").unwrap());

/// The single entry point, called from `finish_job` only when the status is still `Completed` after
/// the existing guards.
///
/// `plans_dir` is passed in rather than looked up: `TENDRIL_PLANS` in the ambient environment would
/// otherwise point a test at the operator's real plans directory, and what this decides leads to a
/// folder being deleted.
pub fn verify_deliverable(
    plans_dir: &Path,
    job: &mut JobItem,
    output_lines: &[String],
) -> Deliverable {
    match job.job_type.as_str() {
        "CreatePlan" => verify_create_plan(plans_dir, job, output_lines),
        "ExecutePlan" | "RetryPlan" => verify_execute_plan(job),
        "CreatePr" => verify_create_pr(job, output_lines),
        // Every other job type keeps behaving exactly as it does today: their deliverables are out
        // of scope here.
        _ => Deliverable::Present,
    }
}

/// A CreatePlan job succeeded only if a plan folder exists with at least one revision in it.
fn verify_create_plan(plans_dir: &Path, job: &mut JobItem, output_lines: &[String]) -> Deliverable {
    let resolved = resolve_created_plan_folder(plans_dir, job, output_lines);

    if let Some(folder) = resolved {
        if revision_count(&folder) > 0 {
            // Today `plan_file` stays empty for CreatePlan, so the Jobs UI never links the plan it
            // created. Record the folder we just verified.
            job.plan_file = folder.to_string_lossy().to_string();
            return Deliverable::Present;
        }

        // The folder is there and empty: this run left an orphan behind.
        job.plan_file = String::new();
        return Deliverable::Missing {
            reason: create_plan_failure_reason(output_lines),
            cleanup: Cleanup::OrphanPlan(folder),
        };
    }

    // No folder at all. A deliberate duplicate rejection is a success, not an empty run.
    if is_duplicate_plan(plans_dir, output_lines) {
        return Deliverable::Present;
    }

    Deliverable::Missing {
        reason: create_plan_failure_reason(output_lines),
        cleanup: Cleanup::PreserveWork,
    }
}

fn create_plan_failure_reason(output_lines: &[String]) -> String {
    try_read_failure_artifact(output_lines)
        .unwrap_or_else(|| "CreatePlan completed but no plan revision was written".to_string())
}

/// An ExecutePlan or RetryPlan job succeeded only if it recorded a commit **and** settled every
/// verification row. The verification half is the backstop for agents that spawn their verifications
/// as background tasks and never read the result.
fn verify_execute_plan(job: &JobItem) -> Deliverable {
    let plan_folder = PathBuf::from(&job.plan_file);
    let Ok((plan, _)) = read_plan_yaml(&plan_folder) else {
        return Deliverable::Missing {
            reason: format!(
                "exited 0 but its plan.yaml could not be read at {}",
                if job.plan_file.is_empty() {
                    "<no plan folder recorded>"
                } else {
                    &job.plan_file
                }
            ),
            cleanup: Cleanup::PreserveWork,
        };
    };

    let mut shortfalls: Vec<String> = Vec::new();
    if plan.commits.is_empty() {
        shortfalls.push("exited 0 with no commits recorded".to_string());
    }
    let incomplete = incomplete_verifications(&plan);
    if !incomplete.is_empty() {
        shortfalls.push(format!(
            "left verification(s) {} Pending",
            incomplete.join(", ")
        ));
    }

    if shortfalls.is_empty() {
        return Deliverable::Present;
    }

    Deliverable::Missing {
        reason: shortfalls.join(" and "),
        cleanup: Cleanup::PreserveWork,
    }
}

/// A CreatePr job succeeded only if a pull request URL ended up on the plan. An agent that opened the
/// PR but never ran `tendril plan add-pr` is reconciled from its own output first, so a bookkeeping
/// slip does not fail a real PR.
fn verify_create_pr(job: &JobItem, output_lines: &[String]) -> Deliverable {
    let plan_folder = PathBuf::from(&job.plan_file);
    let Ok((mut plan, _)) = read_plan_yaml(&plan_folder) else {
        return Deliverable::Missing {
            reason: "CreatePr completed but no pull request URL was recorded on the plan"
                .to_string(),
            cleanup: Cleanup::PreserveWork,
        };
    };

    if plan.prs.is_empty() {
        if let Some(url) = scrape_pr_url(output_lines) {
            tracing::info!(
                "Job {}: reconciled PR URL {} from agent output onto {}",
                job.id,
                url,
                job.plan_file
            );
            plan.prs.push(url);
            plan.updated = chrono::Utc::now();
            if let Err(e) = write_plan_yaml(&plan_folder, &plan) {
                tracing::warn!(
                    "Job {}: failed to record reconciled PR URL on {}: {}",
                    job.id,
                    job.plan_file,
                    e
                );
            }
        }
    }

    if plan.prs.is_empty() {
        return Deliverable::Missing {
            reason: "CreatePr completed but no pull request URL was recorded on the plan"
                .to_string(),
            cleanup: Cleanup::PreserveWork,
        };
    }

    Deliverable::Present
}

/// The first GitHub pull request URL anywhere in the output. Tool results count here — `gh pr create`
/// prints the URL it just created, and that is the most reliable evidence there is.
fn scrape_pr_url(output_lines: &[String]) -> Option<String> {
    for line in output_lines {
        if let Some(m) = PR_URL_RE.find(line) {
            return Some(m.as_str().to_string());
        }
    }
    None
}

/// Revisions written into a plan folder, under either capitalisation of the directory.
pub fn revision_count(plan_folder: &Path) -> usize {
    let mut count = 0;
    for sub in ["Revisions", "revisions"] {
        let dir = plan_folder.join(sub);
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            count += entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("md"))
                .count();
        }
    }
    count
}

/// The plan folder a CreatePlan run produced, in legacy order: the id the agent reported, then the
/// first `PlanId: <id>` in its output, then a lookup by id under `plans_dir`.
pub fn resolve_created_plan_folder(
    plans_dir: &Path,
    job: &JobItem,
    output_lines: &[String],
) -> Option<PathBuf> {
    if !job.plan_file.is_empty() {
        let existing = PathBuf::from(&job.plan_file);
        if existing.is_dir() {
            return Some(existing);
        }
    }

    let mut candidates: Vec<String> = Vec::new();
    if let Some(id) = &job.reported_plan_id {
        if !id.trim().is_empty() {
            candidates.push(id.trim().to_string());
        }
    }
    for line in output_lines {
        if let Some(caps) = PLAN_ID_RE.captures(line) {
            if let Some(id) = caps.get(1) {
                candidates.push(id.as_str().to_string());
            }
        }
    }

    candidates
        .into_iter()
        .find_map(|id| find_plan_folder_by_id(plans_dir, &id))
}

/// The folder under `plans_dir` whose 5-digit prefix matches `id`, which may be given unpadded.
fn find_plan_folder_by_id(plans_dir: &Path, id: &str) -> Option<PathBuf> {
    let digits: String = id.chars().filter(|c| c.is_ascii_digit()).collect();
    let padded = format!("{:0>5}", digits.parse::<i32>().ok()?);

    std::fs::read_dir(plans_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(&padded))
        })
}

/// Whether the run declined to create a plan because it found an existing one.
///
/// Only the agent's own text counts — never a tool result — because the marker is documented in
/// `Program.md`, and a run that merely *reads* that file must not be able to suppress a real failure.
/// The target has to resolve on disk too: an unresolvable target is not a duplicate, so the job fails.
pub fn is_duplicate_plan(plans_dir: &Path, output_lines: &[String]) -> bool {
    for line in output_lines {
        let Some(text) = agent_text(line) else {
            continue;
        };
        let Some(caps) = DUPLICATE_RE.captures(&text) else {
            continue;
        };
        let Some(target) = caps.get(1) else { continue };

        let token = target
            .as_str()
            .trim_matches(|c: char| "`\"'.,;)]".contains(c));
        if token.is_empty() {
            continue;
        }

        if plans_dir.join(token).is_dir() {
            return true;
        }
        if find_plan_folder_by_id(plans_dir, token).is_some() {
            return true;
        }
    }
    false
}

/// Deletes an orphan plan folder and its database row.
///
/// Refuses any path that is not a direct child of `plans_dir` with a `NNNNN-` name, so a bad resolve
/// upstream can never delete something else. Returns whether the folder was removed.
pub fn cleanup_plan_folder_and_database(
    tendril_home: &Path,
    plans_dir: &Path,
    folder: &Path,
) -> bool {
    let Some(name) = folder.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if folder.parent() != Some(plans_dir) || !PLAN_FOLDER_RE.is_match(name) {
        tracing::warn!(
            "Refusing to clean up {}: not a plan folder directly under {}",
            folder.display(),
            plans_dir.display()
        );
        return false;
    }

    if let Ok(id) = name[..5].parse::<i32>() {
        let db_path = crate::config::get_database_path(tendril_home);
        match open_database(&db_path) {
            Ok(conn) => {
                if let Err(e) = crate::db::plans::delete_plan(&conn, id) {
                    tracing::warn!("Failed to delete plan row {}: {}", id, e);
                }
            }
            Err(e) => tracing::warn!("Failed to open database to delete plan row {}: {}", id, e),
        }
    }

    match std::fs::remove_dir_all(folder) {
        Ok(()) => {
            tracing::info!("Removed orphan plan folder {}", folder.display());
            true
        }
        Err(e) => {
            tracing::warn!(
                "Failed to remove orphan plan folder {}: {}",
                folder.display(),
                e
            );
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(job_type: &str, plan_file: &str) -> JobItem {
        JobItem::new(
            "00001".to_string(),
            job_type.to_string(),
            plan_file.to_string(),
            "Test".to_string(),
        )
    }

    #[test]
    fn a_job_type_outside_the_verified_set_is_always_present() {
        let mut j = job("ExpandPlan", "");
        assert_eq!(
            verify_deliverable(Path::new("/nope"), &mut j, &[]),
            Deliverable::Present
        );
    }

    #[test]
    fn cleanup_refuses_a_path_outside_the_plans_dir() {
        let dir = std::env::temp_dir().join(format!("tendril-cleanup-{}", uuid::Uuid::new_v4()));
        let plans_dir = dir.join("Plans");
        let outside = dir.join("00001-NotAPlan");
        std::fs::create_dir_all(&plans_dir).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        assert!(!cleanup_plan_folder_and_database(
            &dir, &plans_dir, &outside
        ));
        assert!(outside.is_dir(), "the folder must be left alone");

        let unnamed = plans_dir.join("scratch");
        std::fs::create_dir_all(&unnamed).unwrap();
        assert!(!cleanup_plan_folder_and_database(
            &dir, &plans_dir, &unnamed
        ));
        assert!(unnamed.is_dir(), "the folder must be left alone");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_duplicate_marker_in_a_tool_result_is_not_a_duplicate() {
        let dir = std::env::temp_dir().join(format!("tendril-dup-{}", uuid::Uuid::new_v4()));
        let plans_dir = dir.join("Plans");
        std::fs::create_dir_all(plans_dir.join("00001-ExistingPlan")).unwrap();

        let in_text =
            r#"{"kind":"text","text":"identified as duplicate: 00001-ExistingPlan"}"#.to_string();
        let in_tool = r#"{"kind":"tool_result","tool_use_id":"t","output":"identified as duplicate: 00001-ExistingPlan","is_error":false}"#;

        assert!(is_duplicate_plan(&plans_dir, &[in_text]));
        assert!(!is_duplicate_plan(&plans_dir, &[in_tool.to_string()]));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unresolvable_duplicate_target_is_not_a_duplicate() {
        let dir = std::env::temp_dir().join(format!("tendril-dup2-{}", uuid::Uuid::new_v4()));
        let plans_dir = dir.join("Plans");
        std::fs::create_dir_all(&plans_dir).unwrap();

        let line = r#"{"kind":"text","text":"identified as duplicate: 09999-Imaginary"}"#;
        assert!(!is_duplicate_plan(&plans_dir, &[line.to_string()]));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scrapes_a_pr_url_out_of_tool_output() {
        let lines = vec![
            "some noise".to_string(),
            "https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/42".to_string(),
        ];
        assert_eq!(
            scrape_pr_url(&lines).as_deref(),
            Some("https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/42")
        );
        assert_eq!(scrape_pr_url(&["nothing here".to_string()]), None);
    }
}
