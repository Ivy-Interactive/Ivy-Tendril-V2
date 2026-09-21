//! The periodic sweep: unblocking plans, releasing blocked jobs, reaping stuck ones and evicting
//! finished ones from memory.
//!
//! Every gate in the engine is also re-evaluated here, because the live path can only fire on an
//! event it witnessed — a dependency satisfied by something outside this daemon, or a release
//! notification lost to a restart, is only ever recovered by this pass.

use super::events::persist;
use super::internals::{
    is_terminal, job_timeout_duration, stale_output_timeout_duration, JobManager, WaitOutcome,
};
use super::plan_state::{read_plan_state, revert_plan_state};
use super::supervision::stuck_job_reason;
use super::waiting::{release_blocked_job, wait_for_jobs_block};
use crate::error::Result;
use crate::models::{JobItem, JobStatus, PlanStatus};
use crate::plans::dependencies::{
    check_dependencies_with, get_gh_pr_state, unblock_satisfied_plans_with,
};
use chrono::Utc;
use std::path::PathBuf;
use std::time::Duration;

/// Terminal jobs whose `completed_at` is older than this are dropped from the in-memory map. Their
/// database rows stay: this only bounds memory.
const STALE_JOB_EVICTION_AGE: Duration = Duration::from_secs(60 * 60);
/// Number of most recent terminal jobs kept in memory regardless of age.
const STALE_JOB_KEEP_RECENT: usize = 20;

impl JobManager {
    // -----------------------------------------------------------------------
    // Periodic maintenance
    // -----------------------------------------------------------------------

    /// One pass of the periodic maintenance the daemon runs every 60s.
    pub async fn run_maintenance_pass(&self) -> MaintenanceReport {
        self.run_maintenance_pass_with(&get_gh_pr_state).await
    }

    /// [`Self::run_maintenance_pass`] with an injectable PR-state resolver, so tests can drive the
    /// blocked-plan recheck without invoking `gh`.
    ///
    /// Idempotent and best-effort: each step logs and continues rather than aborting the pass.
    pub async fn run_maintenance_pass_with<F>(&self, resolve_pr_state: &F) -> MaintenanceReport
    where
        F: Fn(&str) -> Result<String> + Sync,
    {
        let mut report = MaintenanceReport::default();
        let plans_dir = {
            let settings = self.settings.read().await.clone();
            self.plans_dir(&settings)
        };

        // 1. Blocked plans whose dependencies have since been satisfied. This is the pass that used
        //    to run only at startup.
        //
        //    The `&dyn Fn` resolver is not `Send`, so it is confined to this await-free block: the
        //    60s timer task needs the whole future to stay `Send`.
        let unblocked = {
            let resolver: crate::plans::dependencies::PrStateResolver =
                &|url| resolve_pr_state(url);
            match unblock_satisfied_plans_with(&plans_dir, resolver) {
                Ok(folders) => folders,
                Err(e) => {
                    tracing::warn!("Maintenance: blocked-plan recheck failed: {}", e);
                    Vec::new()
                }
            }
        };
        report.unblocked_plans = unblocked;

        let blocked_jobs: Vec<JobItem> = self
            .jobs
            .read()
            .await
            .values()
            .filter(|j| j.status == JobStatus::Blocked)
            .cloned()
            .collect();

        for job in &blocked_jobs {
            if !job.wait_for_job_ids.is_empty() {
                // Step 2's business.
                continue;
            }
            let plan_folder = PathBuf::from(&job.plan_file);
            if !plan_folder.is_dir() {
                continue;
            }
            if read_plan_state(&plan_folder) == Some(PlanStatus::Blocked) {
                continue;
            }

            let satisfied = {
                let resolver: crate::plans::dependencies::PrStateResolver =
                    &|url| resolve_pr_state(url);
                matches!(
                    check_dependencies_with(&plan_folder, &plans_dir, resolver),
                    Ok(res) if res.ok
                )
            };
            if satisfied {
                release_blocked_job(&self.ctx(), job.clone()).await;
                report.released_jobs.push(job.id.clone());
            }
        }

        // 2. Wait-for dependencies that have since finished. Belt and braces against a release
        //    notification that was missed because the daemon restarted.
        for job in &blocked_jobs {
            if job.wait_for_job_ids.is_empty() {
                continue;
            }
            let ctx = self.ctx();
            match wait_for_jobs_block(&ctx, job).await {
                None => {
                    release_blocked_job(&ctx, job.clone()).await;
                    report.released_jobs.push(job.id.clone());
                }
                Some(WaitOutcome::Failed(reason)) => {
                    let mut failed = job.clone();
                    failed.status = JobStatus::Failed;
                    failed.status_message = Some(reason);
                    failed.completed_at = Some(Utc::now());
                    revert_plan_state(&failed);
                    persist(&self.tendril_home, &self.jobs, &failed, Some(&self.events)).await;
                }
                Some(WaitOutcome::Blocked(_)) => {}
            }
        }

        // 3. Running jobs whose agent has gone quiet, or which have blown past the hard cap. Read
        //    from SQLite so a job left Running by a previous daemon is caught too.
        let (stale_timeout, job_timeout) = {
            let settings = self.settings.read().await.clone();
            (
                self.stale_output_timeout_override
                    .or_else(|| stale_output_timeout_duration(&settings)),
                self.job_timeout_override
                    .or_else(|| job_timeout_duration(&settings)),
            )
        };
        let now = Utc::now();
        for mut job in self.list_non_terminal_jobs().await.unwrap_or_default() {
            if job.status != JobStatus::Running {
                continue;
            }
            // `detached` is never persisted (see `JobItem::detached`), so the SQLite row above always
            // reads `false` even for a job `supervise_detached` is watching. Overlay the in-memory
            // copy, which is the only place that flag actually lives, before asking whether it's stuck.
            if let Some(mem) = self.jobs.read().await.get(&job.id) {
                job.detached = mem.detached;
            }
            let Some(reason) = stuck_job_reason(&job, now, stale_timeout, job_timeout) else {
                continue;
            };
            tracing::warn!("Maintenance: reaping stuck job {}: {}", job.id, reason);
            match self.cancel_job(&job.id, Some(&reason)).await {
                Ok(true) => report.reaped_jobs.push(job.id.clone()),
                Ok(false) => {}
                Err(e) => tracing::warn!("Maintenance: could not reap job {}: {}", job.id, e),
            }
        }

        // 4. Terminal jobs that no longer need to sit in memory. Their rows stay in SQLite and
        //    `get_job` falls back to them.
        report.evicted_jobs = self.evict_stale_jobs().await;

        report
    }

