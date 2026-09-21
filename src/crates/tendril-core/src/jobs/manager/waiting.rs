//! The wait-for-jobs gate: holding a job `Blocked` until its dependencies finish, and letting it go
//! when they do.
//!
//! [`wait_for_jobs_block`] is the gate, evaluated both at submission and on every maintenance pass.
//! [`release_wait_dependents`] is the other end of it, run whenever a job reaches a terminal status.
//! The two restore entry points are here too: a restart empties the in-memory map, and every path
//! that can release a blocked job reads that map rather than SQLite.

use super::dispatch::spawn_dispatcher;
use super::events::persist;
use super::internals::{ensure_handle, lookup_job, DispatchContext, JobManager, WaitOutcome};
use super::plan_state::{
    apply_plan_state, in_flight_plan_state, revert_plan_state, sync_plan_state_to_db,
};
use crate::models::{JobItem, JobStatus};
use chrono::Utc;
use std::path::Path;

impl JobManager {
    /// Puts a job that was still waiting in the queue when the daemon stopped back onto it.
    ///
    /// The queue itself is in-memory, so a restart loses it; the `Queued` rows in the database are
    /// the durable record, and this is how they are read back. Without it such a job never runs
    /// again, and it does not fail either — it sits `Queued` forever, which is worse than losing it:
    /// startup reconciliation treats its plan as live and so never reverts it out of `Executing`,
    /// and the conflict guard counts the row as in-flight and rejects every resubmission naming a
    /// job that will never start. The only way out was `force-start` on each one.
    ///
    /// The in-memory insert is not optional. `drain_queue` re-reads the job from `self.jobs` after
    /// popping its id and silently drops an id it cannot find, and that map is empty on a fresh
    /// process — so enqueueing alone would lose the job a second time, quietly.
    pub async fn requeue_restored(&self, job: JobItem) {
        let id = job.id.clone();
        let priority = job.priority;
        self.jobs.write().await.insert(id.clone(), job);
        self.enqueue(&id, priority).await;
    }

    /// Puts a job that was still `Blocked` when the daemon stopped back into the in-memory map, with
    /// no enqueue: its gate has not been re-run yet, so it is still waiting by default.
    ///
    /// This is the map-only counterpart to [`Self::requeue_restored`], and it exists because every
    /// path that can ever release a blocked job reads the map, not SQLite: both blocked sweeps in
    /// [`Self::run_maintenance_pass_with`] and [`release_wait_dependents`] on the live path all
    /// filter `self.jobs` for `JobStatus::Blocked`. A restart empties that map, so without this a
    /// `Blocked` row is invisible to all three — which strands it, rather than merely delaying it.
    /// It never runs, and it never fails either: `find_conflicting_job` reads SQLite, so the row
    /// still counts as in-flight and every resubmission naming its plan is refused.
    ///
    /// Restoring it is what a live daemon looks like anyway. `start_job` inserts the job and returns
    /// early at its gate without enqueueing, and `evict_stale_jobs` only drops terminal jobs, so on a
    /// daemon that never died the blocked job is sitting in this same map waiting for the same sweeps.
    pub async fn restore_blocked(&self, job: JobItem) {
        self.jobs.write().await.insert(job.id.clone(), job);
    }

    /// Re-runs the wait-for gate for every `Blocked` job listing `finished_id`, enqueueing the ones
    /// that are now satisfied and failing the ones whose dependency ended badly. Returns the ids
    /// released.
    pub async fn release_wait_dependents(&self, finished_id: &str) -> Vec<String> {
        release_wait_dependents(&self.ctx(), finished_id).await
    }
}

/// Human-readable dependency description: `"ExecutePlan of plan 00123 (job 00456)"`, or
/// `"CreatePr (job 00456)"` when no plan id can be resolved.
pub fn describe_wait_dependency(dep: &JobItem) -> String {
    let plan_id = dep.resolve_plan_id();
    if plan_id.is_empty() {
        format!("{} (job {})", dep.job_type, dep.id)
    } else {
        format!("{} of plan {} (job {})", dep.job_type, plan_id, dep.id)
    }
}

