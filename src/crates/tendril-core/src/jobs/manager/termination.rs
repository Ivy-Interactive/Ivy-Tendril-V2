//! Stopping jobs, and clearing the ones that have stopped.
//!
//! [`JobManager::cancel_job`] is the single stop path: it claims the completion, kills the process
//! tree, reverts the plan state and releases whatever was waiting. `stop_all_jobs` is the same act
//! over everything in flight, for shutdown. The delete and clear operations are here because they
//! are the terminal half of the same lifecycle — what happens to a job after it has stopped.

use super::events::persist;
use super::internals::{claim, is_terminal, JobManager};
use super::plan_state::{apply_plan_state, revert_plan_state, sync_plan_state_to_db};
use super::waiting::release_wait_dependents;
use crate::db::jobs::{delete_job as delete_job_row, list_job_ids_by_status};
use crate::db::open_database;
use crate::error::{Result, TendrilError};
use crate::jobs::deliverable::{resolve_created_plan_folder, revision_count};
use crate::jobs::logger::read_raw_log;
use crate::jobs::process_tree::{kill_tree, DEFAULT_KILL_GRACE};
use crate::models::{JobItem, JobStatus, PlanStatus};
use chrono::Utc;
use std::path::Path;
use std::sync::atomic::Ordering;

/// How much of a cancelled `CreatePlan`'s log [`JobManager::attribute_created_plan`] reads looking for
/// the `PlanId:` marker.
///
/// A window, not the whole file: `finish_job` can afford to read the entire log because it runs once
/// for a run that is over, but a stop-all sweeps every job at once and the operator is waiting on it.
/// These logs are routinely hundreds of thousands of lines -- the two real cancellations this was
/// written for are 196 and 105 lines and 400-600 KB. The marker is printed by the `plan create` tool
/// call, which is the first thing the promptware does, so a run cancelled before it wrote a revision
/// has done little since; 2000 lines covers that with room to spare and bounds the read at a few
/// hundred KB per job.
const CANCEL_LOG_TAIL: usize = 2000;

/// The only statuses [`JobManager::clear_jobs`] will remove: finished work, and nothing else.
///
/// This is the whole safety property of every bulk clear. `Running` and `Queued` are excluded for the
/// obvious reason — clearing a job that is working, or about to, destroys work rather than history.
/// `Pending` and `Blocked` are excluded too, which is stricter than V1's `not Running and not Queued`
/// (`Services/Jobs/JobService.cs:678`) and deliberately so: a `Blocked` job is waiting on a real
/// dependency and is released by [`JobManager::restore_blocked`] and the maintenance sweeps, so it is
/// pending work under a discouraging name, and `Pending` is the pre-dispatch status a restart
/// normalises to `Queued`.
///
/// A caller wanting one status asks for one; the order here is the order the app's menu offers them in.
pub const CLEARABLE_STATUSES: &[JobStatus] = &[
    JobStatus::Completed,
    JobStatus::Failed,
    JobStatus::Timeout,
    JobStatus::Stopped,
];

