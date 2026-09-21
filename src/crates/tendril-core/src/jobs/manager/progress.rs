//! Liveness while a job runs: the agent-output heartbeat, the write throttle in front of it, and the
//! watchdog that fails a job whose agent has gone silent.
//!
//! [`OutputActivity`] is the shared state between the output callback and
//! [`run_stale_output_watchdog`]; [`note_agent_output`] is the callback. The status-reporting
//! entry points a running agent calls back into are here for the same reason — they are the other
//! way a live job reports progress.

use super::events::persist;
use super::internals::{describe_window, JobManager};
use crate::db::jobs::touch_job_last_output;
use crate::db::open_database;
use crate::error::Result;
use crate::jobs::firmware_values::is_auto_project;
use crate::models::{JobItem, JobStatus};
use crate::plans::helpers::resolve_plan_folder;
use crate::plans::reader::read_plan_yaml;
use chrono::Utc;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{watch, RwLock};

/// Floor on how often a running job's `LastOutputAt` is written, so a chatty agent does not hammer
/// SQLite once per output line.
const LAST_OUTPUT_PERSIST_INTERVAL: Duration = Duration::from_secs(5);

impl JobManager {
    pub async fn update_job_status(
        &self,
        id: &str,
        message: &str,
        plan_id: Option<&str>,
        plan_title: Option<&str>,
    ) -> Result<bool> {
        let Some(mut job) = self.get_job(id).await? else {
            return Ok(false);
        };

        job.status_message = Some(message.to_string());
        if let Some(pid) = plan_id {
            job.reported_plan_id = Some(pid.to_string());
            // The moment a `CreatePlan` says which plan it made is the first moment its project can be
            // known, and it is also the moment the Jobs list and the chat come to read the row. Waiting
            // for the job to finish would leave both showing `Auto` for the whole run.
            if is_auto_project(&job.project) {
                let settings = self.settings.read().await.clone();
                if let Some(project) = plan_project(pid, &self.plans_dir(&settings)) {
                    job.project = project;
                }
            }
        }
        if let Some(title) = plan_title {
            job.reported_plan_title = Some(title.to_string());
        }

        persist(&self.tendril_home, &self.jobs, &job, Some(&self.events)).await;
        Ok(true)
    }

    pub async fn report_job_failure(&self, id: &str, message: &str) -> Result<bool> {
        let Some(mut job) = self.get_job(id).await? else {
            return Ok(false);
        };

        job.status = JobStatus::Failed;
        job.reported_failure_reason = Some(message.to_string());
        job.completed_at = Some(Utc::now());

        persist(&self.tendril_home, &self.jobs, &job, Some(&self.events)).await;
        Ok(true)
    }
}

/// The project a plan belongs to, by plan reference — an id, a folder name or a path. `None` when the
/// plan cannot be read or names no project of its own.
fn plan_project(plan_reference: &str, plans_dir: &Path) -> Option<String> {
    let folder = resolve_plan_folder(plan_reference, plans_dir).ok()?;
    read_plan_yaml(&folder)
        .ok()
        .map(|(plan, _)| plan.project)
        .filter(|project| !is_auto_project(project))
}

/// Shared liveness state for one running job, written by the output callback and read by the
/// watchdog.
pub(super) struct OutputActivity {
    /// Instant of the last agent line.
    last_output: std::sync::Mutex<Instant>,
    /// Set once the agent emits its terminal result event. The watchdog stands down from that point:
    /// `run_agent_process_with_grace` owns the wind-down from there, and killing a job that has
    /// already reported its result would discard completed work.
    result_seen: AtomicBool,
    /// When `LastOutputAt` was last written, so a chatty agent does not hammer SQLite.
    last_persist: std::sync::Mutex<Option<Instant>>,
}

impl OutputActivity {
    pub(super) fn new() -> Self {
        Self {
            last_output: std::sync::Mutex::new(Instant::now()),
            result_seen: AtomicBool::new(false),
            last_persist: std::sync::Mutex::new(None),
        }
    }

    /// How long the agent has been silent.
    fn quiet_for(&self) -> Duration {
        self.last_output
            .lock()
            .map(|last| last.elapsed())
            .unwrap_or_default()
    }

