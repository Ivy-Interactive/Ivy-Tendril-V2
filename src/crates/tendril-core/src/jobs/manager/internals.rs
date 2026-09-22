//! The manager itself: its state, its construction, the small accessors that only read it, and the
//! primitives every lifecycle stage is written in terms of.
//!
//! [`JobManager`] owns the shared state; [`DispatchContext`] is the cloneable snapshot of it that a
//! spawned task can hold, which is what keeps `JobManager` usable without an enclosing `Arc`.
//! [`JobHandle`] and [`claim`] are the per-job control surface, and the rest — `lookup_job`,
//! `ensure_handle`, `is_terminal`, the timeout resolvers and `describe_window` — are the helpers
//! more than one stage needs.

use super::dispatch::spawn_dispatcher;
use super::events::{JobEvent, JOB_EVENT_CHANNEL_CAPACITY};
use super::plan_state::{apply_plan_state, sync_plan_state_to_db};
use crate::agents::providers::{build_agent_spec, AgentLaunchConfig, AgentProcessSpec};
use crate::config::{get_plans_dir_with_settings, TendrilSettings};
use crate::db::jobs::{get_job, list_jobs, list_non_terminal_jobs, max_numeric_job_id};
use crate::db::open_database;
use crate::error::Result;
use crate::jobs::hooks::{shell_hook_executor, HookExecutor};
use crate::jobs::logger::{append_agent_log, max_logged_job_id};
use crate::jobs::queue::JobQueue;
use crate::models::{JobItem, JobStatus, PlanStatus};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;
use tokio::sync::{broadcast, watch, Mutex, Notify, RwLock, Semaphore};

/// Builds the process spec for an agent launch. Injectable so tests can exercise the whole launch
/// path against a throwaway script instead of a real agent CLI.
pub type SpecBuilder = Arc<dyn Fn(&str, &AgentLaunchConfig) -> AgentProcessSpec + Send + Sync>;

/// Live control surface for a queued or running job.
///
/// The handle exists from the moment a job is enqueued, before it has a process, so a job cancelled
/// while it waits for a slot still claims its own completion. `cancel_tx` is shared because both the
/// canceller and the stale-output watchdog raise the flag.
pub struct JobHandle {
    pub cancel_tx: Arc<watch::Sender<bool>>,
    /// 0 until the agent process is spawned.
    pub pid: Arc<AtomicU32>,
    /// Claimed exactly once, by whichever of cancellation and normal completion gets there first.
    pub completion_claimed: Arc<AtomicBool>,
}