/// Whether `job` must wait, and why. `None` means it may proceed.
///
/// An unknown dependency id is not a reason to wait: it names a job that no longer exists, and
/// stranding the waiter forever would be worse than letting it run.
pub(super) async fn wait_for_jobs_block(
    ctx: &DispatchContext,
    job: &JobItem,
) -> Option<WaitOutcome> {
    if job.wait_for_job_ids.is_empty() {
        return None;
    }

    let mut pending = Vec::new();
    for dep_id in &job.wait_for_job_ids {
        if dep_id == &job.id {
            continue;
        }
        let Some(dep) = lookup_job(ctx, dep_id).await else {
            continue;
        };
        match dep.status {
            JobStatus::Completed => {}
            JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped => {
                return Some(WaitOutcome::Failed(format!(
                    "Blocked job {} failed",
                    dep.id
                )));
            }
            _ => pending.push(describe_wait_dependency(&dep)),
        }
    }

    if pending.is_empty() {
        None
    } else {
        Some(WaitOutcome::Blocked(format!(
            "Waiting for {}",
            pending.join(", ")
        )))
    }
}

/// Re-runs the wait-for gate for every `Blocked` job listing `finished_id`.
pub(super) async fn release_wait_dependents(
    ctx: &DispatchContext,
    finished_id: &str,
) -> Vec<String> {
    let waiting: Vec<JobItem> = ctx
        .jobs
        .read()
        .await
        .values()
        .filter(|j| {
            j.status == JobStatus::Blocked && j.wait_for_job_ids.iter().any(|id| id == finished_id)
        })
        .cloned()
        .collect();

    let mut released = Vec::new();
    for job in waiting {
        match wait_for_jobs_block(ctx, &job).await {
            None => {
                let id = job.id.clone();
                release_blocked_job(ctx, job).await;
                released.push(id);
            }
            Some(WaitOutcome::Failed(reason)) => {
                let mut failed = job;
                failed.status = JobStatus::Failed;
                failed.status_message = Some(reason);
                failed.completed_at = Some(Utc::now());
                revert_plan_state(&failed);
                persist(&ctx.tendril_home, &ctx.jobs, &failed, Some(&ctx.events)).await;
            }
            Some(WaitOutcome::Blocked(reason)) => {
                // Still waiting on something else; keep the message current.
                if job.status_message.as_deref() != Some(reason.as_str()) {
                    let mut still_blocked = job;
                    still_blocked.status_message = Some(reason);
                    persist(
                        &ctx.tendril_home,
                        &ctx.jobs,
                        &still_blocked,
                        Some(&ctx.events),
                    )
                    .await;
                }
            }
        }
    }

    released
}

/// Moves a `Blocked` job to `Queued`, transitions its plan to the in-flight state and enqueues it.
pub(super) async fn release_blocked_job(ctx: &DispatchContext, mut job: JobItem) {
    job.status = JobStatus::Queued;
    job.status_message = None;
    job.completed_at = None;
    job.started_at = Some(Utc::now());
    if let Some(state) = in_flight_plan_state(&job.job_type) {
        apply_plan_state(Path::new(&job.plan_file), state);
        // The other end of `JobManager::set_plan_state`: a job released from `Blocked` claims its
        // plan here instead, and its row has to move with it.
        sync_plan_state_to_db(&ctx.tendril_home, Path::new(&job.plan_file));
    }
    persist(&ctx.tendril_home, &ctx.jobs, &job, Some(&ctx.events)).await;

    ensure_handle(&ctx.handles, &job.id).await;
    ctx.queue.lock().await.push(job.id.clone(), job.priority);
    // A release is an enqueue, so it has to arm the dispatcher too: the first job a manager sees can
    // be one that blocks, in which case nothing has gone through `enqueue` and there is no
    // `dispatch_loop` alive to hear the notification.
    spawn_dispatcher(ctx);
    ctx.dispatch_notify.notify_one();
}
