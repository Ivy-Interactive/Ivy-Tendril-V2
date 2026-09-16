use crate::agents::runner::parse_terminal_result_event;
use crate::config::{
    get_database_path, get_plans_dir_with_settings, is_process_running, TendrilSettings,
};
use crate::db::jobs::{insert_job, list_non_terminal_jobs};
use crate::db::open_database;
use crate::error::Result;
use crate::jobs::deliverable::{verify_deliverable, Deliverable};
use crate::jobs::logger::{read_eventwire_log, read_raw_log};
use crate::jobs::manager::{
    apply_plan_state, plan_state_on_success, revert_plan_state, JobManager,
};
use crate::models::{JobItem, JobStatus, PlanStatus};
use crate::plans::dependencies::{get_gh_pr_state, unblock_satisfied_plans_with, PrStateResolver};
use crate::plans::reader::read_plan_yaml;
use crate::plans::verification_gate::resolve_post_execution_state;
use chrono::Utc;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const RESTART_MESSAGE: &str = "Interrupted by Tendril master restart";

#[derive(Debug, Default, Clone)]
pub struct ReconcileReport {
    /// Jobs whose agent process is still alive; left running detached.
    pub live_jobs: Vec<String>,
    /// Jobs whose work survived the restart — see [`resolve_interrupted_job`] for what counts as
    /// survived, per job type.
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
///
/// `job_manager` is `Some` once the server has a manager to hand surviving jobs to: each `Running` row
/// found with a live PID is registered with it via [`JobManager::supervise_detached`], so it reaches a
/// terminal state on its own instead of sitting in `report.live_jobs` forever. `None` in every test
/// that only wants the reconciliation report itself.
pub async fn reconcile_jobs_on_startup(
    tendril_home: &Path,
    settings: &TendrilSettings,
    job_manager: Option<&Arc<JobManager>>,
) -> Result<ReconcileReport> {
    reconcile_jobs_with(
        tendril_home,
        &get_plans_dir_with_settings(tendril_home, Some(settings)),
        settings,
        &get_gh_pr_state,
        job_manager,
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
    job_manager: Option<&Arc<JobManager>>,
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
                    if let Some(manager) = job_manager {
                        manager.supervise_detached(job.id.clone()).await;
                    }
                    continue;
                }

                match resolve_interrupted_job(tendril_home, plans_dir, &mut job) {
                    InterruptedOutcome::WorkIntact => {
                        job.status = JobStatus::Completed;
                        job.status_message =
                            Some(format!("{} (work was already complete)", RESTART_MESSAGE));
                        job.completed_at = Some(Utc::now());
                        let plan_folder = Path::new(&job.plan_file);
                        if let Ok((plan, _)) = read_plan_yaml(plan_folder) {
                            if let Some(state) =
                                plan_state_on_success(&job.job_type, &plan, plan_folder)
                            {
                                apply_plan_state(plan_folder, state);
                            }
                        }
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
                // No process was ever started for these, so they are re-queued rather than failed:
                // the rows are the durable queue the in-memory heap does not survive a restart with.
                // Leaving them alone is not neutral — the plan below stays `Executing` because this
                // job counts as live, and the conflict guard counts the row as in-flight and rejects
                // every resubmission, so the plan wedges until someone force-starts the job by hand.
                //
                // `Pending` predates `Queued` as the pre-dispatch status and nothing sets it now; the
                // dispatcher only launches `Queued`, so it is normalised on the way back in.
                job.status = JobStatus::Queued;
                let _ = insert_job(&conn, &job);
                if let Some(manager) = job_manager {
                    manager.requeue_restored(job.clone()).await;
                }
                report.queued_jobs.push(job.id.clone());
            }
            // A blocked job's gate is re-run by the maintenance sweeps rather than here, so its row
            // is left as it stands — but it has to be handed to the manager all the same. Every
            // path that can release one (both blocked sweeps in `run_maintenance_pass_with`, and
            // `release_wait_dependents` when a dependency finishes) filters the in-memory map, which
            // a restart empties, so a row left out of it is released by nothing. See
            // [`JobManager::restore_blocked`].
            //
            // `unblock_satisfied_plans` below is not a substitute: it moves *plans* out of `Blocked`
            // on disk and never looks at a job row, so on its own it leaves the job blocked behind a
            // plan that is no longer waiting for anything.
            JobStatus::Blocked => {
                if let Some(manager) = job_manager {
                    manager.restore_blocked(job.clone()).await;
                }
            }
            _ => {}
        }
    }