    /// Whether this line's timestamp is due to be published, recording that it was.
    ///
    /// The first line always is, so a job shows a real "last heard from" the moment it says anything.
    /// After that it is one claim per [`LAST_OUTPUT_PERSIST_INTERVAL`], because the alternative is an
    /// `UPDATE Jobs` per output line: an agent mid-`cargo test` emits thousands of lines a minute, and
    /// the only reader of the value is a table cell rendering it as `1m 20s`. Ten seconds of extra
    /// staleness is invisible there; ten thousand writes are not.
    ///
    /// A poisoned lock claims nothing: dropping a heartbeat is a stale cell, and the watchdog's own
    /// anchor is a separate field, so nothing about liveness depends on this succeeding.
    fn claim_persist_slot(&self, now: Instant) -> bool {
        match self.last_persist.lock() {
            Ok(mut last_persist) => {
                let due = last_persist
                    .is_none_or(|at| now.duration_since(at) >= LAST_OUTPUT_PERSIST_INTERVAL);
                if due {
                    *last_persist = Some(now);
                }
                due
            }
            Err(_) => false,
        }
    }
}

/// Fails a job whose agent has gone quiet for longer than `staleOutputTimeout`.
///
/// The baseline before any output arrives is the moment monitoring began, so a job that never emits
/// anything is still caught. Stands down permanently once `result_seen` is set, so the post-result
/// grace window in `run_agent_process_with_grace` is respected; a job that is merely busy — a long
/// `cargo test` in a verification step still counts as alive, because the agent's tool-result line
/// resets the anchor — is only killed when nothing at all arrives for the full window.
///
/// It never writes a terminal status itself: it raises the cancel flag and lets the runner's single
/// completion claim stand.
pub(super) async fn run_stale_output_watchdog(
    job_id: String,
    activity: Arc<OutputActivity>,
    stale_timeout: Duration,
    cancel_tx: Arc<watch::Sender<bool>>,
    finished: Arc<AtomicBool>,
    stale_fired: Arc<AtomicBool>,
) {
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        ticker.tick().await;
        if finished.load(Ordering::SeqCst) || activity.result_seen.load(Ordering::SeqCst) {
            return;
        }
        let quiet = activity.quiet_for();
        if quiet >= stale_timeout {
            tracing::warn!(
                "Job {}: no agent output for {}, cancelling (stale output timeout)",
                job_id,
                describe_window(quiet)
            );
            stale_fired.store(true, Ordering::SeqCst);
            cancel_tx.send_replace(true);
            return;
        }
    }
}