impl JobManager {
    /// Stops a job and everything it spawned.
    ///
    /// The cancel flag is raised before the completion claim, so an agent exiting at this exact
    /// instant still sees it and cannot flip the plan to `Review` behind the cancellation. Returns
    /// `false` when the job does not exist or had already finished.
    pub async fn cancel_job(&self, id: &str, message: Option<&str>) -> Result<bool> {
        // Drop it from the queue first, so a slot freed by this very cancellation is never spent
        // launching the job being cancelled.
        self.queue.lock().await.remove(id);

        let handle_state = {
            let handles = self.handles.read().await;
            handles.get(id).map(|h| {
                // `send_replace`, not `send`: a job cancelled while still queued has no receiver yet,
                // and the flag must survive until the runner subscribes.
                h.cancel_tx.send_replace(true);
                (h.pid.clone(), h.completion_claimed.clone())
            })
        };

        let mut killed_pid = None;
        if let Some((pid, completion_claimed)) = &handle_state {
            if !claim(completion_claimed) {
                // The job finished on its own first; its terminal state stands.
                return Ok(false);
            }
            let p = pid.load(Ordering::SeqCst);
            if p != 0 {
                let _ = tokio::task::spawn_blocking(move || kill_tree(p, DEFAULT_KILL_GRACE)).await;
                killed_pid = Some(p);
            }
        }

        let Some(mut job) = self.get_job(id).await? else {
            return Ok(false);
        };

        if handle_state.is_none() {
            // A job this process did not start (e.g. after a restart): kill by recorded PID.
            if let Some(p) = job
                .process_id
                .filter(|p| crate::config::is_process_running(*p))
            {
                let _ = tokio::task::spawn_blocking(move || kill_tree(p, DEFAULT_KILL_GRACE)).await;
                killed_pid = Some(p);
            }
            if is_terminal(job.status) {
                return Ok(false);
            }
        }

        if let Some(p) = killed_pid {
            tracing::info!("Job {}: killed process tree {}", id, p);
        }

        // A `CreatePlan` makes its plan in two steps -- `tendril plan create` writes the folder, an
        // empty `Revisions/` and `plan.yaml`, and a separate later `tendril plan write-revision`
        // writes `001.md` -- and this path runs between them often enough to matter. `finish_job`
        // resolves the folder such a run produced and records it; a cancellation never reaches
        // `finish_job`, so the job's row kept the empty `plan_file` it was started with and the link
        // survived only in `Logs/Jobs/<id>.raw.jsonl`.
        //
        // The user's own disk is the evidence: plans 00003 and 00004 sit there as folders with an
        // empty `Revisions/`, and jobs 00010 and 00013 -- both `Stopped by stop-all`, both with
        // `PlanId:` in their logs -- carry an empty `PlanFile` and no `ReportedPlanId`. So the UI
        // could render the plan as undrafted (it keys that off `revisionCount == 0`) but could not
        // name the job that abandoned it, and the operator met two orphans with nothing linking them
        // to the stop they had just pressed.
        if job.job_type == "CreatePlan" && job.plan_file.trim().is_empty() {
            self.attribute_created_plan(&mut job).await;
        }

        job.status = JobStatus::Stopped;
        job.status_message = Some(message.unwrap_or("Cancelled").to_string());
        job.completed_at = Some(Utc::now());
        revert_plan_state(&job);
        // A cancellation ends the run, so the plan's row moves with it exactly as it does in
        // `finish_job` — this path never reaches that function.
        sync_plan_state_to_db(&self.tendril_home, Path::new(&job.plan_file));
        persist(&self.tendril_home, &self.jobs, &job, Some(&self.events)).await;
        self.handles.write().await.remove(id);

        // A stopped job is terminal, so jobs waiting on it have to be told: they will never be
        // released by its completion.
        release_wait_dependents(&self.ctx(), id).await;

        Ok(true)
    }

