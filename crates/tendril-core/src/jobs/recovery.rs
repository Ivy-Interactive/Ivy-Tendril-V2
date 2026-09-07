use crate::config::{
    get_database_path, get_plans_dir_with_settings, is_process_running, TendrilSettings,
};
use crate::db::jobs::{insert_job, list_non_terminal_jobs};
use crate::db::open_database;
use crate::error::Result;
use crate::jobs::manager::{apply_plan_state, revert_plan_state};
use crate::models::{JobItem, JobStatus, PlanStatus};
use crate::plans::dependencies::{get_gh_pr_state, unblock_satisfied_plans_with, PrStateResolver};
use crate::plans::reader::read_plan_yaml;
use crate::plans::verification_gate::resolve_post_execution_state;
use chrono::Utc;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const RESTART_MESSAGE: &str = "Interrupted by Tendril master restart";

#[derive(Debug, Default, Clone)]
pub struct ReconcileReport {
    /// Jobs whose agent process is still alive; left running detached.
    pub live_jobs: Vec<String>,
    /// Jobs whose work survived the restart (the verification gate resolved to `Review`).
    pub completed_jobs: Vec<String>,
    /// Jobs marked `Failed` because their process is gone and their work is incomplete.
    pub failed_jobs: Vec<String>,
    /// Jobs left `Queued`; they never had a process.
    pub queued_jobs: Vec<String>,
    /// Blocked plans whose dependencies are now satisfied, moved back to `Draft`.
    pub unblocked_plans: Vec<String>,
    /// Plans left mid-flight with no live job, reverted to `Draft`.
    pub reverted_plans: Vec<String>,
}

/// Brings persisted job and plan state back in line with reality after a daemon restart.
///
/// Must be called only once the master lock is held: a second daemon that lost the master race would
/// otherwise reap the winner's live jobs. Idempotent — a second run finds nothing left to do.
pub async fn reconcile_jobs_on_startup(
    tendril_home: &Path,
    settings: &TendrilSettings,
) -> Result<ReconcileReport> {
    reconcile_jobs_with(
        tendril_home,
        &get_plans_dir_with_settings(tendril_home, Some(settings)),
        settings,
        &get_gh_pr_state,
    )
    .await
}

/// [`reconcile_jobs_on_startup`] with the plans directory and the PR-state lookup supplied
/// explicitly, so tests can point it at a fixture without inheriting `TENDRIL_PLANS` and without
/// invoking `gh`.
pub async fn reconcile_jobs_with(
    tendril_home: &Path,
    plans_dir: &Path,
    settings: &TendrilSettings,
    resolve_pr_state: PrStateResolver<'_>,
) -> Result<ReconcileReport> {
    let mut report = ReconcileReport::default();

    let db_path = get_database_path(tendril_home);
    let conn = open_database(&db_path)?;
    let jobs = list_non_terminal_jobs(&conn)?;

    // Plan folders belonging to a job that is genuinely still running. Those plans must not be
    // reverted below.
    let mut live_plan_folders: HashSet<String> = HashSet::new();

    for mut job in jobs {
        // A job that is still going somewhere — alive, queued or waiting on a dependency — owns its
        // plan's mid-flight state, so `revert_orphaned_plans` must leave that plan alone.
        let still_pending = match job.status {
            JobStatus::Running => job.process_id.is_some_and(is_process_running),
            JobStatus::Queued | JobStatus::Pending | JobStatus::Blocked => true,
            _ => false,
        };
        if still_pending && !job.plan_file.is_empty() {
            live_plan_folders.insert(job.plan_file.clone());
        }

        match job.status {
            JobStatus::Running => {
                if still_pending {
                    report.live_jobs.push(job.id.clone());
                    continue;
                }

                match resolve_interrupted_job(&job) {
                    InterruptedOutcome::WorkIntact => {
                        job.status = JobStatus::Completed;
                        job.status_message =
                            Some(format!("{} (work was already complete)", RESTART_MESSAGE));
                        job.completed_at = Some(Utc::now());
                        apply_plan_state(Path::new(&job.plan_file), PlanStatus::Review);
                        report.completed_jobs.push(job.id.clone());
                    }
                    InterruptedOutcome::Incomplete => {
                        job.status = JobStatus::Failed;
                        job.status_message = Some(RESTART_MESSAGE.to_string());
                        job.completed_at = Some(Utc::now());
                        revert_plan_state(&job);
                        report.failed_jobs.push(job.id.clone());
                    }
                }
                let _ = insert_job(&conn, &job);
            }
            JobStatus::Queued | JobStatus::Pending => {
                // No process was ever started for these. Re-enqueueing across restarts needs a
                // durable queue, so they are simply left as they are.
                report.queued_jobs.push(job.id.clone());
            }
            // Blocked jobs are handled wholesale by `unblock_satisfied_plans` below.
            _ => {}
        }
    }

    report.unblocked_plans =
        unblock_satisfied_plans_with(plans_dir, resolve_pr_state).unwrap_or_default();
    report.reverted_plans = revert_orphaned_plans(plans_dir, &live_plan_folders);

    let _ = settings;
    Ok(report)
}

enum InterruptedOutcome {
    /// The agent finished its work before the daemon died: nothing to revert.
    WorkIntact,
    /// The job did not finish; its plan goes back where it started.
    Incomplete,
}

/// Decides whether an interrupted job's work survived.
///
/// Execution jobs are judged by the same verification gate the normal completion path uses, so
/// "finished" has one definition. Every other job type is incomplete by definition: a half-run
/// `CreatePlan` or `UpdatePlan` has not produced its revision, and its plan's verification rows say
/// nothing about that.
fn resolve_interrupted_job(job: &JobItem) -> InterruptedOutcome {
    if !matches!(job.job_type.as_str(), "ExecutePlan" | "RetryPlan") {
        return InterruptedOutcome::Incomplete;
    }

    let plan_folder = PathBuf::from(&job.plan_file);
    if !plan_folder.is_dir() {
        return InterruptedOutcome::Incomplete;
    }

    let Ok((plan, _)) = read_plan_yaml(&plan_folder) else {
        return InterruptedOutcome::Incomplete;
    };

    if resolve_post_execution_state(&plan, &plan_folder) == PlanStatus::Review {
        InterruptedOutcome::WorkIntact
    } else {
        InterruptedOutcome::Incomplete
    }
}

/// Any plan still in `Creating`, `Updating` or `Executing` with no live job behind it goes back to
/// `Draft`, so a killed daemon cannot leave a plan permanently mid-flight.
fn revert_orphaned_plans(plans_dir: &Path, live_plan_folders: &HashSet<String>) -> Vec<String> {
    let mut reverted = Vec::new();
    let Ok(entries) = std::fs::read_dir(plans_dir) else {
        return reverted;
    };

    for entry in entries.flatten() {
        let folder = entry.path();
        if !folder.is_dir() || !folder.join("plan.yaml").exists() {
            continue;
        }
        if live_plan_folders.contains(&folder.to_string_lossy().to_string()) {
            continue;
        }

        let Ok((plan, _)) = read_plan_yaml(&folder) else {
            continue;
        };
        if !matches!(
            PlanStatus::from_str_loose(&plan.state),
            Some(PlanStatus::Creating) | Some(PlanStatus::Updating) | Some(PlanStatus::Executing)
        ) {
            continue;
        }

        apply_plan_state(&folder, PlanStatus::Draft);
        reverted.push(
            folder
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string(),
        );
    }

    reverted.sort();
    reverted
}
