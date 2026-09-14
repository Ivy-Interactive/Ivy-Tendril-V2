//! Releases whatever was waiting on a job once it finishes.
//!
//! A plan that depends on another sits in `Blocked`, and so does the job someone queued for it. Both
//! are re-gated here when the blocker finishes, so a dependency chain drains on its own instead of
//! needing a human to notice and re-queue.
//!
//! This is the single seam for dependent release. [Plan 00551](plan://00551) owns the job-level
//! `waitForJobs` mechanism; when it lands, its handling belongs in [`release_dependents`] next to the
//! plan-level half, not in a second function.

use crate::db::jobs::{delete_job, list_jobs};
use crate::db::open_database;
use crate::jobs::manager::JobManager;
use crate::models::{JobItem, JobStatus};
use crate::plans::dependencies::{check_dependencies, unblock_satisfied_plans};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

/// What a release actually did. Used for logging and by tests; nothing branches on it.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ReleaseReport {
    /// Plan folders moved out of `Blocked`.
    pub unblocked_plans: Vec<String>,
    /// IDs of the jobs started to replace released `Blocked` rows.
    pub restarted_jobs: Vec<String>,
    /// Waiters failed because their blocker failed. Populated once 00551's `waitForJobs` lands.
    pub failed_dependents: Vec<String>,
}

/// Job types whose completion can satisfy a dependency.
fn releases_dependents(job_type: &str) -> bool {
    matches!(
        job_type,
        "ExecutePlan" | "RetryPlan" | "CreatePr" | "CreateIssue"
    )
}

/// Re-gates the plans and jobs that were waiting on `finished`.
///
/// `manager` is the capability to start a job. It is optional because `finish_job` reaches this
/// through a `Weak<JobManager>`: a manager that was never published as an `Arc` (every test that
/// builds one directly) simply performs no restarts, which is the right behaviour rather than a
/// reason to fail.
///
/// `plans_dir` is passed in rather than looked up so that an ambient `TENDRIL_PLANS` cannot point a
/// test at the operator's real plans directory.
pub async fn release_dependents(
    tendril_home: &Path,
    plans_dir: &Path,
    jobs_map: &Arc<RwLock<HashMap<String, JobItem>>>,
    manager: Option<&Arc<JobManager>>,
    finished: &JobItem,
) -> ReleaseReport {
    let mut report = ReleaseReport::default();
    if !releases_dependents(&finished.job_type) {
        return report;
    }

    // 1. Plans: move every now-satisfied Blocked plan back to Draft.
    match unblock_satisfied_plans(plans_dir) {
        Ok(unblocked) => report.unblocked_plans = unblocked,
        Err(e) => tracing::warn!(
            "Job {}: failed to re-gate blocked plans in {}: {}",
            finished.id,
            plans_dir.display(),
            e
        ),
    }

    // 2. Jobs: re-run the gate for every Blocked row and restart the ones that now pass.
    report.restarted_jobs =
        restart_unblocked_jobs(tendril_home, plans_dir, jobs_map, manager).await;

    if !report.unblocked_plans.is_empty() || !report.restarted_jobs.is_empty() {
        tracing::info!(
            "Job {} released dependents: plans [{}], jobs [{}]",
            finished.id,
            report.unblocked_plans.join(", "),
            report.restarted_jobs.join(", ")
        );
    }

    report
}

/// Replaces each satisfied `Blocked` job row with a fresh job.
///
/// The stale row is deleted rather than flipped to `Queued`: a `Blocked` row was never spawned, so it
/// has no handle and no runner. Starting afresh through [`JobManager::start_job`] re-runs the
/// dependency gate, which means this cannot start something that is still blocked even if the gate's
/// answer changed between the two calls.
async fn restart_unblocked_jobs(
    tendril_home: &Path,
    plans_dir: &Path,
    jobs_map: &Arc<RwLock<HashMap<String, JobItem>>>,
    manager: Option<&Arc<JobManager>>,
) -> Vec<String> {
    let mut restarted = Vec::new();

    let db_path = crate::config::get_database_path(tendril_home);
    let blocked: Vec<JobItem> = match open_database(&db_path) {
        Ok(conn) => match list_jobs(&conn, Some(JobStatus::Blocked), 500) {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("Failed to list blocked jobs: {}", e);
                return restarted;
            }
        },
        Err(e) => {
            tracing::warn!("Failed to open database to list blocked jobs: {}", e);
            return restarted;
        }
    };

    for row in blocked {
        let plan_folder = Path::new(&row.plan_file);
        if !plan_folder.is_dir() {
            continue;
        }
        match check_dependencies(plan_folder, plans_dir) {
            Ok(res) if res.ok => {}
            Ok(_) => continue,
            Err(e) => {
                tracing::warn!("Blocked job {}: dependency re-check failed: {}", row.id, e);
                continue;
            }
        }

        let Some(args) = row.typed_args.clone() else {
            tracing::warn!(
                "Blocked job {} has no typed args and cannot be restarted",
                row.id
            );
            continue;
        };

        let Some(manager) = manager else {
            // No manager published: leave the row alone so a later completion can release it.
            continue;
        };

        if let Ok(conn) = open_database(&db_path) {
            if let Err(e) = delete_job(&conn, &row.id) {
                tracing::warn!("Failed to delete blocked job row {}: {}", row.id, e);
                continue;
            }
        } else {
            continue;
        }
        jobs_map.write().await.remove(&row.id);

        match manager.start_job(args).await {
            Ok(new_id) => {
                tracing::info!("Restarted blocked job {} as {}", row.id, new_id);
                restarted.push(new_id);
            }
            Err(e) => tracing::warn!("Failed to restart blocked job {}: {}", row.id, e),
        }
    }

    restarted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plan_bearing_job_types_release_dependents() {
        assert!(releases_dependents("ExecutePlan"));
        assert!(releases_dependents("RetryPlan"));
        assert!(releases_dependents("CreatePr"));
        assert!(releases_dependents("CreateIssue"));
        assert!(!releases_dependents("CreatePlan"));
        assert!(!releases_dependents("SyncRepo"));
    }
}