    /// Records, on a cancelled `CreatePlan`, the plan folder the run had already made -- and marks
    /// that plan `Failed` when nothing was ever written into it.
    ///
    /// Two separate repairs, both for the same two-step gap described at the call site.
    ///
    /// The link first: [`resolve_created_plan_folder`] is the resolver `finish_job` uses, and it reads
    /// the `PlanId: <id>` marker out of the run's own log, so a job killed after `tendril plan create`
    /// has already printed everything needed to find its folder. Only the tail of the log is read:
    /// the marker is printed by a tool call, these files reach megabytes on a long run, and a sweep
    /// stopping fifteen jobs at once would otherwise read all fifteen in full while the operator
    /// waits.
    ///
    /// Then the marking. A folder with no revision in it is not a plan -- its `Revisions/` is empty
    /// and its body will never arrive, because the agent that was going to write it is dead. Left in
    /// `Draft` it is indistinguishable from a plan waiting to be executed, which is how 00003 and
    /// 00004 came to sit in the operator's Drafts list looking merely unread. `Failed` is deliberate
    /// and matches what `finish_job` does to an execution that produced nothing: the folder stays on
    /// disk, so nothing the agent did write is lost and `Update Plan` can still draft into it.
    ///
    /// Marking, not deleting, even though `finish_job`'s own empty-`CreatePlan` path deletes. A
    /// deletion there follows the agent saying it finished, which makes an empty folder proof that
    /// the run produced nothing. Here the operator interrupted a run that was still going, and its
    /// folder may hold attachments or a half-written `plan.yaml`; destroying that as a side effect of
    /// a stop is irreversible and is not what "stop" means.
    async fn attribute_created_plan(&self, job: &mut JobItem) {
        let settings = self.settings.read().await.clone();
        let plans_dir = self.plans_dir(&settings);

        let mut tail = Vec::new();
        if let Ok(Some(lines)) = read_raw_log(&self.tendril_home, &job.id, Some(CANCEL_LOG_TAIL)) {
            tail.extend(lines);
        }

        let Some(folder) = resolve_created_plan_folder(&plans_dir, job, &tail) else {
            return;
        };

        job.plan_file = folder.to_string_lossy().to_string();
        if job.reported_plan_id.is_none() {
            if let Some(id) = folder.file_name().and_then(|n| n.to_str()) {
                job.reported_plan_id = Some(id.chars().take(5).collect());
            }
        }

        if revision_count(&folder) == 0 {
            tracing::warn!(
                "Job {} was stopped before it wrote a revision; marking plan {} Failed",
                job.id,
                folder.display()
            );
            apply_plan_state(&folder, PlanStatus::Failed);
            // `revert_plan_state` runs next and would put this straight back to `Draft` from its
            // `CreatePlan` fallback. It declines to move a plan that is already `Failed`, and this is
            // the write that makes it decline.
        }
    }

    /// Stops every `Running`, `Queued`, `Pending` or `Blocked` job.
    ///
    /// Repeated up to three passes because stopping one job frees a slot and can promote a queued job
    /// mid-sweep. Returns the ids actually stopped.
    ///
    /// Each pass cancels its candidates concurrently rather than one at a time. Every
    /// [`cancel_job`](Self::cancel_job) that finds a live PID pays [`DEFAULT_KILL_GRACE`] -- up to 3s
    /// of `SIGTERM`-then-poll inside `kill_tree` -- and awaiting those in sequence made them sum:
    /// "Stop All" on 15 running jobs took ~45s in the UI, which reads as a hung daemon rather than a
    /// stop. The kills are independent, so the grace periods should overlap; concurrently the same
    /// sweep costs one grace period, ~3s worst case, and less whenever the agents honour `SIGTERM`.
    pub async fn stop_all_jobs(&self) -> Result<Vec<String>> {
        let mut stopped = Vec::new();
        let mut first_error: Option<TendrilError> = None;
        for _ in 0..3 {
            let mut candidates: Vec<String> = self
                .jobs
                .read()
                .await
                .values()
                .filter(|j| !is_terminal(j.status))
                .map(|j| j.id.clone())
                .collect();
            for job in self.list_non_terminal_jobs().await.unwrap_or_default() {
                if !candidates.contains(&job.id) {
                    candidates.push(job.id);
                }
            }
            candidates.retain(|id| !stopped.contains(id));
            if candidates.is_empty() {
                break;
            }
            candidates.sort();

            // `join_all` over futures that each borrow `&self`, not spawned tasks: spawning would
            // need `Arc<Self>` and change this signature for every caller (the `stop-all` route, the
            // CLI). One task per job buys nothing anyway -- the only blocking part, `kill_tree`, is
            // already on `spawn_blocking` inside `cancel_job`, so these futures are pure await points
            // and the fan-out is what makes the graces overlap.
            let outcomes = futures_util::future::join_all(
                candidates
                    .iter()
                    .map(|id| self.cancel_job(id, Some("Stopped by stop-all"))),
            )
            .await;

            // A failure no longer aborts the sweep. The old `?` returned on the first error with the
            // jobs it had already killed unreported, so the caller saw an HTTP 500 and a Jobs list
            // still showing rows that were in fact dead -- and the jobs after the failing one were
            // never even tried. Stopping 14 of 15 and saying so beats stopping 14 and claiming
            // nothing happened. The first error is kept and returned only if the sweep stopped
            // nothing at all, which is the one case where "stop-all failed" is the honest answer.
            // Matches the frontend's own loop in `jobsStore.stopEachIds`, which keeps going too.
            for (id, outcome) in candidates.into_iter().zip(outcomes) {
                match outcome {
                    Ok(true) => stopped.push(id),
                    Ok(false) => {}
                    Err(e) => {
                        tracing::warn!("stop-all: failed to cancel job {}: {}", id, e);
                        first_error.get_or_insert(e);
                    }
                }
            }
        }

        if stopped.is_empty() {
            if let Some(e) = first_error {
                return Err(e);
            }
        }

        stopped.sort();
        Ok(stopped)
    }