/// Records one line of agent output: refreshes the liveness anchor, notes a terminal result event,
/// and publishes `LastOutputAt` at most once per [`LAST_OUTPUT_PERSIST_INTERVAL`].
///
/// "Publishes" is two writes, and both are needed. The row is what `GET /api/jobs` and
/// `POST /api/jobs/query` read, so it is what reaches the Jobs table's Agent Output cell. The
/// in-memory map matters because [`persist`] writes the *whole* `JobItem` it is handed, and every
/// caller of it takes that item from this same map ([`JobManager::update_job_status`] and friends read
/// through [`JobManager::get_job`]): an agent reporting a status message between two heartbeats would
/// otherwise write `LastOutputAt = NULL` back over the stamp, and the cell would flick back to
/// "Starting…" mid-run. Stamping the map keeps the value in the record those writers carry forward.
pub(super) fn note_agent_output(
    activity: &Arc<OutputActivity>,
    jobs: &Arc<RwLock<HashMap<String, JobItem>>>,
    tendril_home: &Path,
    job_id: &str,
    raw_line: &str,
) {
    let now = Instant::now();
    if let Ok(mut last) = activity.last_output.lock() {
        *last = now;
    }
    if crate::agents::runner::parse_terminal_result_event(raw_line).is_some() {
        activity.result_seen.store(true, Ordering::SeqCst);
    }

    if !activity.claim_persist_slot(now) {
        return;
    }

    let home = tendril_home.to_path_buf();
    let id = job_id.to_string();
    let jobs = jobs.clone();
    tokio::spawn(async move {
        let at = Utc::now();
        if let Some(job) = jobs.write().await.get_mut(&id) {
            job.last_output_at = Some(at);
        }
        let db_path = crate::config::get_database_path(&home);
        match open_database(&db_path) {
            Ok(conn) => {
                // A targeted `UPDATE` rather than a row rewrite: a heartbeat must not clobber a field
                // a concurrent writer owns. See `touch_job_last_output`.
                if let Err(e) = touch_job_last_output(&conn, &id, at) {
                    tracing::debug!("Failed to stamp last output for job {}: {}", id, e);
                }
            }
            Err(e) => tracing::debug!("Failed to open database for job {} heartbeat: {}", id, e),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The write rate behind the Jobs table's Agent Output cell.
    ///
    /// The cell renders "how long since the agent last said anything", which needs a stamped timestamp
    /// — but stamping it per output line would make `UPDATE Jobs SET LastOutputAt` the hottest write in
    /// the daemon, thousands a minute for an agent running a test suite. These pin the throttle that
    /// makes the feature affordable: one write to open the run, then one per
    /// [`LAST_OUTPUT_PERSIST_INTERVAL`] however loud the agent is.
    #[test]
    fn a_chatty_agent_costs_one_last_output_write_per_interval() {
        let activity = OutputActivity::new();
        let start = Instant::now();

        // The first line always publishes: a running job with no stamp reads "Starting…", and it should
        // stop doing that as soon as it has actually said something.
        assert!(activity.claim_persist_slot(start));

        // Ten thousand lines inside the window, and not one more write.
        let claims = (1..10_000u64)
            .filter(|i| activity.claim_persist_slot(start + Duration::from_micros(i * 100)))
            .count();
        assert_eq!(
            claims, 0,
            "no line inside the interval may reach SQLite after the first"
        );

        // The window closes exactly at the interval, not a tick before it.
        assert!(!activity
            .claim_persist_slot(start + LAST_OUTPUT_PERSIST_INTERVAL - Duration::from_millis(1)));
        assert!(activity.claim_persist_slot(start + LAST_OUTPUT_PERSIST_INTERVAL));

        // And the next window is measured from the write that was made, not from the run's start.
        assert!(!activity.claim_persist_slot(
            start + LAST_OUTPUT_PERSIST_INTERVAL * 2 - Duration::from_millis(1)
        ));
        assert!(activity.claim_persist_slot(start + LAST_OUTPUT_PERSIST_INTERVAL * 2));
    }

    /// A silent stretch does not bank up credit: a job goes quiet for a minute and its next line still
    /// costs exactly one write, not twelve.
    #[test]
    fn a_quiet_stretch_does_not_bank_up_writes() {
        let activity = OutputActivity::new();
        let start = Instant::now();
        assert!(activity.claim_persist_slot(start));

        let quiet = start + Duration::from_secs(60);
        assert!(activity.claim_persist_slot(quiet));
        assert!(!activity.claim_persist_slot(quiet + Duration::from_millis(1)));
    }

    /// The heartbeat stamps the in-memory record, not only the row.
    ///
    /// [`persist`] writes the whole `JobItem` its caller holds, and every caller takes that item from
    /// this map — so a status message arriving between two heartbeats would write `LastOutputAt = NULL`
    /// back over the row and drop the Jobs table's Agent Output cell to "Starting…" mid-run. Stamping
    /// the map is what makes the value survive those writers.
    #[tokio::test]
    async fn a_heartbeat_stamps_the_record_a_status_write_would_otherwise_carry_forward() {
        let home = std::env::temp_dir().join(format!(
            "tendril-heartbeat-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&home).expect("temp home");

        // A launch-time copy, exactly as `spawn_runner` holds one: Running, and no output yet.
        let mut job = JobItem::new(
            "00001".to_string(),
            "ExecutePlan".to_string(),
            String::new(),
            "FixtureProject".to_string(),
        );
        job.status = JobStatus::Running;
        assert!(job.last_output_at.is_none());
        let jobs: Arc<RwLock<HashMap<String, JobItem>>> = Arc::new(RwLock::new(HashMap::new()));
        jobs.write().await.insert(job.id.clone(), job.clone());

        let activity = Arc::new(OutputActivity::new());
        note_agent_output(&activity, &jobs, &home, "00001", "{\"type\":\"assistant\"}");

        // The write is spawned so the output callback never blocks on SQLite.
        let mut stamp = None;
        for _ in 0..200 {
            stamp = jobs
                .read()
                .await
                .get("00001")
                .and_then(|j| j.last_output_at);
            if stamp.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(
            stamp.is_some(),
            "the first agent line must leave a stamp on the shared record"
        );

        let _ = std::fs::remove_dir_all(&home);
    }
}
