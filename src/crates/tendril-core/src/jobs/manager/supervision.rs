//! Jobs whose process outlived the daemon that launched it.
//!
//! A detached agent keeps running when Tendril restarts, so its completion has no runner task left
//! to claim it. [`JobManager::supervise_detached`] re-attaches a handle to the surviving PID and
//! [`run_detached_supervisor`] polls until the process exits. [`stuck_job_reason`] is the backstop
//! for everything else: the maintenance pass's judgement on a `Running` job that has stopped
//! behaving like one.

use super::completion::finish_job;
use super::internals::{describe_window, DispatchContext, JobHandle, JobManager};
use super::waiting::release_wait_dependents;
use crate::config::get_plans_dir_with_settings;
use crate::jobs::dependents::release_dependents;
use crate::models::{JobItem, JobStatus};
use chrono::Utc;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

/// Grace on top of `staleOutputTimeout` before the maintenance pass reaps a `Running` job whose own
/// per-job watchdog never armed, because the launch itself hung.
pub const STUCK_JOB_REAP_GRACE: Duration = Duration::from_secs(120);
/// Extra margin on top of `jobTimeout` before the maintenance pass hard-caps a `Running` job.
pub const STUCK_JOB_HARD_CAP_MARGIN: Duration = Duration::from_secs(300);

impl JobManager {
    /// Registers a `Running` job whose PID survived a daemon restart, so something watches it through
    /// to a terminal state.
    ///
    /// Called from [`crate::jobs::recovery::reconcile_jobs_with`] for each row it finds `Running` with
    /// a live PID. `find_conflicting_job`'s doc comment explains why that reconciliation pass leaves
    /// the in-memory map alone on its own: inserting a bare `Running` row would arm the stale-output
    /// watchdog and the per-job timeout against a process nothing here launched. This differs from
    /// that in the one way that matters — it attaches a real [`JobHandle`] with the surviving PID
    /// already in it — which is what lets [`cancel_job`](Self::cancel_job) and the stuck-job guard in
    /// [`stuck_job_reason`] treat this job correctly instead of not seeing it at all.
    ///
    /// Requires `Arc<Self>` because the supervisor task it spawns outlives any borrow of `&self`.
    /// Silently does nothing for a job that is not `Running`, has no live PID, or is already
    /// supervised — every one of those is the ordinary case of calling this twice, not an error.
    pub async fn supervise_detached(self: &Arc<Self>, job_id: String) {
        let Ok(Some(mut job)) = self.get_job(&job_id).await else {
            return;
        };
        if job.status != JobStatus::Running {
            return;
        }
        let Some(pid) = job
            .process_id
            .filter(|p| crate::config::is_process_running(*p))
        else {
            return;
        };

        {
            let mut handles = self.handles.write().await;
            if handles.contains_key(&job_id) {
                return;
            }
            let handle = JobHandle::new();
            handle.pid.store(pid, Ordering::SeqCst);
            handles.insert(job_id.clone(), handle);
        }

        job.detached = true;
        self.jobs.write().await.insert(job_id.clone(), job.clone());

        tokio::spawn(run_detached_supervisor(self.ctx(), job, pid));
    }
}

/// Why the maintenance pass considers a `Running` job stuck, if it does.
///
/// A detached job with a live PID is exempted from both checks below, not just the stale-output one:
/// its own supervisor ([`JobManager::supervise_detached`]) owns its completion once the daemon that
/// was capturing its output is gone, so `last_output_at` and `started_at` are frozen from the moment
/// the *old* daemon died and say nothing about whether the agent is still working. The exemption is
/// conditioned on `detached`, not on PID liveness alone: an ordinary job's own per-job watchdog can
/// still die independently of its process, which is exactly the case `STUCK_JOB_REAP_GRACE` exists to
/// catch, and a blanket "any live PID is fine" rule would silently defeat that backstop.
pub fn stuck_job_reason(
    job: &JobItem,
    now: chrono::DateTime<Utc>,
    stale_timeout: Option<Duration>,
    job_timeout: Option<Duration>,
) -> Option<String> {
    if job.detached
        && job
            .process_id
            .is_some_and(crate::config::is_process_running)
    {
        return None;
    }

    let elapsed_since = |at: chrono::DateTime<Utc>| (now - at).to_std().ok();

    if let (Some(stale), Some(anchor)) = (stale_timeout, job.last_output_at.or(job.started_at)) {
        if let Some(quiet) = elapsed_since(anchor) {
            if quiet > stale + STUCK_JOB_REAP_GRACE {
                return Some(format!(
                    "No agent output for {} (stuck job check)",
                    describe_window(quiet)
                ));
            }
        }
    }

    if let (Some(limit), Some(started)) = (job_timeout, job.started_at) {
        if let Some(running_for) = elapsed_since(started) {
            if running_for > limit + STUCK_JOB_HARD_CAP_MARGIN + STUCK_JOB_REAP_GRACE {
                return Some(format!(
                    "Running for {}, past its {} timeout (stuck job check)",
                    describe_window(running_for),
                    describe_window(limit)
                ));
            }
        }
    }

    None
}

