//! The job lifecycle event stream, and the single write that feeds it.
//!
//! Every status change in the engine goes through [`persist`]: it writes the in-memory map, mirrors
//! the row to SQLite and publishes the event. Keeping the writer next to the event type is
//! deliberate — the invariant that "a status write and its event are the same act" is the whole
//! reason nothing else in `manager` writes a job row directly.

use crate::db::jobs::insert_job;
use crate::db::open_database;
use crate::models::{JobItem, JobStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

/// How many job events the manager buffers for a slow subscriber.
///
/// Job events are per-transition, not per-output-line, so this is generous: a subscriber would have
/// to sleep through 256 transitions to lag. The server's forwarder survives a lag anyway rather than
/// ending, which is the failure mode that actually matters (see `AppState::new`).
pub(super) const JOB_EVENT_CHANNEL_CAPACITY: usize = 256;

/// Emitted on every status transition the manager writes.
pub const JOB_EVENT_STATUS_CHANGED: &str = "job.status_changed";
/// Emitted alongside [`JOB_EVENT_STATUS_CHANGED`] when a job settles on `Completed`.
pub const JOB_EVENT_COMPLETED: &str = "job.completed";
/// Emitted alongside [`JOB_EVENT_STATUS_CHANGED`] when a job settles on `Failed`, `Timeout` or
/// `Stopped`.
pub const JOB_EVENT_FAILED: &str = "job.failed";

/// A job lifecycle notification, broadcast to anything watching a
/// [`JobManager`](super::JobManager).
///
/// The `job.` prefix is load-bearing rather than decorative. The desktop bridge
/// (`ws_bridge.rs::route_ws_message`) claims `chat.`, `plan.`, `state` and `status` for their own
/// channels and routes *everything else* to `job-event` — so an unprefixed name would reach the Jobs
/// area by falling through a match rather than by matching one, and a future `plan.`-shaped name
/// added to that list would silently steal it.
///
/// A subscriber gets both a generic transition event and, for a terminal status, a second event
/// naming the outcome: a client that only cares about "did this finish" does not have to know which
/// of `Failed`, `Timeout` and `Stopped` count as failure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub job_id: String,
    pub job_type: String,
    pub status: JobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_message: Option<String>,
    /// The plan folder the job is working on, if any — the name, not the absolute path, because that
    /// is what a client keys a plan on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_folder: Option<String>,
    /// The conversation that started the job, so a subscriber can route the event to it without
    /// re-reading the job. Carried on the event because the chat notifier needs it for a `CreatePlan`,
    /// which has no `plan_folder` to resolve a conversation through.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_session_id: Option<String>,
    /// The plan the job ended up holding, for a job whose `plan_folder` was empty when it started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reported_plan_id: Option<String>,
}

impl JobEvent {
    fn of_type(event_type: &str, job: &JobItem) -> Self {
        Self {
            event_type: event_type.to_string(),
            job_id: job.id.clone(),
            job_type: job.job_type.clone(),
            status: job.status,
            status_message: job.status_message.clone(),
            plan_folder: Path::new(&job.plan_file)
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string()),
            chat_session_id: job.chat_session_id.clone(),
            reported_plan_id: job
                .reported_plan_id
                .clone()
                .filter(|id| !id.trim().is_empty()),
        }
    }

    /// The transition event every status write produces.
    pub fn status_changed(job: &JobItem) -> Self {
        Self::of_type(JOB_EVENT_STATUS_CHANGED, job)
    }

    /// The outcome event a terminal status produces, or `None` while the job is still live.
    pub fn terminal(job: &JobItem) -> Option<Self> {
        match job.status {
            JobStatus::Completed => Some(Self::of_type(JOB_EVENT_COMPLETED, job)),
            JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped => {
                Some(Self::of_type(JOB_EVENT_FAILED, job))
            }
            _ => None,
        }
    }
}

/// Publishes the events for one status write. A send failure only means nobody is subscribed.
fn emit_job_event(events: Option<&broadcast::Sender<JobEvent>>, job: &JobItem) {
    let Some(tx) = events else {
        return;
    };
    let _ = tx.send(JobEvent::status_changed(job));
    if let Some(terminal) = JobEvent::terminal(job) {
        let _ = tx.send(terminal);
    }
}

/// Writes a job to the in-memory map and SQLite, and announces the transition.
///
/// Every status a job reaches after it is created is written through here, which is why the event is
/// published here too: an emission bolted onto individual call sites is one `return` away from a
/// status that reaches the database and nothing else. `events` is `None` for a caller that has no
/// manager to publish through — the free-function test entry points, and nothing in production.
pub(super) async fn persist(
    tendril_home: &Path,
    jobs_map: &Arc<RwLock<HashMap<String, JobItem>>>,
    job: &JobItem,
    events: Option<&broadcast::Sender<JobEvent>>,
) {
    let previous = jobs_map.write().await.insert(job.id.clone(), job.clone());

    // Announce only a write that changed something a client renders. Several writes are re-persists
    // of a job whose status has not moved (the PID write during launch, a blocked job whose reason
    // was re-checked), and each would otherwise cost every connected client an event.
    let moved = match &previous {
        Some(prev) => {
            prev.status != job.status
                || prev.status_message != job.status_message
                // The plan a job holds is news too, and for a `CreatePlan` it is the only news it has
                // before it finishes: `tendril job status --plan-id` is how the promptware reports the
                // plan it just created, and repeating the same `--message` alongside it left the status
                // unmoved — so the plan reached the database and no client heard about it until the
                // next poll.
                || prev.reported_plan_id != job.reported_plan_id
                || prev.reported_plan_title != job.reported_plan_title
        }
        // Not seen by this process before: the first write is always news.
        None => true,
    };
    if moved {
        emit_job_event(events, job);
    }

    let db_path = crate::config::get_database_path(tendril_home);
    match open_database(&db_path) {
        Ok(conn) => {
            if let Err(e) = insert_job(&conn, job) {
                tracing::warn!("Failed to persist job {}: {}", job.id, e);
            }
        }
        Err(e) => tracing::warn!("Failed to open database to persist job {}: {}", job.id, e),
    }
}
