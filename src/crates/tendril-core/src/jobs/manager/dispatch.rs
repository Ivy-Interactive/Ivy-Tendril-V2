//! The queue and the single dispatcher loop that drains it.
//!
//! One [`dispatch_loop`] task per manager waits on the notify, pops the highest-priority job that
//! has a free slot, and hands it to [`launch`], which performs the last pre-launch checks and spawns
//! the runner. The queue inspection accessors and the operator's `force-start` escape hatch live
//! here because they read and write the same queue.

use super::events::persist;
use super::internals::{ensure_handle, DispatchContext, JobManager};
use super::plan_state::in_flight_plan_state;
use super::runner::spawn_runner;
use crate::error::{Result, TendrilError};
use crate::models::{JobItem, JobStatus};
use chrono::Utc;
use std::path::Path;
use std::sync::atomic::Ordering;
use tokio::sync::OwnedSemaphorePermit;

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// The single task that turns free slots into running jobs, highest priority first.
async fn dispatch_loop(ctx: DispatchContext) {
    loop {
        ctx.dispatch_notify.notified().await;
        drain_queue(&ctx).await;
    }
}

/// Launches as many queued jobs as there are free slots.
async fn drain_queue(ctx: &DispatchContext) {
    loop {
        let Ok(permit) = ctx.semaphore.clone().try_acquire_owned() else {
            return;
        };
        let entry = ctx.queue.lock().await.pop();
        let Some(entry) = entry else {
            drop(permit);
            return;
        };

        // Status is re-checked after the pop: a job cancelled while it waited must not launch.
        let job = ctx.jobs.read().await.get(&entry.job_id).cloned();
        match job {
            Some(job) if job.status == JobStatus::Queued => {
                launch(ctx.clone(), job, permit).await;
            }
            _ => drop(permit),
        }
    }
}

/// Fails a job that a pre-launch check refused, without ever starting its agent.
///
/// Writes through the same fields `report_job_failure` sets, so a refused job looks exactly like
/// one that failed on its own rather than like a job that vanished.
async fn fail_job_before_launch(ctx: &DispatchContext, job: &JobItem, message: &str) {
    let mut failed = job.clone();
    failed.status = JobStatus::Failed;
    failed.reported_failure_reason = Some(message.to_string());
    failed.completed_at = Some(Utc::now());
    persist(&ctx.tendril_home, &ctx.jobs, &failed, Some(&ctx.events)).await;
}

/// Arms the runner for one job, handing it the slot the dispatcher just took.
async fn launch(ctx: DispatchContext, job: JobItem, permit: OwnedSemaphorePermit) {
    ensure_handle(&ctx.handles, &job.id).await;
    let handle_state = {
        let handles = ctx.handles.read().await;
        handles.get(&job.id).map(|h| {
            (
                h.cancel_tx.clone(),
                h.pid.clone(),
                h.completion_claimed.clone(),
            )
        })
    };
    let Some((cancel_tx, pid, completion_claimed)) = handle_state else {
        drop(permit);
        return;
    };

    // A CreatePr job for a plan whose changes carry wireframe code never starts. The Review view
    // checks on click, but a PR can also be started from the CLI, a chat or a retry, and this holds
    // for all of them.
    if job.job_type == "CreatePr" && !job.plan_file.is_empty() {
        let plan_folder = std::path::Path::new(&job.plan_file);
        let leaks = crate::wireframes::plan_guard::check_and_report(plan_folder, None);
        if !leaks.is_empty() {
            tracing::error!(
                "Job {}: refusing launch, the plan's changes carry wireframe code",
                job.id
            );
            fail_job_before_launch(&ctx, &job, &crate::wireframes::leak_guard::describe(&leaks))
                .await;
            drop(permit);
            return;
        }
    }

    let settings = ctx.settings.read().await.clone();
    spawn_runner(
        ctx,
        job,
        cancel_tx,
        pid,
        completion_claimed,
        settings,
        permit,
    );
}

/// Starts the single [`dispatch_loop`] task, once per manager.
pub(super) fn spawn_dispatcher(ctx: &DispatchContext) {
    if ctx.dispatcher_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let ctx = ctx.clone();
    tokio::spawn(async move { dispatch_loop(ctx).await });
}

impl JobManager {
    // -----------------------------------------------------------------------
    // Queue management
    // -----------------------------------------------------------------------

    /// Queued job ids in dispatch order, for the queue inspection route.
    pub async fn queue_order(&self) -> Vec<String> {
        self.queue.lock().await.peek_order()
    }

    /// Queued jobs with their priorities, in dispatch order.
    pub async fn queue_snapshot(&self) -> Vec<(String, i32)> {
        self.queue
            .lock()
            .await
            .snapshot()
            .into_iter()
            .map(|e| (e.job_id, e.priority))
            .collect()
    }

    /// The concurrency budget, i.e. `maxConcurrentJobs`.
    pub async fn max_concurrent_jobs(&self) -> usize {
        self.settings.read().await.max_concurrent_jobs.max(1) as usize
    }

    /// Promotes a `Blocked` or `Queued` job past its gates, keeping its id.
    ///
    /// The job is pushed onto the queue with a priority above every entry currently waiting, so it is
    /// the next thing to launch.
    pub async fn force_start_job(&self, id: &str) -> Result<()> {
        let Some(mut job) = self.get_job(id).await? else {
            return Err(TendrilError::JobNotFound(id.to_string()));
        };

        match job.status {
            JobStatus::Blocked | JobStatus::Queued => {}
            other => {
                return Err(TendrilError::Other(format!(
                    "Job {} is {}, only Blocked or Queued jobs can be force-started",
                    id, other
                )));
            }
        }

        if job.status == JobStatus::Blocked {
            // The gates are deliberately skipped, but the plan still has to move to its in-flight
            // state so the rest of the engine sees a normal launch.
            job.status = JobStatus::Queued;
            job.status_message = Some("Force-started".to_string());
            job.completed_at = None;
            job.started_at = Some(Utc::now());
            if let Some(state) = in_flight_plan_state(&job.job_type) {
                self.set_plan_state(Path::new(&job.plan_file), state);
            }
            persist(&self.tendril_home, &self.jobs, &job, Some(&self.events)).await;
        }

        ensure_handle(&self.handles, id).await;
        {
            let mut queue = self.queue.lock().await;
            queue.remove(id);
            queue.push_front(id.to_string());
        }
        self.spawn_dispatcher();
        self.dispatch_notify.notify_one();

        Ok(())
    }
}