impl JobHandle {
    pub fn new() -> Self {
        let (cancel_tx, _) = watch::channel(false);
        Self {
            cancel_tx: Arc::new(cancel_tx),
            pid: Arc::new(AtomicU32::new(0)),
            completion_claimed: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl Default for JobHandle {
    fn default() -> Self {
        Self::new()
    }
}

/// Claims the right to write a job's terminal state. Returns `true` for the first caller only.
pub(super) fn claim(flag: &AtomicBool) -> bool {
    !flag.swap(true, Ordering::SeqCst)
}

/// Why a job may not be queued yet.
#[derive(Debug, Clone)]
pub(super) enum WaitOutcome {
    /// Still waiting; the string is the user-facing status message.
    Blocked(String),
    /// A dependency will never complete, so this job cannot either.
    Failed(String),
}

/// Everything the dispatcher and the runner tasks need from a [`JobManager`]. Cloneable so a spawned
/// task can own one, which keeps `JobManager` usable without an enclosing `Arc`.
#[derive(Clone)]
pub(super) struct DispatchContext {
    pub(super) tendril_home: PathBuf,
    pub(super) settings: Arc<RwLock<TendrilSettings>>,
    pub(super) jobs: Arc<RwLock<HashMap<String, JobItem>>>,
    pub(super) handles: Arc<RwLock<HashMap<String, JobHandle>>>,
    pub(super) semaphore: Arc<Semaphore>,
    pub(super) queue: Arc<Mutex<JobQueue>>,
    pub(super) dispatch_notify: Arc<Notify>,
    pub(super) dispatcher_started: Arc<AtomicBool>,
    pub(super) spec_builder: SpecBuilder,
    pub(super) hook_executor: HookExecutor,
    pub(super) job_timeout_override: Option<Duration>,
    pub(super) post_result_grace_override: Option<Duration>,
    pub(super) stale_output_timeout_override: Option<Duration>,
    pub(super) plans_dir_override: Option<PathBuf>,
    pub(super) self_handle: Weak<JobManager>,
    pub(super) events: broadcast::Sender<JobEvent>,
}

pub struct JobManager {
    pub(super) tendril_home: PathBuf,
    pub(super) settings: Arc<RwLock<TendrilSettings>>,
    pub(super) jobs: Arc<RwLock<HashMap<String, JobItem>>>,
    pub(super) handles: Arc<RwLock<HashMap<String, JobHandle>>>,
    semaphore: Arc<Semaphore>,
    /// Jobs waiting for a slot, highest priority first.
    pub(super) queue: Arc<Mutex<JobQueue>>,
    /// Notified whenever a slot frees or a job is enqueued, waking `dispatch_loop`.
    pub(super) dispatch_notify: Arc<Notify>,
    /// Guards the one-time spawn of `dispatch_loop`.
    dispatcher_started: Arc<AtomicBool>,
    /// Serialises the whole decision to start a job: the idempotency-key lookup, the authoritative
    /// conflict check, the duplicate-work check, ID allocation and the first insert. Holding all of
    /// them under one lock is what makes check-then-insert indivisible — two concurrent
    /// `start_job` calls can no longer both pass a check that neither has yet invalidated, nor
    /// allocate the same ID.
    ///
    /// Nothing slow belongs in here. `read_plan_state`, the plan dependency gate (which can invoke
    /// `gh` over the network) and the wait-for-jobs gate all run outside it.
    pub(super) start_lock: Arc<Mutex<()>>,
    spec_builder: SpecBuilder,
    /// Runs a project's hooks. Injectable for the same reason as `spec_builder`: a lifecycle test
    /// must be able to see a hook fire without a shell running.
    hook_executor: HookExecutor,
    /// Overrides the `jobTimeout` setting. Only used by tests, which need sub-minute timeouts.
    pub(super) job_timeout_override: Option<Duration>,
    /// Overrides the post-result grace period. Only used by tests.
    post_result_grace_override: Option<Duration>,
    /// Overrides the `staleOutputTimeout` setting. Only used by tests.
    pub(super) stale_output_timeout_override: Option<Duration>,
    /// Overrides the plans directory the maintenance pass scans. Only used by tests.
    plans_dir_override: Option<PathBuf>,
    /// A handle back to this manager, so a finished job can start the jobs that were waiting on it.
    /// Empty unless the manager was published with [`JobManager::share`]; empty simply means no
    /// restarts happen, which is what a manager nobody can reach should do.
    self_handle: OnceLock<Weak<JobManager>>,
    /// Job lifecycle events, for anything that would otherwise have to poll — the daemon forwards
    /// them onto the WebSocket. See [`JobEvent`]. The channel exists whether or not anyone is
    /// listening, so a send is always safe and a CLI invocation simply drops every event.
    pub(super) events: broadcast::Sender<JobEvent>,
}

impl JobManager {
    pub fn new(tendril_home: PathBuf, settings: TendrilSettings) -> Self {
        let max_jobs = settings.max_concurrent_jobs.max(1) as usize;
        let (events, _) = broadcast::channel(JOB_EVENT_CHANNEL_CAPACITY);
        Self {
            tendril_home,
            settings: Arc::new(RwLock::new(settings)),
            jobs: Arc::new(RwLock::new(HashMap::new())),
            handles: Arc::new(RwLock::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(max_jobs)),
            queue: Arc::new(Mutex::new(JobQueue::new())),
            dispatch_notify: Arc::new(Notify::new()),
            dispatcher_started: Arc::new(AtomicBool::new(false)),
            start_lock: Arc::new(Mutex::new(())),
            spec_builder: Arc::new(build_agent_spec),
            hook_executor: shell_hook_executor(),
            job_timeout_override: None,
            post_result_grace_override: None,
            stale_output_timeout_override: None,
            plans_dir_override: None,
            self_handle: OnceLock::new(),
            events,
        }
    }

    /// Subscribes to this manager's job lifecycle events.
    ///
    /// A receiver only sees events published after it subscribes, and it may lag: a subscriber that
    /// treats [`broadcast::error::RecvError::Lagged`] as fatal silences itself permanently, so
    /// forward the next event instead and let the client reconcile.
    pub fn subscribe_events(&self) -> broadcast::Receiver<JobEvent> {
        self.events.subscribe()
    }

    /// Publishes the manager as an `Arc` and records a weak handle to itself.
    ///
    /// Releasing a dependent means starting a job, which needs the manager — but the job runner is a
    /// free function reached from a spawned task. A `Weak` keeps that reachable without the manager
    /// holding itself alive.
    pub fn share(self) -> Arc<Self> {
        let arc = Arc::new(self);
        let _ = arc.self_handle.set(Arc::downgrade(&arc));
        arc
    }

    /// Replaces the agent spec builder. Intended for tests.
    pub fn with_spec_builder(mut self, builder: SpecBuilder) -> Self {
        self.spec_builder = builder;
        self
    }

    /// Replaces the hook executor, which otherwise runs each hook through the platform shell.
    /// Intended for tests.
    pub fn with_hook_executor(mut self, executor: HookExecutor) -> Self {
        self.hook_executor = executor;
        self
    }

    /// Overrides the configured job timeout, which is expressed in whole minutes. Intended for tests.
    pub fn with_job_timeout(mut self, timeout: Option<Duration>) -> Self {
        self.job_timeout_override = timeout;
        self
    }

    /// Overrides the post-result grace period. Only used by tests.
    pub fn with_post_result_grace(mut self, grace: Option<Duration>) -> Self {
        self.post_result_grace_override = grace;
        self
    }

    /// Overrides the configured stale-output timeout, which is expressed in whole minutes. Intended
    /// for tests, which need sub-second windows.
    pub fn with_stale_output_timeout(mut self, timeout: Option<Duration>) -> Self {
        self.stale_output_timeout_override = timeout;
        self
    }

    /// Pins the plans directory the maintenance pass scans, instead of resolving it from the
    /// `TENDRIL_PLANS` environment variable and the settings. Intended for tests: the resolved
    /// directory is the operator's real one, and a maintenance pass must never be pointed at it.
    pub fn with_plans_dir(mut self, dir: Option<PathBuf>) -> Self {
        self.plans_dir_override = dir;
        self
    }

    /// The plans directory this manager scans.
    pub(super) fn plans_dir(&self, settings: &TendrilSettings) -> PathBuf {
        self.plans_dir_override
            .clone()
            .unwrap_or_else(|| get_plans_dir_with_settings(&self.tendril_home, Some(settings)))
    }

    /// Snapshot of the shared state the dispatcher and runner tasks work through. Taken after the
    /// `with_*` builders have run, so a test's overrides are always the ones the runner sees.
    pub(super) fn ctx(&self) -> DispatchContext {
        DispatchContext {
            tendril_home: self.tendril_home.clone(),
            settings: self.settings.clone(),
            jobs: self.jobs.clone(),
            handles: self.handles.clone(),
            semaphore: self.semaphore.clone(),
            queue: self.queue.clone(),
            dispatch_notify: self.dispatch_notify.clone(),
            dispatcher_started: self.dispatcher_started.clone(),
            spec_builder: self.spec_builder.clone(),
            hook_executor: self.hook_executor.clone(),
            job_timeout_override: self.job_timeout_override,
            post_result_grace_override: self.post_result_grace_override,
            stale_output_timeout_override: self.stale_output_timeout_override,
            plans_dir_override: self.plans_dir_override.clone(),
            self_handle: self.self_handle.get().cloned().unwrap_or_else(Weak::new),
            events: self.events.clone(),
        }
    }

    /// Starts the single dispatcher task, once. Called on the first enqueue, so a manager that never
    /// starts a job never spawns anything.
    pub fn spawn_dispatcher(&self) {
        spawn_dispatcher(&self.ctx());
    }

    /// Next free 5-digit job id.
    ///
    /// The database is not the only thing holding an id: `delete_job` keeps a job's logs on purpose
    /// and only drops its row, so counting up from the table alone re-issues an id whose
    /// `Logs/Jobs/{id}.eventwire.jsonl` is still there — and the appending writers then stack the
    /// new run on top of the old one. See [`max_logged_job_id`] for what that corrupts. Taking the
    /// larger of the two high-water marks means an id is free only when nothing anywhere still
    /// answers to it.
    pub async fn allocate_job_id(&self) -> Result<String> {
        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        let max_in_db = max_numeric_job_id(&conn)?.max(0) as u32;
        let max_on_disk = max_logged_job_id(&self.tendril_home);
        Ok(format!("{:05}", max_in_db.max(max_on_disk) + 1))
    }

    /// Pushes a `Queued` job onto the priority queue and wakes the dispatcher.
    pub(super) async fn enqueue(&self, job_id: &str, priority: i32) {
        ensure_handle(&self.handles, job_id).await;
        self.queue.lock().await.push(job_id.to_string(), priority);
        self.spawn_dispatcher();
        self.dispatch_notify.notify_one();
    }

    /// Moves a plan into its in-flight state as a job claims it, and mirrors that to SQLite.
    ///
    /// The mirror is the point: `apply_plan_state` writes `plan.yaml` and nothing else, and the plan
    /// list, the Kanban columns and `?status=` all read `Plans.State` out of the database. Without
    /// this the row still says `Draft` while the plan is executing, and no refetch fixes it — the
    /// watcher cannot compensate either, because `write_plan_yaml` marks the write as ours and the
    /// watcher skips self-writes.
    pub(super) fn set_plan_state(&self, plan_folder: &Path, state: PlanStatus) {
        apply_plan_state(plan_folder, state);
        sync_plan_state_to_db(&self.tendril_home, plan_folder);
    }

    pub async fn get_job(&self, id: &str) -> Result<Option<JobItem>> {
        {
            let map = self.jobs.read().await;
            if let Some(j) = map.get(id) {
                return Ok(Some(j.clone()));
            }
        }

        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        get_job(&conn, id).map_err(Into::into)
    }

    pub fn add_log(&self, id: &str, action: &str, summary: Option<&str>) -> Result<PathBuf> {
        append_agent_log(&self.tendril_home, id, action, summary)
    }

    pub async fn list_jobs(
        &self,
        status_filter: Option<JobStatus>,
        limit: usize,
    ) -> Result<Vec<JobItem>> {
        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        list_jobs(&conn, status_filter, limit).map_err(Into::into)
    }

    /// Job rows still in a non-terminal status, straight from SQLite.
    pub async fn list_non_terminal_jobs(&self) -> Result<Vec<JobItem>> {
        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        list_non_terminal_jobs(&conn).map_err(Into::into)
    }
}

/// Renders a duration the way the job list should read it.
pub(super) fn describe_window(d: Duration) -> String {
    let secs = d.as_secs();
    if secs == 0 {
        return format!("{} ms", d.as_millis());
    }
    if secs < 60 {
        return format!("{} seconds", secs);
    }
    let minutes = secs / 60;
    match secs % 60 {
        0 => format!("{} minutes", minutes),
        rest => format!("{} minutes {} seconds", minutes, rest),
    }
}

/// Reads a job from the in-memory map, falling back to SQLite.
pub(super) async fn lookup_job(ctx: &DispatchContext, id: &str) -> Option<JobItem> {
    if let Some(job) = ctx.jobs.read().await.get(id).cloned() {
        return Some(job);
    }
    let db_path = crate::config::get_database_path(&ctx.tendril_home);
    open_database(&db_path)
        .ok()
        .and_then(|conn| get_job(&conn, id).ok().flatten())
}

/// Creates the control handle for a job if it does not have one yet.
pub(super) async fn ensure_handle(handles: &Arc<RwLock<HashMap<String, JobHandle>>>, job_id: &str) {
    handles
        .write()
        .await
        .entry(job_id.to_string())
        .or_insert_with(JobHandle::new);
}

pub(super) fn is_terminal(status: JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped
    )
}

pub(super) fn job_timeout_duration(settings: &TendrilSettings) -> Option<Duration> {
    if settings.job_timeout > 0 {
        Some(Duration::from_secs(settings.job_timeout as u64 * 60))
    } else {
        None
    }
}

/// The silence window after which a job is killed, or `None` when the setting disables the watchdog.
/// Expressed in whole minutes, like `jobTimeout`.
pub(super) fn stale_output_timeout_duration(settings: &TendrilSettings) -> Option<Duration> {
    if settings.stale_output_timeout > 0 {
        Some(Duration::from_secs(
            settings.stale_output_timeout as u64 * 60,
        ))
    } else {
        None
    }
}