    /// Removes one job from the in-memory map and the database, reverting its plan through
    /// [`revert_plan_state`]. A job that is still in flight is cancelled first.
    ///
    /// The artifacts under `<TendrilHome>/Jobs/` are deliberately kept: deleting a job removes it
    /// from the UI and the database, not the forensic record of what it did.
    pub async fn delete_job(&self, id: &str) -> Result<bool> {
        let Some(job) = self.get_job(id).await? else {
            return Ok(false);
        };

        if !is_terminal(job.status) {
            // Cancellation reverts the plan through the same guarded path.
            self.cancel_job(id, Some("Deleted")).await?;
        } else {
            revert_plan_state(&job);
        }

        self.queue.lock().await.remove(id);
        self.jobs.write().await.remove(id);
        self.handles.write().await.remove(id);

        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        delete_job_row(&conn, id).map_err(Into::into)
    }

    /// Bulk delete by status. Each job goes through [`Self::delete_job`], so the plan-state guards
    /// apply to every one of them.
    ///
    /// **Terminal statuses only.** Anything else in `statuses` is dropped before a single row is read,
    /// so no caller — the CLI's `tendril job clear`, the app's header menu, or whatever asks next — can
    /// destroy work that is still in flight. V1 makes the same promise, but it makes it in the
    /// *predicate each use passes* (`ClearAllJobs` is `not Running and not Queued`,
    /// `Services/Jobs/JobService.cs:678`), which leaves the guarantee one careless new call site away
    /// from being lost. Here it is a property of the primitive. See [`CLEARABLE_STATUSES`].
    pub async fn clear_jobs(&self, statuses: &[JobStatus]) -> Result<usize> {
        let clearable: Vec<JobStatus> = statuses
            .iter()
            .copied()
            .filter(|status| CLEARABLE_STATUSES.contains(status))
            .collect();
        for refused in statuses.iter().filter(|s| !clearable.contains(s)) {
            tracing::warn!(
                "Refusing to clear {} jobs: a clear only ever removes finished work",
                refused
            );
        }
        // Not an early `Ok(0)` for the empty case only as an optimisation: `list_job_ids_by_status`
        // with no statuses builds an `IN ()` predicate, and an empty scope must mean "nothing" rather
        // than whatever SQLite makes of that.
        if clearable.is_empty() {
            return Ok(0);
        }

        let ids = {
            let db_path = crate::config::get_database_path(&self.tendril_home);
            let conn = open_database(&db_path)?;
            list_job_ids_by_status(&conn, &clearable)?
        };

        let mut cleared = 0;
        for id in ids {
            match self.delete_job(&id).await {
                Ok(true) => cleared += 1,
                Ok(false) => {}
                Err(e) => tracing::warn!("Failed to delete job {}: {}", id, e),
            }
        }
        Ok(cleared)
    }

    pub async fn clear_completed_jobs(&self) -> Result<usize> {
        self.clear_jobs(&[JobStatus::Completed]).await
    }

    pub async fn clear_failed_jobs(&self) -> Result<usize> {
        self.clear_jobs(&[JobStatus::Failed]).await
    }

    /// Clears every terminal job — [`CLEARABLE_STATUSES`] in full.
    pub async fn clear_all_jobs(&self) -> Result<usize> {
        self.clear_jobs(CLEARABLE_STATUSES).await
    }
}