    /// Drops long-finished jobs from the in-memory map, keeping the most recent regardless of age.
    async fn evict_stale_jobs(&self) -> Vec<String> {
        let mut jobs = self.jobs.write().await;
        let candidates: Vec<JobItem> = jobs.values().cloned().collect();
        let evicted = stale_eviction_candidates(
            &candidates,
            Utc::now(),
            STALE_JOB_EVICTION_AGE,
            STALE_JOB_KEEP_RECENT,
        );
        for id in &evicted {
            jobs.remove(id);
        }
        evicted
    }
}

/// Which jobs the stale-eviction step would drop from the in-memory map: terminal, finished longer
/// than `max_age` ago, and outside the `keep_recent` most recently finished.
///
/// Pure and `now`-parameterised so the policy can be exercised without waiting an hour or launching
/// enough real jobs to fill the keep-window. Only memory is bounded — the caller leaves the SQLite
/// rows alone, and `get_job` falls back to them.
pub fn stale_eviction_candidates(
    jobs: &[JobItem],
    now: chrono::DateTime<Utc>,
    max_age: Duration,
    keep_recent: usize,
) -> Vec<String> {
    let mut terminal: Vec<(String, chrono::DateTime<Utc>)> = jobs
        .iter()
        .filter(|j| is_terminal(j.status))
        .filter_map(|j| j.completed_at.map(|at| (j.id.clone(), at)))
        .collect();
    // Newest first, so the keep-window is the head of the list. Ties break on id, so a batch that
    // finished within the same timestamp resolution still evicts deterministically.
    terminal.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));

    let cutoff = now - chrono::Duration::from_std(max_age).unwrap_or_default();
    let mut evicted: Vec<String> = terminal
        .into_iter()
        .skip(keep_recent)
        .filter(|(_, completed_at)| *completed_at < cutoff)
        .map(|(id, _)| id)
        .collect();
    evicted.sort();
    evicted
}

/// What one [`JobManager::run_maintenance_pass`] changed.
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct MaintenanceReport {
    /// Plan folders moved `Blocked` -> `Draft`.
    #[serde(rename = "unblockedPlans")]
    pub unblocked_plans: Vec<String>,
    /// Blocked jobs whose gates are now satisfied and which were enqueued.
    #[serde(rename = "releasedJobs")]
    pub released_jobs: Vec<String>,
    /// Jobs reaped by the stuck-job check.
    #[serde(rename = "reapedJobs")]
    pub reaped_jobs: Vec<String>,
    /// Finished jobs evicted from the in-memory map.
    #[serde(rename = "evictedJobs")]
    pub evicted_jobs: Vec<String>,
}

impl MaintenanceReport {
    pub fn is_empty(&self) -> bool {
        self.unblocked_plans.is_empty()
            && self.released_jobs.is_empty()
            && self.reaped_jobs.is_empty()
            && self.evicted_jobs.is_empty()
    }
}