    report.unblocked_plans =
        unblock_satisfied_plans_with(plans_dir, resolve_pr_state).unwrap_or_default();
    report.reverted_plans = revert_orphaned_plans(plans_dir, &live_plan_folders);

    let _ = settings;
    Ok(report)
}

pub(crate) enum InterruptedOutcome {
    /// The agent finished its work before the daemon died: nothing to revert.
    WorkIntact,
    /// The job did not finish; its plan goes back where it started.
    Incomplete,
}

/// Decides whether an interrupted job's work survived, whatever end its process met: found already
/// dead by startup reconciliation, or exited later under [`JobManager::supervise_detached`]. Either
/// way there is no exit code to trust — the daemon that would have captured one is the one that died
/// — so every branch here reads only evidence already on disk.
///
/// `ExecutePlan`/`RetryPlan` are judged by the same verification gate the normal completion path
/// uses, so "finished" has one definition. `CreatePlan` and `CreatePr` reuse [`verify_deliverable`],
/// the same domain check `finish_job` runs on a live completion, so a plan revision or a recorded PR
/// URL survives a restart exactly as it would survive nothing happening at all. Every other job type
/// gets one last look at the tail of its eventwire log for an explicit terminal result before falling
/// back to incomplete: `Program.md` firmware for those types has no revision or PR URL to check, but
/// an agent that did report success or failure before the log went silent is not `Incomplete` by
/// definition.
pub(crate) fn resolve_interrupted_job(
    tendril_home: &Path,
    plans_dir: &Path,
    job: &mut JobItem,
) -> InterruptedOutcome {
    match job.job_type.as_str() {
        "ExecutePlan" | "RetryPlan" => {
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
        "CreatePlan" | "CreatePr" => {
            let output_lines = collect_output_lines(tendril_home, &job.id);
            // Verified against a throwaway copy: `verify_deliverable` clears `plan_file` on an
            // unresolved `CreatePlan`, which would break `revert_plan_state`'s later use of it on the
            // `Incomplete` path. Only a confirmed `Present` folder is worth copying back.
            let mut probe = job.clone();
            match verify_deliverable(plans_dir, &mut probe, &output_lines) {
                Deliverable::Present => {
                    job.plan_file = probe.plan_file;
                    InterruptedOutcome::WorkIntact
                }
                Deliverable::Missing { .. } => InterruptedOutcome::Incomplete,
            }
        }
        _ => {
            let tail = read_eventwire_log(tendril_home, &job.id, Some(20))
                .unwrap_or_default()
                .unwrap_or_default();
            for line in tail.iter().rev() {
                if let Some(outcome) = parse_terminal_result_event(line) {
                    return if outcome.is_success {
                        InterruptedOutcome::WorkIntact
                    } else {
                        InterruptedOutcome::Incomplete
                    };
                }
            }
            InterruptedOutcome::Incomplete
        }
    }
}

/// The same raw-plus-eventwire concatenation `finish_job` reads before deliverable verification, so
/// a job resolved here and one resolved on the live completion path are judged from the same evidence.
fn collect_output_lines(tendril_home: &Path, job_id: &str) -> Vec<String> {
    let mut output_lines = Vec::new();
    if let Ok(Some(raw_lines)) = read_raw_log(tendril_home, job_id, None) {
        output_lines.extend(raw_lines);
    }
    if let Ok(Some(ev_lines)) = read_eventwire_log(tendril_home, job_id, None) {
        output_lines.extend(ev_lines);
    }
    output_lines
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