/// Polls a detached job's surviving PID through to exit, then finalises it exactly as
/// [`spawn_runner`] finalises a job it launched itself.
///
/// The one thing this can never do that `spawn_runner` can is trust an exit code: the daemon whose
/// callback would have captured this agent's stdout is the one that restarted, so nothing has read a
/// line out of this process since. [`resolve_interrupted_job`](crate::jobs::recovery::resolve_interrupted_job)
/// is what supplies a status anyway, from the same on-disk evidence startup reconciliation uses for a
/// job found already dead — which is why `finish_job` is handed a tentative `Completed` or `Failed`
/// rather than something derived from `run_res`, there being no `run_res` here at all.
async fn run_detached_supervisor(ctx: DispatchContext, job: JobItem, pid: u32) {
    const POLL_INTERVAL: Duration = Duration::from_secs(2);
    let job_id = job.id.clone();

    let cancel_rx = {
        let handles = ctx.handles.read().await;
        handles.get(&job_id).map(|h| h.cancel_tx.subscribe())
    };

    loop {
        if !crate::config::is_process_running(pid) {
            break;
        }
        if let Some(rx) = &cancel_rx {
            if *rx.borrow() {
                // `cancel_job` claimed completion itself and is already tearing this job down.
                return;
            }
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }

    let Some(completion_claimed) = ({
        let handles = ctx.handles.read().await;
        handles.get(&job_id).map(|h| h.completion_claimed.clone())
    }) else {
        // The handle is gone: `cancel_job` already removed it and wrote the terminal state.
        return;
    };

    let tendril_home = ctx.tendril_home.clone();
    let settings = ctx.settings.read().await.clone();
    let plans_dir = ctx
        .plans_dir_override
        .clone()
        .unwrap_or_else(|| get_plans_dir_with_settings(&tendril_home, Some(&settings)));

    let mut job = job;
    let outcome =
        crate::jobs::recovery::resolve_interrupted_job(&tendril_home, &plans_dir, &mut job);
    let (final_status, msg) = match outcome {
        crate::jobs::recovery::InterruptedOutcome::WorkIntact => (
            JobStatus::Completed,
            "Detached process exited; its work was verified complete".to_string(),
        ),
        crate::jobs::recovery::InterruptedOutcome::Incomplete => (
            JobStatus::Failed,
            "Detached process exited without completing its work".to_string(),
        ),
    };
    let duration_seconds = job
        .started_at
        .map(|started| (Utc::now() - started).num_seconds());

    let jobs_map = ctx.jobs.clone();
    let handles = ctx.handles.clone();
    let finished = job.clone();
    let _ = finish_job(
        &tendril_home,
        &plans_dir,
        &jobs_map,
        &handles,
        &completion_claimed,
        job,
        final_status,
        msg,
        duration_seconds,
        Some(&ctx.events),
    )
    .await;

    // Matches `spawn_runner`'s tail: called unconditionally on the pre-`finish_job` snapshot, not
    // gated on the claim having won, for the same reason it is safe there — a lost race means someone
    // else already ran this same release.
    release_wait_dependents(&ctx, &job_id).await;
    let manager = ctx.self_handle.upgrade();
    release_dependents(
        &tendril_home,
        &plans_dir,
        &jobs_map,
        manager.as_ref(),
        &finished,
    )
    .await;
}
