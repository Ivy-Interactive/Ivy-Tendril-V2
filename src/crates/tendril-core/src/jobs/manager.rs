use crate::agents::eventwire::EventWireNormalizer;
use crate::agents::providers::{
    apply_security_settings, build_agent_spec, AgentLaunchConfig, AgentProcessSpec,
};
use crate::agents::reconcile::build_missing_result_lines;
use crate::agents::resolution::resolve_agent;
use crate::agents::runner::{run_agent_process_with_grace, AgentRunOutcome, TerminationReason};
use crate::config::{get_plans_dir_with_settings, TendrilSettings};
use crate::db::jobs::{
    delete_job as delete_job_row, find_inflight_job_by_dedupe_key, find_job_by_idempotency_key,
    get_job, insert_job, insert_new_job, list_job_ids_by_status, list_jobs, list_non_terminal_jobs,
    list_non_terminal_jobs_for_plan, max_numeric_job_id, touch_job_last_output,
};
use crate::db::open_database;
use crate::error::{Result, TendrilError};
use crate::git::worktree::{add_worktree, register_worktree, WorktreeMode};
use crate::git::worktree_log::WorktreeLifecycleLog;
use crate::jobs::attachments::move_attachments_to_plan_folder;
use crate::jobs::deliverable::{
    cleanup_plan_folder_and_database, resolve_created_plan_folder, revision_count,
    verify_deliverable, Cleanup, Deliverable,
};
use crate::jobs::denials::{describe_denials, extract_permission_denials, summarize_denials};
use crate::jobs::dependents::release_dependents;
use crate::jobs::failure_analysis::extract_failure_reason;
use crate::jobs::firmware_values::{
    build_firmware_values, build_job_context, execution_profile_override, find_project,
    find_repo_ref, is_auto_project, repo_name, resolve_project, resolve_project_skills,
    resolve_working_directory, resolve_writable_directories,
};
use crate::jobs::hooks::{run_hooks, shell_hook_executor, HookExecutor, HookPhase, HookRunContext};
use crate::jobs::logger::{
    append_agent_log, append_to_eventwire, append_to_raw_log, find_log_file, read_eventwire_log,
    read_raw_log, write_prompt,
};
use crate::jobs::outcome::write_job_outcome_log;
use crate::jobs::process_tree::{kill_tree, DEFAULT_KILL_GRACE};
use crate::jobs::queue::JobQueue;
use crate::models::{JobArgs, JobItem, JobStatus, PlanStatus, PlanWorktreeEntry, PlanYaml};
use crate::plans::dependencies::{
    check_dependencies, check_dependencies_with, get_gh_pr_state, unblock_satisfied_plans_with,
};
use crate::plans::guards::PlanCompletionGuard;
use crate::plans::helpers::resolve_plan_folder;
use crate::plans::reader::read_plan_yaml;
use crate::plans::verification_gate::resolve_post_execution_state;
use crate::plans::writer::write_plan_yaml;
use crate::promptware::compiler::compile_firmware_with_skills;
use crate::telemetry::Track;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, watch, Mutex, Notify, OwnedSemaphorePermit, RwLock, Semaphore};

/// Grace on top of `staleOutputTimeout` before the maintenance pass reaps a `Running` job whose own
/// per-job watchdog never armed, because the launch itself hung.
pub const STUCK_JOB_REAP_GRACE: Duration = Duration::from_secs(120);
/// Extra margin on top of `jobTimeout` before the maintenance pass hard-caps a `Running` job.
pub const STUCK_JOB_HARD_CAP_MARGIN: Duration = Duration::from_secs(300);
/// Terminal jobs whose `completed_at` is older than this are dropped from the in-memory map. Their
/// database rows stay: this only bounds memory.
const STALE_JOB_EVICTION_AGE: Duration = Duration::from_secs(60 * 60);
/// Number of most recent terminal jobs kept in memory regardless of age.
const STALE_JOB_KEEP_RECENT: usize = 20;
/// Floor on how often a running job's `LastOutputAt` is written, so a chatty agent does not hammer
/// SQLite once per output line.
const LAST_OUTPUT_PERSIST_INTERVAL: Duration = Duration::from_secs(5);

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

/// Builds the process spec for an agent launch. Injectable so tests can exercise the whole launch
/// path against a throwaway script instead of a real agent CLI.
pub type SpecBuilder = Arc<dyn Fn(&str, &AgentLaunchConfig) -> AgentProcessSpec + Send + Sync>;

/// How many job events the manager buffers for a slow subscriber.
///
/// Job events are per-transition, not per-output-line, so this is generous: a subscriber would have
/// to sleep through 256 transitions to lag. The server's forwarder survives a lag anyway rather than
/// ending, which is the failure mode that actually matters (see `AppState::new`).
const JOB_EVENT_CHANNEL_CAPACITY: usize = 256;

/// Emitted on every status transition the manager writes.
pub const JOB_EVENT_STATUS_CHANGED: &str = "job.status_changed";
/// Emitted alongside [`JOB_EVENT_STATUS_CHANGED`] when a job settles on `Completed`.
pub const JOB_EVENT_COMPLETED: &str = "job.completed";
/// Emitted alongside [`JOB_EVENT_STATUS_CHANGED`] when a job settles on `Failed`, `Timeout` or
/// `Stopped`.
pub const JOB_EVENT_FAILED: &str = "job.failed";

/// A job lifecycle notification, broadcast to anything watching a [`JobManager`].
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
fn claim(flag: &AtomicBool) -> bool {
    !flag.swap(true, Ordering::SeqCst)
}

/// Per-start options that are not part of any job type's own args.
#[derive(Debug, Clone, Default)]
pub struct StartOptions {
    /// Job ids that must finish before this job may be queued.
    pub wait_for_jobs: Vec<String>,
    /// Overrides the priority derived from args/`plan.yaml`.
    pub priority: Option<i32>,
    /// The operator's deliberate "yes, again": skips both duplicate gates. It never bypasses the
    /// dependency gate — only the "is this already in flight" question.
    pub force: bool,
    /// Client-supplied identity of *this submission*. A second start carrying a key already recorded
    /// returns the job that key created instead of making another one, which is what makes a retry
    /// after a lost or timed-out response safe.
    ///
    /// Distinct from [`Self::force`] and from the server-derived dedupe key: those answer "is this
    /// work already running", which stops helping the moment the first job finishes. A key answers
    /// "have I already sent this request", which stays true forever.
    pub idempotency_key: Option<String>,
    /// The conversation that started this job. `None` for a job started from a terminal or by the
    /// scheduler; a job that names a plan then inherits the plan's own chat session instead, so the
    /// link survives an agent that forgot to pass one.
    pub chat_session_id: Option<String>,
}

/// Why a job may not be queued yet.
#[derive(Debug, Clone)]
enum WaitOutcome {
    /// Still waiting; the string is the user-facing status message.
    Blocked(String),
    /// A dependency will never complete, so this job cannot either.
    Failed(String),
}

/// Everything the dispatcher and the runner tasks need from a [`JobManager`]. Cloneable so a spawned
/// task can own one, which keeps `JobManager` usable without an enclosing `Arc`.
#[derive(Clone)]
struct DispatchContext {
    tendril_home: PathBuf,
    settings: Arc<RwLock<TendrilSettings>>,
    jobs: Arc<RwLock<HashMap<String, JobItem>>>,
    handles: Arc<RwLock<HashMap<String, JobHandle>>>,
    semaphore: Arc<Semaphore>,
    queue: Arc<Mutex<JobQueue>>,
    dispatch_notify: Arc<Notify>,
    dispatcher_started: Arc<AtomicBool>,
    spec_builder: SpecBuilder,
    hook_executor: HookExecutor,
    job_timeout_override: Option<Duration>,
    post_result_grace_override: Option<Duration>,
    stale_output_timeout_override: Option<Duration>,
    plans_dir_override: Option<PathBuf>,
    self_handle: Weak<JobManager>,
    events: broadcast::Sender<JobEvent>,
}

pub struct JobManager {
    tendril_home: PathBuf,
    settings: Arc<RwLock<TendrilSettings>>,
    jobs: Arc<RwLock<HashMap<String, JobItem>>>,
    handles: Arc<RwLock<HashMap<String, JobHandle>>>,
    semaphore: Arc<Semaphore>,
    /// Jobs waiting for a slot, highest priority first.
    queue: Arc<Mutex<JobQueue>>,
    /// Notified whenever a slot frees or a job is enqueued, waking `dispatch_loop`.
    dispatch_notify: Arc<Notify>,
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
    start_lock: Arc<Mutex<()>>,
    spec_builder: SpecBuilder,
    /// Runs a project's hooks. Injectable for the same reason as `spec_builder`: a lifecycle test
    /// must be able to see a hook fire without a shell running.
    hook_executor: HookExecutor,
    /// Overrides the `jobTimeout` setting. Only used by tests, which need sub-minute timeouts.
    job_timeout_override: Option<Duration>,
    /// Overrides the post-result grace period. Only used by tests.
    post_result_grace_override: Option<Duration>,
    /// Overrides the `staleOutputTimeout` setting. Only used by tests.
    stale_output_timeout_override: Option<Duration>,
    /// Overrides the plans directory the maintenance pass scans. Only used by tests.
    plans_dir_override: Option<PathBuf>,
    /// A handle back to this manager, so a finished job can start the jobs that were waiting on it.
    /// Empty unless the manager was published with [`JobManager::share`]; empty simply means no
    /// restarts happen, which is what a manager nobody can reach should do.
    self_handle: OnceLock<Weak<JobManager>>,
    /// Job lifecycle events, for anything that would otherwise have to poll — the daemon forwards
    /// them onto the WebSocket. See [`JobEvent`]. The channel exists whether or not anyone is
    /// listening, so a send is always safe and a CLI invocation simply drops every event.
    events: broadcast::Sender<JobEvent>,
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
    fn plans_dir(&self, settings: &TendrilSettings) -> PathBuf {
        self.plans_dir_override
            .clone()
            .unwrap_or_else(|| get_plans_dir_with_settings(&self.tendril_home, Some(settings)))
    }

    /// Snapshot of the shared state the dispatcher and runner tasks work through. Taken after the
    /// `with_*` builders have run, so a test's overrides are always the ones the runner sees.
    fn ctx(&self) -> DispatchContext {
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

    pub async fn allocate_job_id(&self) -> Result<String> {
        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        let max_id = max_numeric_job_id(&conn)?;
        Ok(format!("{:05}", max_id + 1))
    }

    pub async fn start_job(&self, args: JobArgs) -> Result<String> {
        // `CreatePlan` carries its own force flag, which is the only way an operator could express
        // "again" before `StartOptions` existed.
        let force = args.force_flag();
        self.start_job_with(
            args,
            StartOptions {
                force,
                ..Default::default()
            },
        )
        .await
    }

    /// Starts a job, overriding the duplicate gates when `force` is set. See
    /// [`StartOptions::force`] — it is not a licence to skip the dependency gate.
    pub async fn start_job_forced(&self, args: JobArgs, force: bool) -> Result<String> {
        self.start_job_with(
            args,
            StartOptions {
                force,
                ..Default::default()
            },
        )
        .await
    }

    /// Starts a job, honouring the per-start options that do not belong to any job type's own args.
    ///
    /// Gates run in this order:
    ///
    /// 1. **Missing plan folder** — a plan-scoped job with no folder is refused outright.
    /// 2. **Conflict fast path** — memory-only and outside the lock, so an obvious duplicate is
    ///    rejected before the dependency gate can spend a network round trip on it. Not authoritative:
    ///    without the lock two concurrent starts can both pass it, and without the database it is
    ///    blind after a restart. Skipped for a keyed submission, which step 4 may recognize as a
    ///    replay rather than a duplicate.
    /// 3. **The plan dependency gate**, then **the wait-for-jobs gate**. Both may await for a long
    ///    time, so both run outside `start_lock`.
    /// 4. Under `start_lock`, indivisibly: **the idempotency-key replay**, **the duplicate-work
    ///    rejection**, **the authoritative conflict check**, ID allocation, the row insert and the
    ///    map insert.
    /// 5. **The plan state transition**, only now that a row exists.
    /// 6. **The enqueue.**
    ///
    /// Every path that does not create a job writes nothing at all — no job row, no plan state
    /// change, no queue entry. That covers the missing-folder `Validation` rejection, both conflict
    /// rejections, the duplicate-work rejection, and an idempotency replay, which returns the id of
    /// the job the key already created.
    pub async fn start_job_with(&self, args: JobArgs, opts: StartOptions) -> Result<String> {
        let job_type = args.job_type().to_string();
        let settings = self.settings.read().await.clone();

        // Canonicalize the plan reference before anything reads it.
        //
        // `POST /api/jobs` deserializes raw `JobArgs`, so it is the one front end that can name a plan
        // by its bare id — which is exactly what the app sends (`folderPath: plan.id`). The CLI and the
        // MCP dispatcher both resolve a folder first, so nothing else ever saw the difference, and a
        // great deal downstream reads this string as a path:
        //
        // * `resolve_project` reads `plan.yaml` at it, so an unresolved id meant every plan-scoped job
        //   from the app was recorded as project `Auto` — and with it went the project's skills, its
        //   job hooks, its terminal allowlist and its `RepoConfigs`.
        // * `add_plan_scoped_values` bails when it is not a directory, so the firmware header lost its
        //   whole plan block: no `TendrilPlanFolder`, no `TendrilPlanId`, no `Note` / `UpdateInstructions`
        //   / `ChangeRequest`. The agent had to work out which plan it was on by searching for it.
        // * `verify_execute_plan` reads `plan.yaml` at it too, so an execution that succeeded was
        //   recorded `Failed` — "exited 0 but its plan.yaml could not be read at 00681" — and the plan
        //   was flipped to `Failed` with it.
        // * the dedupe and conflict keys compare this string, so `00681` and the absolute path were two
        //   different keys and the duplicate gate could be walked around by mixing front ends.
        //
        // Resolution failure falls back to the raw string rather than becoming an error: a submission
        // naming a plan that does not exist yet is the caller's problem to report, and the guard below
        // already rejects the only unrecoverable shape (no reference at all).
        let mut args = args;
        if let Some(reference) = args.plan_folder().map(str::to_string) {
            if !reference.trim().is_empty() {
                if let Ok(resolved) = resolve_plan_folder(&reference, &self.plans_dir(&settings)) {
                    args.set_plan_folder(resolved.to_string_lossy().to_string());
                }
            }
        }

        let plan_folder_str = args.plan_folder().unwrap_or("").to_string();
        let plan_folder = PathBuf::from(&plan_folder_str);

        // A plan-scoped job with no plan folder is malformed, and it is also unguardable: with no
        // folder there is nothing to key a conflict on, so accepting it would grant unlimited
        // concurrency on the one path that most needs the guard. Only `POST /api/jobs` can express it
        // — it deserializes raw `JobArgs`, where the CLI and MCP both resolve a folder first — and
        // `Validation` is what that route turns into a 400.
        if conflict_group(&job_type).is_some() && normalize_plan_folder(&plan_folder_str).is_empty()
        {
            return Err(TendrilError::Validation(format!(
                "{} requires a plan folder",
                job_type
            )));
        }

        // `CreatePlan` carries a priority of its own, so an explicit override is written back into the
        // stored args rather than only onto the job row.
        if let (JobArgs::CreatePlan(create), Some(priority)) = (&mut args, opts.priority) {
            create.priority = priority;
        }

        // A forced submission is the operator saying "yes, again": it opts out of both duplicate
        // gates, and stores no dedupe key so it cannot block the next submission either.
        let force = opts.force || args.force_flag();

        // Fast path only, not the guard. It is an optimization: rejecting here avoids running the
        // plan dependency gate — which can invoke `gh` over the network — for a submission that is
        // obviously a duplicate. The authoritative check is the one inside `start_lock` below, and it
        // is the one that makes concurrent starts safe.
        //
        // Memory-only, so it does no I/O and cannot fail. That also keeps it from pre-empting the
        // per-type duplicate check under the lock, which reads the database and has the more specific
        // answer — it names the predecessor's status, not just its id. Anything this misses that gate
        // or the authoritative conflict check catches.
        //
        // Skipped entirely when the submission carries an idempotency key. A keyed retry is most
        // likely a replay of the *same* job this would report as the conflict, and answering it with a
        // conflict is the exact failure a key exists to prevent. The replay lookup needs the database,
        // so it belongs under the lock with the authoritative check rather than up here.
        if !force && opts.idempotency_key.is_none() {
            if let Some(existing_id) = self
                .find_conflicting_job_in_memory(&job_type, &plan_folder_str)
                .await
            {
                return Err(TendrilError::Conflict(format!(
                    "{} already in progress for this plan (job {}). Use force to submit it again.",
                    job_type, existing_id
                )));
            }
        }

        // The key for the *work*, checked under `start_lock` further down so two concurrent
        // submissions cannot both pass. `None` for a forced submission and for a job type that is
        // not deduplicated.
        let dedupe_key = if force { None } else { args.dedupe_key() };

        // Snapshot the plan state before anything mutates it, so a failure, timeout or cancel can
        // put the plan back where it was.
        let previous_plan_state = read_plan_state(&plan_folder);

        // The dependency gate runs before the plan is marked Executing: a blocked plan must not look
        // like it started.
        let block_reason =
            if matches!(job_type.as_str(), "ExecutePlan" | "RetryPlan") && plan_folder.is_dir() {
                let plans_dir = plan_folder
                    .parent()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| self.plans_dir(&settings));
                match check_dependencies(&plan_folder, &plans_dir) {
                    Ok(res) if !res.ok => Some(
                        res.block_reason
                            .unwrap_or_else(|| "Dependencies are not satisfied".to_string()),
                    ),
                    Ok(_) => None,
                    Err(e) => {
                        tracing::warn!("Dependency check failed for {}: {}", plan_folder_str, e);
                        None
                    }
                }
            } else {
                None
            };

        let mut job = JobItem::new(
            String::new(),
            job_type.clone(),
            plan_folder_str.clone(),
            "Auto".to_string(),
        );
        job.provider = settings.coding_agent.clone();
        job.started_at = Some(Utc::now());
        job.typed_args = Some(args.clone());
        job.args = serde_json::to_string(&args).ok();
        job.previous_plan_state = previous_plan_state.map(|s| s.to_string());
        job.project = resolve_project(&job, &settings);
        job.wait_for_job_ids = opts.wait_for_jobs.clone();
        job.priority = resolve_job_priority(&args, &plan_folder, opts.priority);
        job.idempotency_key = opts.idempotency_key.clone();
        // What the caller said, else what the plan it names already knows. The second half is what
        // links a job an agent started without the flag — `tendril job start ExecutePlan 00042` from a
        // plan's own side-panel chat — back to the conversation watching that plan.
        job.chat_session_id = opts
            .chat_session_id
            .clone()
            .or_else(|| plan_chat_session_id(&plan_folder));

        // The wait-for gate only runs when the plan dependency gate let the job through: a blocked
        // plan is the more specific reason and should be the one the user sees.
        let wait_outcome = match &block_reason {
            Some(reason) => Some(WaitOutcome::Blocked(reason.clone())),
            None => wait_for_jobs_block(&self.ctx(), &job).await,
        };

        match &wait_outcome {
            Some(WaitOutcome::Blocked(reason)) => {
                job.status = JobStatus::Blocked;
                job.status_message = Some(reason.clone());
            }
            Some(WaitOutcome::Failed(reason)) => {
                job.status = JobStatus::Failed;
                job.status_message = Some(reason.clone());
                job.completed_at = Some(Utc::now());
            }
            None => job.status = JobStatus::Queued,
        }

        if block_reason.is_some() {
            // Legacy recorded the blocking reason on the job row and on the plan.
            job.completed_at = Some(Utc::now());
        }

        // The plan's in-flight (or Blocked) state. A job waiting on another *job* leaves the plan
        // alone: nothing about the plan itself is blocked, so the gate must not be re-run against a
        // `Blocked` state it never earned.
        let target_plan_state = if block_reason.is_some() {
            Some(PlanStatus::Blocked)
        } else if wait_outcome.is_none() {
            in_flight_plan_state(&job_type)
        } else {
            None
        };

        // Every check that decides *whether* to create a job, then the creation itself, under one
        // lock. Widened from guarding only ID allocation: the conflict check used to sit ~90 lines and
        // several `.await` points earlier, so two concurrent submissions could both pass it while
        // neither had inserted yet, and both got a job.
        let job_id = {
            let _guard = self.start_lock.lock().await;

            let db_path = crate::config::get_database_path(&self.tendril_home);
            let conn = open_database(&db_path)?;

            // A replayed key is the same request, not a new one: hand back the job it already made,
            // and take no further action — no row, no plan-state flip, no enqueue.
            if let Some(key) = opts.idempotency_key.as_deref() {
                if let Some(existing) = find_job_by_idempotency_key(&conn, key)? {
                    tracing::info!(
                        "Idempotency key {} replays job {} ({})",
                        key,
                        existing.id,
                        existing.status
                    );
                    return Ok(existing.id);
                }
            }

            // Idempotency at the door: the same work already in flight is a conflict, not a second
            // job, worktree and agent.
            //
            // Ahead of the group check below because it is the more specific answer — it names the
            // predecessor's status, not just its id — and because it is the only gate that can see a
            // duplicate of a job type in no conflict group, `CreatePlan` first among them.
            if let Some(key) = &dedupe_key {
                if let Some(existing) = find_inflight_job_by_dedupe_key(&conn, key)? {
                    return Err(TendrilError::DuplicateJob(format!(
                        "{} is already in flight as job {} ({}). Use force to submit it again.",
                        job_type, existing.id, existing.status
                    )));
                }
            }

            // The authoritative conflict check, unlike the fast path above: inside the lock, so two
            // concurrent starts cannot both pass it, and DB-backed, so a restart that leaves the
            // in-memory map empty cannot admit a second job either.
            //
            // The broader net of the two. A dedupe key is per job type, so it cannot express
            // `ExecutePlan` versus `CreatePr` on one plan; and a forced submission stores no key at
            // all, so a forced predecessor is invisible to the gate above but not to this one.
            if !force {
                if let Some(existing_id) = self
                    .find_conflicting_job(&job_type, &plan_folder_str)
                    .await?
                {
                    return Err(TendrilError::Conflict(format!(
                        "{} already in progress for this plan (job {}). Use force to submit it \
                         again.",
                        job_type, existing_id
                    )));
                }
            }

            let job_id = self.allocate_job_id().await?;
            job.id = job_id.clone();
            job.dedupe_key = dedupe_key.clone();

            insert_new_job(&conn, &job)
                .map_err(|e| duplicate_or_other(e, &job_id, &dedupe_key, &opts.idempotency_key))?;

            self.jobs.write().await.insert(job_id.clone(), job.clone());
            job_id
        };

        // Only now, with a row actually written, is the plan moved: a rejected duplicate leaves the
        // plan exactly as it found it rather than flipping it to `Executing` with no job behind it.
        if let Some(state) = target_plan_state {
            self.set_plan_state(&plan_folder, state);
        }

        // A no-op unless telemetry is explicitly enabled; the raw plan id is hashed by the client.
        crate::telemetry::tracker().track_job_created(&crate::telemetry::JobCreatedContext {
            job_type: job.job_type.clone(),
            agent: non_empty(&job.provider),
            plan_id: telemetry_plan_id(&job),
        });

        if job.status != JobStatus::Queued {
            // Blocked or failed at a gate: no slot is claimed and no runner is armed.
            return Ok(job_id);
        }

        self.enqueue(&job_id, job.priority).await;

        Ok(job_id)
    }

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

    /// Pushes a `Queued` job onto the priority queue and wakes the dispatcher.
    async fn enqueue(&self, job_id: &str, priority: i32) {
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
    fn set_plan_state(&self, plan_folder: &Path, state: PlanStatus) {
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

    // -----------------------------------------------------------------------
    // Conflicts and wait-for dependencies
    // -----------------------------------------------------------------------

    /// The id of an unfinished job that would fight this one over the same plan, if any.
    ///
    /// Authoritative: the in-memory map *and* every persisted non-terminal row. Startup recovery does
    /// not rehydrate the map ([`crate::jobs::recovery::reconcile_jobs_with`]) — it reports surviving
    /// `Running` jobs as live and deliberately leaves `Queued`/`Pending` rows alone for want of a
    /// durable queue — so immediately after a restart the map is empty while the database still holds
    /// live and queued work. The database is the only place such a job can be seen.
    ///
    /// Rehydrating the map instead would be worse: it is also what `get_job`, the dispatcher and the
    /// cancellation paths read, so inserting `Queued` rows would advertise jobs that will never be
    /// dispatched, and inserting detached `Running` rows would arm the watchdog and timeout logic
    /// against a process no handle exists for. Querying here keeps the blast radius to the guard.
    ///
    /// Folder paths are compared case-insensitively, as legacy did, so two starts that spell the same
    /// folder differently still collide. This deliberately does *not* take `start_lock`: it is `pub`
    /// and called directly by tests, so the caller owns the serialization.
    pub async fn find_conflicting_job(
        &self,
        job_type: &str,
        plan_folder: &str,
    ) -> Result<Option<String>> {
        let Some((group, folder)) = conflict_scope(job_type, plan_folder) else {
            return Ok(None);
        };

        let mut ids = self.conflicting_ids_in_memory(group, &folder).await;

        let conn = open_database(&crate::config::get_database_path(&self.tendril_home))?;
        ids.extend(
            list_non_terminal_jobs_for_plan(&conn, &folder)?
                .into_iter()
                .filter(|j| conflict_group(&j.job_type) == Some(group))
                .map(|j| j.id),
        );

        // Oldest first, so the message names the job that actually holds the plan. Ids are
        // zero-padded to five digits, so lexicographic order is numeric order — and sorting is what
        // keeps that guarantee across the two sources, which may report the same job twice.
        ids.sort();
        ids.dedup();
        Ok(ids.into_iter().next())
    }

    /// The same search as [`Self::find_conflicting_job`] over the in-memory map alone.
    ///
    /// An optimization, not a guard: it is the fast path in `start_job_with`, where rejecting before
    /// the dependency gate — which can invoke `gh` over the network — is worth a cheap look. It does no
    /// I/O and it cannot be authoritative, because the map is empty after a restart and because two
    /// concurrent starts can both pass it. The authoritative check is the one inside `start_lock`.
    ///
    /// Memory-only *by design*, not just for speed: a persisted row this misses is still caught inside
    /// the lock, and by a gate that may have a better answer for it — an idempotency-key replay, or the
    /// per-type duplicate rejection that names the predecessor's status. Answering here would pre-empt
    /// both with the blunter conflict error.
    pub async fn find_conflicting_job_in_memory(
        &self,
        job_type: &str,
        plan_folder: &str,
    ) -> Option<String> {
        let (group, folder) = conflict_scope(job_type, plan_folder)?;
        let mut ids = self.conflicting_ids_in_memory(group, &folder).await;
        ids.sort();
        ids.into_iter().next()
    }

    /// Ids of unfinished jobs in `group` held against `folder` according to the in-memory map, in no
    /// particular order. `folder` must already be normalized.
    ///
    /// `Blocked` counts as unfinished: a blocked job still intends to touch the plan, and
    /// [`crate::jobs::dependents`] removes its row from both the database and this map before
    /// submitting a replacement, so it cannot block the job meant to replace it.
    async fn conflicting_ids_in_memory(&self, group: &str, folder: &str) -> Vec<String> {
        let jobs = self.jobs.read().await;
        jobs.values()
            .filter(|j| {
                matches!(
                    j.status,
                    JobStatus::Running
                        | JobStatus::Queued
                        | JobStatus::Pending
                        | JobStatus::Blocked
                ) && normalize_plan_folder(&j.plan_file).eq_ignore_ascii_case(folder)
                    && conflict_group(&j.job_type) == Some(group)
            })
            .map(|j| j.id.clone())
            .collect()
    }

    /// Re-runs the wait-for gate for every `Blocked` job listing `finished_id`, enqueueing the ones
    /// that are now satisfied and failing the ones whose dependency ended badly. Returns the ids
    /// released.
    pub async fn release_wait_dependents(&self, finished_id: &str) -> Vec<String> {
        release_wait_dependents(&self.ctx(), finished_id).await
    }

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

    /// Stops every `Running`, `Queued`, `Pending` or `Blocked` job.
    ///
    /// Repeated up to three passes because stopping one job frees a slot and can promote a queued job
    /// mid-sweep. Returns the ids actually stopped.
    pub async fn stop_all_jobs(&self) -> Result<Vec<String>> {
        let mut stopped = Vec::new();
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

            for id in candidates {
                if self.cancel_job(&id, Some("Stopped by stop-all")).await? {
                    stopped.push(id);
                }
            }
        }

        stopped.sort();
        Ok(stopped)
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

// ---------------------------------------------------------------------------
// Conflicts, priority and wait-for dependencies
// ---------------------------------------------------------------------------

/// Job types that mutate a plan's `plan.yaml` or its worktree. Any two of them on the same plan
/// folder conflict, so `ExecutePlan` and `RetryPlan` are mutually exclusive as well as
/// self-exclusive. Non-plan job types (`SetupProject`, `AddProject`, `SyncRepo`) are in no group.
///
/// `CreatePr` is in the mutating group even though legacy left it out — that omission is what let
/// duplicate `CreatePr` jobs run on one plan.
pub fn conflict_group(job_type: &str) -> Option<&'static str> {
    match job_type {
        "ExecutePlan" | "RetryPlan" | "CreatePr" => Some("plan-mutating"),
        "UpdatePlan" | "ExpandPlan" | "SplitPlan" => Some("plan-authoring"),
        _ => None,
    }
}

/// Trailing separators and surrounding whitespace do not change which plan a folder names, so two
/// callers that spell the same folder differently must still collide. Case is left alone: the
/// comparison against it is case-insensitive, but a Linux path is case-sensitive on disk, so lowering
/// the string would corrupt the value rather than merely relax the match.
fn normalize_plan_folder(folder: &str) -> String {
    folder.trim().trim_end_matches(['/', '\\']).to_string()
}

/// The `(group, normalized folder)` pair a conflict search compares against, or `None` when there is
/// nothing to search for: a job type in no conflict group, or a plan-scoped type with no folder.
///
/// An empty folder is genuinely unmatchable rather than a free pass — `start_job_with` refuses a
/// plan-scoped job with no folder before either search runs, so nothing reaches here with one.
fn conflict_scope(job_type: &str, plan_folder: &str) -> Option<(&'static str, String)> {
    let group = conflict_group(job_type)?;
    let folder = normalize_plan_folder(plan_folder);
    if folder.is_empty() {
        return None;
    }
    Some((group, folder))
}

/// Translates a failed `insert_new_job` into the right error.
///
/// A unique-index violation on `DedupeKey` is the cross-process arm of the duplicate check: another
/// writer inserted the same work between our query and our insert. It deserves the same
/// [`TendrilError::DuplicateJob`] as the in-process rejection, so the operator sees a 409 either way.
/// The winning row's id is not in hand here, so the message reports the key instead.
///
/// A violation on `IdempotencyKey` is the same race for the other key: two retries of one submission
/// reaching two writers. The in-process path already returns the original job's id, so this arm only
/// fires across processes, where the id is likewise not in hand — a [`TendrilError::Conflict`] naming
/// the key is the honest answer, and is still better than the generic persist failure it used to be.
///
/// Every other failure — including a primary-key collision on `Id`, which is also a constraint
/// violation — stays a generic persist failure.
fn duplicate_or_other(
    e: rusqlite::Error,
    job_id: &str,
    dedupe_key: &Option<String>,
    idempotency_key: &Option<String>,
) -> TendrilError {
    if let rusqlite::Error::SqliteFailure(err, Some(msg)) = &e {
        if err.code == rusqlite::ErrorCode::ConstraintViolation {
            if msg.contains("DedupeKey") {
                return TendrilError::DuplicateJob(format!(
                    "This work is already in flight in another writer (dedupe key {}). Use force to \
                     submit it again.",
                    dedupe_key.as_deref().unwrap_or("unknown")
                ));
            }
            if msg.contains("IdempotencyKey") {
                return TendrilError::Conflict(format!(
                    "Idempotency key {} was claimed by another writer; retry to be handed the job \
                     it created.",
                    idempotency_key.as_deref().unwrap_or("unknown")
                ));
            }
        }
    }
    TendrilError::Other(format!("Failed to persist job {}: {}", job_id, e))
}

/// The priority a job launches with: an explicit override, else `CreatePlanArgs.priority`, else the
/// plan's own `plan.yaml` priority, else `0`.
fn resolve_job_priority(args: &JobArgs, plan_folder: &Path, override_priority: Option<i32>) -> i32 {
    if let Some(priority) = override_priority {
        return priority;
    }
    if let JobArgs::CreatePlan(create) = args {
        if create.priority != 0 {
            return create.priority;
        }
    }
    if plan_folder.as_os_str().is_empty() || !plan_folder.is_dir() {
        return 0;
    }
    read_plan_yaml(plan_folder)
        .map(|(plan, _)| plan.priority)
        .unwrap_or(0)
}

/// Records `chat_session_id` on the plan a finished job produced or worked on, so the plan's own later
/// events reach the conversation too. Never overwrites a session the plan already names: a plan opened
/// in its own side-panel chat belongs to that conversation, not to whichever chat last ran a job on it.
fn adopt_plan_into_chat_session(plans_dir: &Path, job: &JobItem, chat_session_id: &str) {
    // `plan_file` is empty for the `CreatePlan` that produced the plan, so fall back to the id the
    // promptware reported through `tendril job status --plan-id`.
    let folder = {
        let named = PathBuf::from(&job.plan_file);
        if named.is_dir() {
            Some(named)
        } else {
            let plan_id = job.resolve_plan_id();
            (!plan_id.is_empty())
                .then(|| resolve_plan_folder(&plan_id, plans_dir).ok())
                .flatten()
        }
    };
    let Some(folder) = folder else { return };

    let Ok((mut plan, _)) = read_plan_yaml(&folder) else {
        return;
    };
    if plan
        .chat_session_id
        .as_deref()
        .is_some_and(|id| !id.trim().is_empty())
    {
        return;
    }
    plan.chat_session_id = Some(chat_session_id.to_string());
    if let Err(e) = write_plan_yaml(&folder, &plan) {
        tracing::debug!(
            "Could not record chat session {chat_session_id} on plan {}: {e}",
            folder.display()
        );
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

/// The conversation a plan already belongs to, used to link a job that names the plan but was started
/// without a `--chat-session` of its own. Empty for a job with no plan — a `CreatePlan` has none yet,
/// which is why [`JobManager::finish_job`] stamps the link the other way round once the plan exists.
fn plan_chat_session_id(plan_folder: &Path) -> Option<String> {
    if plan_folder.as_os_str().is_empty() || !plan_folder.is_dir() {
        return None;
    }
    read_plan_yaml(plan_folder)
        .ok()
        .and_then(|(plan, _)| plan.chat_session_id)
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
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
async fn wait_for_jobs_block(ctx: &DispatchContext, job: &JobItem) -> Option<WaitOutcome> {
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
async fn release_wait_dependents(ctx: &DispatchContext, finished_id: &str) -> Vec<String> {
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
async fn release_blocked_job(ctx: &DispatchContext, mut job: JobItem) {
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

/// Starts the single [`dispatch_loop`] task, once per manager.
fn spawn_dispatcher(ctx: &DispatchContext) {
    if ctx.dispatcher_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let ctx = ctx.clone();
    tokio::spawn(async move { dispatch_loop(ctx).await });
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

/// Renders a duration the way the job list should read it.
fn describe_window(d: Duration) -> String {
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
async fn lookup_job(ctx: &DispatchContext, id: &str) -> Option<JobItem> {
    if let Some(job) = ctx.jobs.read().await.get(id).cloned() {
        return Some(job);
    }
    let db_path = crate::config::get_database_path(&ctx.tendril_home);
    open_database(&db_path)
        .ok()
        .and_then(|conn| get_job(&conn, id).ok().flatten())
}

/// Creates the control handle for a job if it does not have one yet.
async fn ensure_handle(handles: &Arc<RwLock<HashMap<String, JobHandle>>>, job_id: &str) {
    handles
        .write()
        .await
        .entry(job_id.to_string())
        .or_insert_with(JobHandle::new);
}

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

/// Arms the runner for one job, handing it the slot the dispatcher just took.
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

/// Shared liveness state for one running job, written by the output callback and read by the
/// watchdog.
struct OutputActivity {
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
    fn new() -> Self {
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
async fn run_stale_output_watchdog(
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

#[allow(clippy::too_many_lines, clippy::too_many_arguments)]
fn spawn_runner(
    ctx: DispatchContext,
    mut job: JobItem,
    cancel_tx: Arc<watch::Sender<bool>>,
    pid: Arc<AtomicU32>,
    completion_claimed: Arc<AtomicBool>,
    settings: TendrilSettings,
    permit: OwnedSemaphorePermit,
) {
    let tendril_home = ctx.tendril_home.clone();
    // Resolved once, here, and passed down: `finish_job` deletes orphan plan folders, and an
    // ambient `TENDRIL_PLANS` lookup inside it would point a test at the real plans directory.
    let plans_dir = ctx
        .plans_dir_override
        .clone()
        .unwrap_or_else(|| get_plans_dir_with_settings(&tendril_home, Some(&settings)));
    let jobs_map = ctx.jobs.clone();
    let handles = ctx.handles.clone();
    let job_events = ctx.events.clone();
    let spec_builder = ctx.spec_builder.clone();
    let hook_executor = ctx.hook_executor.clone();
    let dispatch_notify = ctx.dispatch_notify.clone();
    let timeout = ctx
        .job_timeout_override
        .or_else(|| job_timeout_duration(&settings));
    let post_result_grace = ctx
        .post_result_grace_override
        .unwrap_or(crate::agents::runner::DEFAULT_POST_RESULT_GRACE);
    let stale_timeout = ctx
        .stale_output_timeout_override
        .or_else(|| stale_output_timeout_duration(&settings));

    tokio::spawn(async move {
        // The permit is held for the whole life of the job, and released to the dispatcher at the end.
        let permit = permit;
        let job_id = job.id.clone();
        let cancel_rx = cancel_tx.subscribe();

        // A job cancelled while it was still queued never had a process; cancel_job has already
        // written its terminal state, so there is nothing left to do.
        if *cancel_rx.borrow() {
            drop(permit);
            dispatch_notify.notify_one();
            return;
        }

        job.status = JobStatus::Running;
        // The dispatch path's own announcement: without it a job that starts while no job view is
        // open is invisible until the next poll.
        persist(&tendril_home, &jobs_map, &job, Some(&job_events)).await;

        // `before` hooks fire once the job is genuinely starting: past the queue and the cancel
        // check, ahead of everything that can still fail. A hook cannot stop the job — a failing one
        // is logged and ignored, see `crate::jobs::hooks`.
        if let Some(hook_ctx) = hook_context(
            &tendril_home,
            &settings,
            &job,
            JobStatus::Running,
            HookPhase::Before,
        ) {
            run_hooks(&hook_ctx, HookPhase::Before, &hook_executor).await;
        }

        let promptware_folder = tendril_home.join("Promptwares").join(&job.job_type);
        if !promptware_folder.is_dir() {
            let msg = format!(
                "Promptware folder not found: {}",
                promptware_folder.display()
            );
            // No `after` hooks here, deliberately: a launch that never got as far as an agent has
            // nothing for a hook to react to, and the same is true of the compile failure below.
            finish_job(
                &tendril_home,
                &plans_dir,
                &jobs_map,
                &handles,
                &completion_claimed,
                job,
                JobStatus::Failed,
                msg,
                None,
                Some(&job_events),
            )
            .await;
            release_wait_dependents(&ctx, &job_id).await;
            drop(permit);
            dispatch_notify.notify_one();
            return;
        }

        let values = build_firmware_values(&job, &tendril_home, &settings);
        let skills = resolve_project_skills(&settings, &job.project, &tendril_home);
        let compiled_prompt =
            match compile_firmware_with_skills(&promptware_folder, &values, &skills) {
                Ok(p) => p,
                Err(e) => {
                    let msg = format!(
                        "Failed to compile firmware from {}: {}",
                        promptware_folder.display(),
                        e
                    );
                    finish_job(
                        &tendril_home,
                        &plans_dir,
                        &jobs_map,
                        &handles,
                        &completion_claimed,
                        job,
                        JobStatus::Failed,
                        msg,
                        None,
                        Some(&job_events),
                    )
                    .await;
                    release_wait_dependents(&ctx, &job_id).await;
                    drop(permit);
                    dispatch_notify.notify_one();
                    return;
                }
            };

        if let Err(e) = write_prompt(&tendril_home, &job_id, &compiled_prompt) {
            tracing::warn!("Failed to persist prompt for job {}: {}", job_id, e);
        }

        let working_dir =
            resolve_working_directory(&job, &settings, &tendril_home, &promptware_folder);

        if let Ok((plan, _)) = read_plan_yaml(Path::new(&job.plan_file)) {
            if let Some(profile) = execution_profile_override(&job, &plan) {
                job.execution_profile = Some(profile);
            }
        }

        let security = find_project(&settings, &resolve_project(&job, &settings))
            .map(|p| p.security.clone())
            .unwrap_or_default();

        // What the agent is actually launched with. Without this the launch config carries no
        // allowlist at all, which sends `build_claude_spec` down its restrictive fallback and denies
        // the shell commands every promptware is built out of — so the job burns tokens and reports
        // "exited 0 with no commits recorded". V1 resolves the same way in `AgentProviderFactory`.
        let job_context = build_job_context(&values, &tendril_home, &promptware_folder);
        let resolution = resolve_agent(
            &settings,
            &job.provider,
            &job.job_type,
            job.execution_profile.as_deref(),
            &job_context,
        );

        let mut launch_config = AgentLaunchConfig {
            prompt: compiled_prompt,
            working_directory: working_dir.clone(),
            // The job's own model and effort win when it carries them: an explicit per-job choice is
            // downstream of the profile the resolution applied.
            model: job.model.clone().or_else(|| resolution.model.clone()),
            effort: job.effort.clone().or_else(|| resolution.effort.clone()),
            permission_mode: Some("FullAuto".to_string()),
            allowed_tools: resolution.allowed_tools.clone(),
            denied_tools: resolution.denied_tools.clone(),
            writable_directories: resolve_writable_directories(
                &job.job_type,
                &promptware_folder,
                Path::new(&job.plan_file),
                &tendril_home,
                &settings,
            ),
            environment_variables: resolution.environment_variables.clone(),
            extra_arguments: resolution.extra_arguments.clone(),
            ..Default::default()
        };
        apply_security_settings(&mut launch_config, &security);

        let spec = (spec_builder)(&job.provider, &launch_config);
        job.working_directory = Some(working_dir.to_string_lossy().to_string());
        job.cli_command = Some(format!("{} {}", spec.command, spec.args.join(" ")));

        let start_time = Instant::now();
        let th = tendril_home.clone();
        let jid = job_id.clone();
        let pid_slot = pid.clone();
        let jobs_for_pid = jobs_map.clone();
        let home_for_pid = tendril_home.clone();
        let job_for_pid = job.clone();

        // Liveness plumbing: the callback stamps activity, the watchdog reads it.
        let activity = Arc::new(OutputActivity::new());
        let finished = Arc::new(AtomicBool::new(false));
        let stale_fired = Arc::new(AtomicBool::new(false));
        if let Some(stale) = stale_timeout {
            tokio::spawn(run_stale_output_watchdog(
                job_id.clone(),
                activity.clone(),
                stale,
                cancel_tx.clone(),
                finished.clone(),
                stale_fired.clone(),
            ));
        }
        let activity_for_output = activity.clone();
        let home_for_output = tendril_home.clone();
        let id_for_output = job_id.clone();
        let jobs_for_output = jobs_map.clone();

        // Stateful, and held by the `FnMut` closure rather than shared: Antigravity ties a tool call's
        // two halves together by `step_index`, so the normalizer has to remember the open ones.
        let mut eventwire = EventWireNormalizer::new();

        let run_res = run_agent_process_with_grace(
            spec,
            move |evt| {
                let _ = append_to_raw_log(&th, &jid, &evt.raw_line);
                // A provider's own line is *not* eventwire. `parseEventWireStream` keeps only lines
                // carrying a `kind`, so appending the raw line here left `AgentViewer` with nothing to
                // render in `JobSessionView` - for every provider, not just one. Normalising first is
                // what the chat turn already does; this is the same layer, so a job's tool disclosure
                // and a chat turn's now come from one implementation.
                for event_line in eventwire.normalize(&evt.raw_line, evt.is_stderr) {
                    let _ = append_to_eventwire(&th, &jid, &event_line);
                }
                note_agent_output(
                    &activity_for_output,
                    &jobs_for_output,
                    &home_for_output,
                    &id_for_output,
                    &evt.raw_line,
                );
            },
            move |spawned_pid| {
                pid_slot.store(spawned_pid, Ordering::SeqCst);
                // Persist the PID immediately: startup reconciliation uses it to tell a
                // detached agent from an interrupted one.
                let mut with_pid = job_for_pid;
                with_pid.process_id = Some(spawned_pid);
                tokio::spawn(async move {
                    // No sender: the status has not moved since the `Running` write above, so this
                    // would be a duplicate event even before `persist`'s own guard sees it.
                    persist(&home_for_pid, &jobs_for_pid, &with_pid, None).await;
                });
            },
            cancel_rx,
            timeout,
            post_result_grace,
        )
        .await;

        finished.store(true, Ordering::SeqCst);
        job.process_id = Some(pid.load(Ordering::SeqCst)).filter(|p| *p != 0);
        // This task's own copy predates every write the run made, and `finish_job` persists the whole
        // record — so anything the *running agent* reported has to be taken from the live record here or
        // the terminal write erases it.
        //
        // `last_output_at` is the heartbeat `note_agent_output` maintains: without it a job's row
        // remembers when it started but not when it last spoke. The other three are what the promptware
        // reports over HTTP while it works — `tendril job status --plan-id/--plan-title` and
        // `tendril job fail --message` — and losing them is why a `CreatePlan` that really did produce a
        // plan came out with `ReportedPlanId` NULL: the chat then had no plan to name in its follow-up
        // turn, `adopt_plan_into_chat_session` had nothing to stamp the plan with, and
        // `resolve_created_plan_folder` lost the candidate it needed to recognise the plan at all.
        if let Some(current) = jobs_map.read().await.get(&job_id) {
            if let Some(at) = current.last_output_at {
                job.last_output_at = Some(at);
            }
            if current.reported_plan_id.is_some() {
                job.reported_plan_id = current.reported_plan_id.clone();
            }
            if current.reported_plan_title.is_some() {
                job.reported_plan_title = current.reported_plan_title.clone();
            }
            if current.reported_failure_reason.is_some() {
                job.reported_failure_reason = current.reported_failure_reason.clone();
            }
            // A `CreatePlan` that reported its plan mid-run learned its project then; this copy still
            // says `Auto`, and the terminal write would put that back.
            if is_auto_project(&job.project) && !is_auto_project(&current.project) {
                job.project = current.project.clone();
            }
        }

        // A tool_call that never received a tool_result leaves its card spinning forever in
        // AgentViewer, since that's fed straight from this eventwire log. Close any out before
        // classifying the outcome, using the same reason text the chat path uses.
        let synthetic_output = match &run_res {
            Ok(outcome) => match outcome.terminated {
                TerminationReason::Cancelled => "[Cancelled]",
                TerminationReason::TimedOut => "[Timed out]",
                TerminationReason::Exited | TerminationReason::PostResultGraceExceeded => {
                    "[No output received]"
                }
            },
            Err(_) => "[No output received]",
        };
        if let Ok(Some(ev_lines)) = read_eventwire_log(&tendril_home, &job_id, None) {
            for line in build_missing_result_lines(&ev_lines, synthetic_output, true) {
                let _ = append_to_eventwire(&tendril_home, &job_id, &line);
            }
        }

        let duration = start_time.elapsed().as_secs() as i64;
        let (final_status, msg) = classify_outcome(
            run_res,
            timeout,
            stale_fired
                .load(Ordering::SeqCst)
                .then(|| stale_timeout.unwrap_or_default()),
        );

        let finished = job.clone();
        let completed = finish_job(
            &tendril_home,
            &plans_dir,
            &jobs_map,
            &handles,
            &completion_claimed,
            job,
            final_status,
            msg,
            Some(duration),
            Some(&job_events),
        )
        .await;

        // `after` hooks read the status `finish_job` settled on, not the one the process reported: a
        // `Completed` that produced no deliverable is a `Failed`, and that is what a hook must see.
        // `None` means a cancellation had already claimed completion and written the terminal state,
        // so the job this task was running no longer owns the outcome.
        if let Some(completed) = &completed {
            if let Some(hook_ctx) = hook_context(
                &tendril_home,
                &settings,
                completed,
                completed.status,
                HookPhase::After,
            ) {
                run_hooks(&hook_ctx, HookPhase::After, &hook_executor).await;
            }
        }

        // `finish_job`'s signature is public and depended on by tests, so the release step lives here
        // rather than inside it. The maintenance pass rechecks the same thing every 60s, which covers
        // a job that finished while the daemon was down.
        release_wait_dependents(&ctx, &job_id).await;

        // Anything that was waiting on this job is re-gated now the terminal state is written. A
        // manager that was never published as an `Arc` yields `None` and simply restarts nothing.
        let manager = ctx.self_handle.upgrade();
        release_dependents(
            &tendril_home,
            &plans_dir,
            &jobs_map,
            manager.as_ref(),
            &finished,
        )
        .await;

        drop(permit);
        dispatch_notify.notify_one();
    });
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
fn note_agent_output(
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

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

/// Creates the plan's worktrees before its agent is launched, one per repo in `plan.repos`, and
/// records them on the plan.
///
/// Returns `Err` with the message the job should fail with. Continuing without a worktree would run
/// the agent against the operator's main checkout, so a creation failure is fatal to the job — which
/// is also what the promptware does when `tendril plan add-worktree` exits non-zero.
///
/// Only `plan.repos` are covered here. Read-only build dependencies reach the same `add_worktree`
/// through the CLI, driven by the promptware's `RepoConfigs` loop.
pub async fn prepare_plan_worktrees(
    tendril_home: &Path,
    job: &JobItem,
    settings: &TendrilSettings,
) -> std::result::Result<(), String> {
    if !matches!(job.job_type.as_str(), "ExecutePlan" | "RetryPlan") {
        return Ok(());
    }

    let plan_folder = PathBuf::from(&job.plan_file);
    if !plan_folder.is_dir() {
        return Ok(());
    }

    let Ok((plan, _)) = read_plan_yaml(&plan_folder) else {
        return Ok(());
    };
    if plan.repos.is_empty() {
        return Ok(());
    }

    // A PR-sourced plan must be based on the PR's own head branch, which the promptware does itself
    // and explicitly cannot do through `add-worktree`. Pre-cutting a `tendril/*` branch here would
    // only be thrown away.
    if plan
        .source_url
        .as_deref()
        .is_some_and(|u| u.contains("/pull/"))
    {
        tracing::info!(
            "Job {}: not pre-creating worktrees for {} — the plan's source is a pull request, so the promptware bases the worktree on the PR's head branch",
            job.id,
            job.plan_file
        );
        return Ok(());
    }

    let project_config = find_project(settings, &resolve_project(job, settings));

    for repo_path in &plan.repos {
        let base = project_config
            .and_then(|c| find_repo_ref(c, repo_path))
            .and_then(|r| r.base_branch.clone());

        let repo = PathBuf::from(repo_path);
        let name = repo_name(repo_path).to_string();
        let plan_folder_for_task = plan_folder.clone();
        let home = tendril_home.to_path_buf();

        // git is blocking, and this runs on the runtime.
        let created = tokio::task::spawn_blocking(move || {
            let log = WorktreeLifecycleLog::new(&home);
            let creation = add_worktree(
                &repo,
                &plan_folder_for_task,
                base.as_deref(),
                WorktreeMode::ReuseIfValid,
                Some(&log),
            )?;

            // The checkout is what matters; a registry write failure is not worth failing the job
            // for, because the reaper also finds worktrees by directory scan.
            if let Err(e) = register_worktree(
                &plan_folder_for_task,
                PlanWorktreeEntry {
                    repo: creation.repo.to_string_lossy().to_string(),
                    path: creation.path.to_string_lossy().to_string(),
                    branch: creation.branch.clone(),
                    created: Utc::now(),
                },
            ) {
                tracing::warn!(
                    "Failed to register worktree {} on plan {}: {}",
                    creation.path.display(),
                    plan_folder_for_task.display(),
                    e
                );
            }

            Ok::<_, TendrilError>(creation)
        })
        .await;

        match created {
            Ok(Ok(creation)) => tracing::info!(
                "Job {}: {} worktree {} on {}",
                job.id,
                if creation.reused { "reused" } else { "created" },
                creation.path.display(),
                creation.branch
            ),
            Ok(Err(e)) => {
                return Err(format!("Worktree creation failed for {}: {}", name, e));
            }
            Err(e) => {
                return Err(format!("Worktree creation failed for {}: {}", name, e));
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Plan state transitions
// ---------------------------------------------------------------------------

/// The state a plan takes while its job runs.
pub fn in_flight_plan_state(job_type: &str) -> Option<PlanStatus> {
    match job_type {
        "ExecutePlan" | "RetryPlan" => Some(PlanStatus::Executing),
        "CreatePlan" | "ExpandPlan" => Some(PlanStatus::Creating),
        "UpdatePlan" | "SplitPlan" => Some(PlanStatus::Updating),
        _ => None,
    }
}

/// Where a plan lands when its job exits successfully.
///
/// `ExecutePlan` and `RetryPlan` go through the verification gate, so a plan with a `Pending` or
/// `Fail` row (or a rejected pre-execution check) cannot reach `Review`. `CreatePr` is absent on
/// purpose: that promptware sets `Completed` itself.
pub fn plan_state_on_success(
    job_type: &str,
    plan: &PlanYaml,
    plan_folder: &Path,
) -> Option<PlanStatus> {
    match job_type {
        "ExecutePlan" | "RetryPlan" => Some(resolve_post_execution_state(plan, plan_folder, None)),
        "CreatePlan" | "UpdatePlan" | "ExpandPlan" => Some(PlanStatus::Draft),
        "SplitPlan" => Some(PlanStatus::Skipped),
        "CreateIssue" => Some(PlanStatus::Completed),
        _ => None,
    }
}

/// The state to fall back to when no `previousPlanState` was captured, after a restart, say.
pub fn fallback_previous_state(job_type: &str) -> Option<PlanStatus> {
    match job_type {
        "ExecutePlan" | "ExpandPlan" | "UpdatePlan" | "SplitPlan" | "CreatePlan" => {
            Some(PlanStatus::Draft)
        }
        "RetryPlan" => Some(PlanStatus::Review),
        _ => None,
    }
}

/// Resolves the state a plan should be restored to after a failed, timed-out or cancelled job.
/// `Blocked` maps to `Draft`: re-entering `Blocked` without re-running the gate would strand the plan.
pub fn revert_target(previous_plan_state: Option<&str>, job_type: &str) -> Option<PlanStatus> {
    let target = previous_plan_state
        .and_then(PlanStatus::from_str_loose)
        .or_else(|| fallback_previous_state(job_type))?;

    Some(if target == PlanStatus::Blocked {
        PlanStatus::Draft
    } else {
        target
    })
}

/// Restores the plan to its pre-job state. No-op for jobs without a plan.
pub fn revert_plan_state(job: &JobItem) {
    if job.plan_file.is_empty() {
        return;
    }
    let plan_path = Path::new(&job.plan_file);
    let current = read_plan_state(plan_path);
    let plan_id = plan_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&job.plan_file);

    // Terminal plans (Completed or Skipped) are immutable, whatever the revert target would be
    if let Some(reason) = PlanCompletionGuard::terminal_refusal(current, None) {
        tracing::info!("Job {}: Not reverting plan {}: {}", job.id, plan_id, reason);
        return;
    }

    if let Some(target) = revert_target(job.previous_plan_state.as_deref(), &job.job_type) {
        // Do not stomp Review or Failed back to Draft on stale timeout or failure
        if matches!(current, Some(PlanStatus::Review | PlanStatus::Failed))
            && target == PlanStatus::Draft
        {
            tracing::info!(
                "Job {}: Not reverting plan {} from {:?} to Draft",
                job.id,
                plan_id,
                current.unwrap()
            );
            return;
        }

        apply_plan_state(plan_path, target);
    }
}

/// Writes a plan state through [`PlanCompletionGuard`], so the `Completed`-over-`Fail` rule holds for
/// every transition the job engine makes.
pub fn apply_plan_state(plan_folder: &Path, state: PlanStatus) {
    if plan_folder.as_os_str().is_empty() || !plan_folder.is_dir() {
        return;
    }
    let Ok((mut plan, _)) = read_plan_yaml(plan_folder) else {
        return;
    };
    let plan_id = plan_folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();

    // Terminal plans (Completed or Skipped) are immutable
    if let Some(reason) =
        PlanCompletionGuard::terminal_refusal(PlanStatus::from_str_loose(&plan.state), Some(state))
    {
        tracing::info!("Not setting plan {} to {:?}: {}", plan_id, state, reason);
        return;
    }

    let from_state = plan.state.clone();

    match PlanCompletionGuard::apply_state(&mut plan, state, false, plan_id) {
        Ok(warning) => {
            if let Some(w) = warning {
                tracing::warn!("{}", w);
            }
            plan.updated = Utc::now();
            if let Err(e) = write_plan_yaml(plan_folder, &plan) {
                tracing::warn!("Failed to write plan state for {}: {}", plan_id, e);
                return;
            }
            // Tracked only for a transition that actually reached disk, and only from the process that
            // installed a client — so a CLI `tendril plan set` sends nothing.
            crate::telemetry::tracker().track_plan_state_transition(
                &crate::telemetry::PlanStateTransitionContext {
                    from_state,
                    to_state: state.as_str().to_string(),
                    plan_id: plan_id_from_folder_name(plan_id),
                },
            );
        }
        Err(e) => tracing::warn!("Plan {} state transition refused: {}", plan_id, e),
    }
}

/// Mirrors a plan folder's current `plan.yaml` into the `Plans` table.
///
/// Every HTTP route that writes a plan pairs `write_plan_yaml` with `sync_plan`; the job engine did
/// not, so a state it moved reached `plan.yaml` and stopped there. This is that pairing, for the job
/// engine's own transitions.
///
/// Never fails a job: a plan whose row could not be refreshed is a stale list entry, which the 30s
/// rescan and the watcher's re-sync both still repair, whereas a job failed over a database hiccup
/// discards real work. Every failure path is therefore a `warn` and a return.
pub fn sync_plan_state_to_db(tendril_home: &Path, plan_folder: &Path) {
    if plan_folder.as_os_str().is_empty() || !plan_folder.is_dir() {
        return;
    }

    // Locked, like the watcher's re-sync: the state write that led here released the lock, but a
    // concurrent writer may hold it, and mirroring a half-written document is worse than not
    // mirroring at all.
    let plan = match crate::plans::reader::read_plan_file_locked(plan_folder) {
        Ok(plan) => plan,
        Err(e) => {
            tracing::warn!(
                "Not mirroring {} to the database: {}",
                plan_folder.display(),
                e
            );
            return;
        }
    };

    let db_path = crate::config::get_database_path(tendril_home);
    match open_database(&db_path) {
        Ok(conn) => {
            if let Err(e) = crate::db::plans::sync_plan(&conn, &plan) {
                tracing::warn!("Failed to mirror plan {} state: {}", plan.folder_name, e);
            }
        }
        Err(e) => tracing::warn!(
            "Failed to open the database to mirror plan {}: {}",
            plan.folder_name,
            e
        ),
    }
}

fn read_plan_state(plan_folder: &Path) -> Option<PlanStatus> {
    if plan_folder.as_os_str().is_empty() || !plan_folder.is_dir() {
        return None;
    }
    read_plan_yaml(plan_folder)
        .ok()
        .and_then(|(plan, _)| PlanStatus::from_str_loose(&plan.state))
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

fn is_terminal(status: JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped
    )
}

fn job_timeout_duration(settings: &TendrilSettings) -> Option<Duration> {
    if settings.job_timeout > 0 {
        Some(Duration::from_secs(settings.job_timeout as u64 * 60))
    } else {
        None
    }
}

/// The silence window after which a job is killed, or `None` when the setting disables the watchdog.
/// Expressed in whole minutes, like `jobTimeout`.
fn stale_output_timeout_duration(settings: &TendrilSettings) -> Option<Duration> {
    if settings.stale_output_timeout > 0 {
        Some(Duration::from_secs(
            settings.stale_output_timeout as u64 * 60,
        ))
    } else {
        None
    }
}

/// Maps an agent run to the job's terminal status. `stale_output` carries the silence window when the
/// cancellation came from the stale-output watchdog rather than from a user.
fn classify_outcome(
    run_res: Result<AgentRunOutcome>,
    timeout: Option<Duration>,
    stale_output: Option<Duration>,
) -> (JobStatus, String) {
    if let (Some(window), Ok(outcome)) = (stale_output, &run_res) {
        if outcome.terminated == TerminationReason::Cancelled {
            return (
                JobStatus::Timeout,
                format!(
                    "No agent output for {} (stale output timeout)",
                    describe_window(window)
                ),
            );
        }
    }

    match run_res {
        Ok(outcome) => match outcome.terminated {
            TerminationReason::Exited => match outcome.exit_code {
                Some(0) => (JobStatus::Completed, "Completed successfully".to_string()),
                Some(code) => (
                    JobStatus::Failed,
                    format!("Process exited with code {}", code),
                ),
                None => (
                    JobStatus::Failed,
                    "Process terminated without an exit code".to_string(),
                ),
            },
            TerminationReason::Cancelled => (JobStatus::Stopped, "Cancelled".to_string()),
            TerminationReason::TimedOut => (
                JobStatus::Timeout,
                format!(
                    "Job timed out after {} seconds",
                    timeout.map(|t| t.as_secs()).unwrap_or_default()
                ),
            ),
            TerminationReason::PostResultGraceExceeded => match outcome.exit_code {
                Some(0) => (
                    JobStatus::Completed,
                    "Completed with result event outcome after post-result grace period"
                        .to_string(),
                ),
                Some(code) => (
                    JobStatus::Failed,
                    format!(
                        "Process terminated after post-result grace period with exit code {}",
                        code
                    ),
                ),
                None => (
                    JobStatus::Completed,
                    "Completed with result event outcome after post-result grace period"
                        .to_string(),
                ),
            },
        },
        Err(e) => (JobStatus::Failed, format!("Execution failed: {}", e)),
    }
}

/// `Some` only for a genuinely non-empty string. Telemetry omits a property rather than sending an
/// empty one, as the original does.
fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The plan id to hand a telemetry context, as a string. `Telemetry` normalizes and salts it into
/// `plan_uuid`; the raw value never leaves the process.
fn telemetry_plan_id(job: &JobItem) -> Option<String> {
    resolve_numerical_plan_id(job).map(|id| id.to_string())
}

/// The leading id of a `NNNNN-SafeTitle` folder name. Same reason as [`telemetry_plan_id`]: the
/// caller has a folder name rather than a job.
fn plan_id_from_folder_name(folder_name: &str) -> Option<String> {
    let digits: String = folder_name
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    (!digits.is_empty()).then_some(digits)
}

fn resolve_numerical_plan_id(job: &JobItem) -> Option<i32> {
    if let Some(ref id_str) = job.reported_plan_id {
        if let Ok(id) = id_str.trim().parse::<i32>() {
            return Some(id);
        }
    }
    let file_name = std::path::Path::new(&job.plan_file)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(&job.plan_file);
    let digits: String = file_name
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if !digits.is_empty() {
        if let Ok(id) = digits.parse::<i32>() {
            return Some(id);
        }
    }
    None
}

pub fn extract_and_record_usage(tendril_home: &Path, job: &mut JobItem) {
    let mut extracted_timestamp: Option<String> = None;

    let needs_tokens = job.tokens.is_none();
    let needs_cost = job.cost.is_none();
    let needs_breakdown = job.input_tokens.is_none()
        || job.output_tokens.is_none()
        || job.cache_read_tokens.is_none()
        || job.cache_write_tokens.is_none();

    if needs_tokens || needs_cost || needs_breakdown {
        if let Some(log_path) = find_log_file(tendril_home, &job.id, ".eventwire.jsonl")
            .or_else(|| find_log_file(tendril_home, &job.id, ".raw.jsonl"))
        {
            if let Ok(file) = std::fs::File::open(&log_path) {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(file);
                for line in reader.lines().map_while(|l| l.ok()) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        let is_result = v.get("kind").and_then(|k| k.as_str()) == Some("result")
                            || v.get("type").and_then(|t| t.as_str()) == Some("result")
                            || v.get("type").and_then(|t| t.as_str()) == Some("turn.completed");

                        let usage_opt = v.get("usage");
                        if is_result || usage_opt.is_some() {
                            if let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) {
                                extracted_timestamp = Some(ts.to_string());
                            }
                            if let Some(m) = v.get("model").and_then(|m| m.as_str()) {
                                if job.model.is_none() {
                                    job.model = Some(m.to_string());
                                }
                            }
                            // Claude Code's result event carries no `model`; it reports usage keyed
                            // by model id under `modelUsage`. Without this the model column stays
                            // empty and the cost estimate falls back to a default model's pricing.
                            if job.model.is_none() {
                                if let Some(first) = v
                                    .get("modelUsage")
                                    .and_then(|m| m.as_object())
                                    .and_then(|m| m.keys().next())
                                {
                                    job.model = Some(first.to_string());
                                }
                            }
                            if let Some(usage) = usage_opt {
                                if let Some(m) = usage.get("model").and_then(|m| m.as_str()) {
                                    if job.model.is_none() {
                                        job.model = Some(m.to_string());
                                    }
                                }

                                let in_tok = usage
                                    .get("input_tokens")
                                    .or_else(|| usage.get("inputTokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                let out_tok = usage
                                    .get("output_tokens")
                                    .or_else(|| usage.get("outputTokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                // `cache_read_input_tokens` is what Claude Code's result event
                                // actually calls this, and it dominates the bill on a long run —
                                // without the alias a 227k-token cache read was recorded as 0.
                                let cache_read_tok = usage
                                    .get("cache_read_tokens")
                                    .or_else(|| usage.get("cacheReadTokens"))
                                    .or_else(|| usage.get("cached_input_tokens"))
                                    .or_else(|| usage.get("cache_read_input_tokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                // Likewise `cache_creation_input_tokens` for the write side.
                                let cache_write_tok = usage
                                    .get("cache_write_tokens")
                                    .or_else(|| usage.get("cacheWriteTokens"))
                                    .or_else(|| usage.get("cache_write_input_tokens"))
                                    .or_else(|| usage.get("cache_creation_input_tokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                let reasoning_tok = usage
                                    .get("reasoning_tokens")
                                    .or_else(|| usage.get("reasoningTokens"))
                                    .or_else(|| usage.get("reasoning_output_tokens"))
                                    .and_then(|n| n.as_i64());

                                let total_tok = in_tok + out_tok + cache_read_tok + cache_write_tok;

                                job.input_tokens = Some(in_tok);
                                job.output_tokens = Some(out_tok);
                                job.cache_read_tokens = Some(cache_read_tok);
                                job.cache_write_tokens = Some(cache_write_tok);
                                if reasoning_tok.is_some() {
                                    job.reasoning_tokens = reasoning_tok;
                                }
                                job.tokens = Some(total_tok);

                                // `total_cost_usd` is the field Claude Code reports, and it is the
                                // agent's own figure — preferred over our estimate, which cannot know
                                // the caller's plan or tier.
                                let provider_cost = usage
                                    .get("cost")
                                    .or_else(|| v.get("cost"))
                                    .or_else(|| v.get("total_cost"))
                                    .or_else(|| v.get("total_cost_usd"))
                                    .or_else(|| usage.get("total_cost_usd"))
                                    .and_then(|c| c.as_f64());

                                if let Some(cost) = provider_cost {
                                    job.cost = Some(cost);
                                    job.cost_source = Some("agent".to_string());
                                } else if job.cost.is_none() {
                                    let model_name =
                                        job.model.as_deref().unwrap_or("claude-3-5-sonnet");
                                    let calculated = crate::agents::pricing::calculate_cost(
                                        model_name,
                                        in_tok,
                                        out_tok,
                                        cache_read_tok,
                                        cache_write_tok,
                                    );
                                    job.cost = Some(calculated);
                                    job.cost_source = Some("estimated".to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // `job.cost` stays an Option all the way to the row: a subscription-plan run reports tokens and
    // no charge, and writing 0.0 would make it read as free. Tokens is NOT NULL in both schemas, so
    // that one does get a default.
    let tokens = job.tokens.unwrap_or(0);

    if job.tokens.is_some() || job.cost.is_some() {
        if let Some(pid) = resolve_numerical_plan_id(job) {
            let db_path = crate::config::get_database_path(tendril_home);
            if let Ok(conn) = open_database(&db_path) {
                // One query gives both the plan's existence and its folder.
                let folder_path: Option<String> = conn
                    .query_row(
                        "SELECT FolderPath FROM Plans WHERE Id = ?1",
                        rusqlite::params![pid],
                        |row| row.get(0),
                    )
                    .ok();

                if let Some(folder_path) = folder_path {
                    let log_timestamp = extracted_timestamp
                        .or_else(|| job.completed_at.map(|dt| dt.to_rfc3339()))
                        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

                    let entry = crate::db::costs::CostEntry {
                        promptware: job.job_type.clone(),
                        tokens,
                        cost: job.cost,
                        model: job.model.clone(),
                        cost_source: job.cost_source.clone(),
                        agent: Some(job.provider.clone()),
                        log_timestamp: Some(log_timestamp.clone()),
                    };

                    // costs.csv is the durable record shared with the original app; the table is a
                    // projection of it. Appending and then reconciling is what keeps both apps
                    // idempotent with respect to each other. A cost-recording failure must never
                    // fail the job, hence warn-and-continue throughout.
                    let folder = std::path::Path::new(&folder_path);
                    if folder.is_dir() {
                        if let Err(e) = crate::plans::costs_csv::append_cost(folder, &entry) {
                            tracing::warn!(
                                "Failed to append cost row to costs.csv for plan {}: {}",
                                pid,
                                e
                            );
                        }
                        if let Err(e) = crate::plans::costs_csv::reconcile_plan_costs(
                            &conn,
                            folder,
                            pid,
                            Some(&log_timestamp),
                        ) {
                            tracing::warn!("Failed to reconcile costs for plan {}: {}", pid, e);
                        }
                    } else if let Err(e) = crate::db::costs::insert_cost_entry(&conn, pid, &entry) {
                        // No plan folder on disk: record the row directly rather than losing it.
                        tracing::warn!("Failed to insert cost record for plan {}: {}", pid, e);
                    }
                }
            }
        }
    }
}

pub fn find_abandoned_background_tasks(lines: &[String]) -> Vec<String> {
    let start_re = regex::Regex::new(
        r"(?i)(?:was moved to the background|running in background with ID:?)\s*(?:\(?ID:?\s*)?(?<id>[a-z0-9_-]+)\)?"
    ).unwrap();

    let complete_re = regex::Regex::new(
        r"(?i)(?:task|background task)\s*(?:with\s+ID:?\s*|ID:?\s*)?(?<id>[a-z0-9_-]+)\s*(?:has\s+)?(?:completed|finished|terminated|exited|killed|stopped)"
    ).unwrap();

    let complete_re2 = regex::Regex::new(
        r"(?i)(?:completed|finished|terminated|exited|killed|stopped)\s*(?:background\s+)?task\s*(?:with\s+ID:?\s*|ID:?\s*)?(?<id>[a-z0-9_-]+)"
    ).unwrap();

    let complete_re3 = regex::Regex::new(
        r#"(?i)(?:"task_id"|"taskId")\s*:\s*"(?<id>[a-z0-9_-]+)".*?"(?:completed|finished|stopped|terminated)""#
    ).unwrap();

    let mut started = std::collections::HashSet::new();
    let mut completed = std::collections::HashSet::new();

    for line in lines {
        if let Some(caps) = start_re.captures(line) {
            if let Some(id) = caps.name("id") {
                started.insert(id.as_str().to_string());
            }
        }
        if let Some(caps) = complete_re.captures(line) {
            if let Some(id) = caps.name("id") {
                completed.insert(id.as_str().to_string());
            }
        }
        if let Some(caps) = complete_re2.captures(line) {
            if let Some(id) = caps.name("id") {
                completed.insert(id.as_str().to_string());
            }
        }
        if let Some(caps) = complete_re3.captures(line) {
            if let Some(id) = caps.name("id") {
                completed.insert(id.as_str().to_string());
            }
        }
    }

    let mut abandoned: Vec<String> = started
        .into_iter()
        .filter(|id| !completed.contains(id))
        .collect();
    abandoned.sort();
    abandoned
}

fn check_job_truncation(tendril_home: &Path, job: &JobItem) -> bool {
    // 1. Check event log files for truncation reasons
    for suffix in [".eventwire.jsonl", ".raw.jsonl"] {
        if let Some(log_path) = find_log_file(tendril_home, &job.id, suffix) {
            if let Ok(file) = std::fs::File::open(&log_path) {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(file);
                for line in reader.lines().map_while(|l| l.ok()) {
                    if crate::agents::truncation::is_event_line_truncated(&line) {
                        return true;
                    }
                }
            }
        }
    }

    // 2. Check output artifacts in the plan folder if available
    if !job.plan_file.is_empty() {
        let plan_folder = Path::new(&job.plan_file);
        if plan_folder.is_dir() {
            for sub in ["Revisions", "revisions"] {
                let rev_dir = plan_folder.join(sub);
                if rev_dir.is_dir() {
                    if let Ok(entries) = std::fs::read_dir(&rev_dir) {
                        let mut md_files: Vec<PathBuf> = entries
                            .filter_map(|e| e.ok())
                            .map(|e| e.path())
                            .filter(|p| p.extension().and_then(|ext| ext.to_str()) == Some("md"))
                            .collect();
                        md_files.sort();
                        if let Some(latest) = md_files.last() {
                            if let Ok(content) = std::fs::read_to_string(latest) {
                                if crate::agents::truncation::check_markdown_truncation(&content)
                                    .is_some()
                                {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    false
}

/// What a hook run needs from a job, or `None` when the job's project is unknown or configures no
/// hooks — the common case, which is why it is the first thing checked.
fn hook_context(
    tendril_home: &Path,
    settings: &TendrilSettings,
    job: &JobItem,
    job_status: JobStatus,
    phase: HookPhase,
) -> Option<HookRunContext> {
    let project = find_project(settings, &job.project)?;
    if project.hooks.is_empty() {
        return None;
    }

    Some(HookRunContext {
        tendril_home: tendril_home.to_path_buf(),
        config_path: crate::config::get_config_path(tendril_home),
        project: project.clone(),
        job_id: job.id.clone(),
        job_type: job.job_type.clone(),
        job_status,
        // A `CreatePlan` job has no plan folder until it has written one, so a `before` hook is told
        // there is none rather than pointed at a path that does not exist yet. Its `after` hook gets
        // the folder the run produced, which is the whole reason such a hook would be configured.
        plan_folder: if phase == HookPhase::Before && job.job_type == "CreatePlan" {
            String::new()
        } else {
            job.plan_file.clone()
        },
    })
}

/// Writes a job's terminal state and moves its plan, claiming completion first so a simultaneous
/// cancellation cannot be overwritten.
///
/// A job that exited zero is only recorded `Completed` once [`verify_deliverable`] confirms it
/// produced something: no commits, an unsettled verification row or a missing plan revision all land
/// on `Failed` instead, with the worktree left in place for a human to look at.
///
/// `plans_dir` is a parameter rather than an ambient lookup on purpose — this function deletes orphan
/// plan folders, and `TENDRIL_PLANS` in the environment would otherwise aim that at the operator's
/// real plans directory during a test run.
///
/// Returns the job as it was persisted, carrying the *effective* status — which is not always the
/// `final_status` that was asked for. `None` means the completion claim had already been taken, so
/// this call wrote nothing at all.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub async fn finish_job(
    tendril_home: &Path,
    plans_dir: &Path,
    jobs_map: &Arc<RwLock<HashMap<String, JobItem>>>,
    handles: &Arc<RwLock<HashMap<String, JobHandle>>>,
    completion_claimed: &AtomicBool,
    mut job: JobItem,
    final_status: JobStatus,
    msg: String,
    duration_seconds: Option<i64>,
    events: Option<&broadcast::Sender<JobEvent>>,
) -> Option<JobItem> {
    if !claim(completion_claimed) {
        // Cancellation got there first and has already written the terminal state.
        return None;
    }

    // Read the output once. Denials, the abandoned-task guard, deliverable verification and failure
    // analysis all read the same stream, and it can be tens of megabytes.
    let mut output_lines = Vec::new();
    if let Ok(Some(raw_lines)) = read_raw_log(tendril_home, &job.id, None) {
        output_lines.extend(raw_lines);
    }
    if let Ok(Some(ev_lines)) = read_eventwire_log(tendril_home, &job.id, None) {
        output_lines.extend(ev_lines);
    }

    // Denials explain a job that failed or did nothing; they never fail one by themselves.
    let denials = extract_permission_denials(&output_lines);
    if !denials.is_empty() {
        job.permission_denials = Some(describe_denials(&denials));
    }

    let (mut effective_status, mut effective_msg) = if final_status == JobStatus::Completed {
        let abandoned = find_abandoned_background_tasks(&output_lines);

        if let Some(reason) = &job.reported_failure_reason {
            (JobStatus::Failed, reason.clone())
        } else if check_job_truncation(tendril_home, &job) {
            (
                JobStatus::Failed,
                "Agent output truncated at maximum token limit or ended prematurely".to_string(),
            )
        } else if !abandoned.is_empty() {
            let reason = format!(
                "Background task(s) still running when the turn ended ({}).",
                abandoned.join(", ")
            );
            job.reported_failure_reason = Some(reason.clone());
            (JobStatus::Failed, reason)
        } else {
            (final_status, msg)
        }
    } else {
        let failure_msg = match &job.reported_failure_reason {
            Some(reason) if final_status == JobStatus::Failed => reason.clone(),
            _ => enrich_failure_message(&output_lines, &job, final_status, msg),
        };
        (final_status, failure_msg)
    };

    // The deliverable check: the job says it succeeded, so ask what it produced.
    let mut deliverable = Deliverable::Present;
    if effective_status == JobStatus::Completed {
        deliverable = verify_deliverable(plans_dir, &mut job, &output_lines);

        if let Deliverable::Missing { reason, cleanup } = &deliverable {
            tracing::warn!(
                "Job {} ({}) exited successfully but produced no deliverable: {}",
                job.id,
                job.job_type,
                reason
            );
            effective_status = JobStatus::Failed;
            effective_msg = reason.clone();
            if job.reported_failure_reason.is_none() {
                job.reported_failure_reason = Some(reason.clone());
            }
            if let Cleanup::OrphanPlan(folder) = cleanup {
                cleanup_plan_folder_and_database(tendril_home, plans_dir, folder);
            }
        }
    } else if job.job_type == "CreatePlan" {
        // A CreatePlan that failed, timed out or was killed must not leave an empty folder behind
        // either — it would look like a real plan nobody ever wrote.
        cleanup_empty_create_plan(tendril_home, plans_dir, &mut job, &output_lines);
    }

    let deliverable_present = matches!(deliverable, Deliverable::Present);

    if !denials.is_empty() {
        // Appended to the existing status message so the Jobs UI shows it with no frontend change.
        effective_msg = format!("{} — {}", effective_msg, summarize_denials(&denials));
    }

    // `verify_deliverable` has just written the plan a `CreatePlan` produced onto `job.plan_file`, so
    // this is the last moment the project can be learned and the only one that catches a job whose
    // promptware never reported a plan id. Guarded, so a job that already knows its project keeps it.
    if is_auto_project(&job.project) && !job.plan_file.trim().is_empty() {
        if let Ok((plan, _)) = read_plan_yaml(Path::new(&job.plan_file)) {
            if !is_auto_project(&plan.project) {
                job.project = plan.project;
            }
        }
    }

    job.status = effective_status;
    job.completed_at = Some(Utc::now());
    job.duration_seconds = duration_seconds;
    job.status_message = Some(effective_msg);

    if effective_status == JobStatus::Completed {
        let plan_folder = PathBuf::from(&job.plan_file);
        if plan_folder.is_dir() {
            if let Ok((plan, _)) = read_plan_yaml(&plan_folder) {
                if let Some(state) = plan_state_on_success(&job.job_type, &plan, &plan_folder) {
                    apply_plan_state(&plan_folder, state);
                }

                if job.job_type == "CreatePr" {
                    let folder_name = plan_folder
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default();
                    let plan_id: i32 = folder_name
                        .split('-')
                        .next()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0);
                    let pr_url = plan.prs.last().map(|s| s.as_str()).unwrap_or("");
                    let msg = format!(
                        "[System Event] Pull request for plan '{}' (#{id:05}) has been created: {pr_url}. Please review the pull request and next steps.",
                        plan.title,
                        id = plan_id
                    );
                    let _ = crate::chat::storage::broadcast_system_message_to_plan_sessions(
                        tendril_home,
                        folder_name,
                        plan.chat_session_id.as_deref(),
                        None,
                        &msg,
                    );
                }
            }
        }

        // Uploads live in a session temp directory until the plan they belong to exists.
        if matches!(job.job_type.as_str(), "CreatePlan" | "UpdatePlan") {
            move_attachments_to_plan_folder(tendril_home, plans_dir, &job);
        }

        // A `CreatePlan` had no plan to inherit a conversation from when it started, so the link is
        // made in this direction instead: the plan it just produced takes on the chat that asked for
        // it. That is what later plan events — a pull request, an edit — resolve their recipients by,
        // so without this only *this* job's completion would ever reach the conversation.
        if let Some(chat_session_id) = job.chat_session_id.as_deref() {
            adopt_plan_into_chat_session(plans_dir, &job, chat_session_id);
        }
    } else if matches!(deliverable, Deliverable::Missing { .. })
        && matches!(job.job_type.as_str(), "ExecutePlan" | "RetryPlan")
    {
        // An execution that produced nothing goes to `Failed`, not back to `Draft`: the worktree is
        // still on disk, and reverting would erase the only sign that an attempt happened.
        apply_plan_state(Path::new(&job.plan_file), PlanStatus::Failed);
    } else {
        revert_plan_state(&job);
    }

    // Whatever the branches above decided, the plan's state on disk is now its final one for this
    // job. Mirroring it here rather than inside `apply_plan_state` is deliberate: a job holds a
    // plan's state for its whole run, so the two moments the mirror can be wrong are the transition
    // into the run (`JobManager::set_plan_state`) and this one out of it — and one sync per job beats
    // one per write from a function that is also called by the CLI, where there is nothing to serve.
    sync_plan_state_to_db(tendril_home, Path::new(&job.plan_file));

    extract_and_record_usage(tendril_home, &mut job);

    track_job_completion(tendril_home, &job, deliverable_present);

    // Emits `job.status_changed` plus `job.completed`/`job.failed`, so a client hears the outcome
    // rather than waiting for its next poll.
    persist(tendril_home, jobs_map, &job, events).await;
    handles.write().await.remove(&job.id);

    // Written last, so the record carries the final status, usage and plan outcome. Never fails a job.
    write_job_outcome_log(tendril_home, &job);

    Some(job)
}

/// Emits the completion events for a finished job: `job_completed` always, plus `plan_created` or
/// `pr_created` for the job type that produced one.
///
/// Returns immediately in a process with no client installed, which is every CLI invocation — and in
/// particular does no config I/O there, since `plan_created` is the only event needing the project's
/// stack hash and it would otherwise read `config.yaml` on every job completion.
fn track_job_completion(tendril_home: &Path, job: &JobItem, deliverable_present: bool) {
    use crate::telemetry::{JobCompletedContext, PlanCreatedContext, PrCreatedContext};

    let Some(telemetry) = crate::telemetry::tracker() else {
        return;
    };

    let plan_id = telemetry_plan_id(job);
    let agent = non_empty(&job.provider);

    telemetry.track_job_completed(&JobCompletedContext {
        job_type: job.job_type.clone(),
        status: job.status.as_str().to_string(),
        duration_seconds: job.duration_seconds,
        agent: agent.clone(),
        plan_id: plan_id.clone(),
    });

    if job.status != JobStatus::Completed {
        return;
    }

    match job.job_type.as_str() {
        // A CreatePlan that produced no revision is not a plan; `verify_deliverable` has already
        // demoted it to `Failed`, and the `deliverable_present` check keeps the event honest if that
        // ever stops being true.
        "CreatePlan" if deliverable_present => {
            let plan_folder = PathBuf::from(&job.plan_file);
            let Ok((plan, _)) = read_plan_yaml(&plan_folder) else {
                return;
            };
            telemetry.track_plan_created(&PlanCreatedContext {
                level: plan.level.clone(),
                duration_seconds: job.duration_seconds,
                agent,
                stack_hash: project_stack_hash(tendril_home, &plan.project),
                plan_id,
            });
        }
        "CreatePr" => telemetry.track_pr_created(&PrCreatedContext {
            duration_seconds: job.duration_seconds,
            agent,
            plan_id,
        }),
        _ => {}
    }
}

/// A project's stack descriptor hash, or `None` for one that has not been analyzed. Carries no names,
/// paths or free text by construction — see `docs/TELEMETRY.md`.
fn project_stack_hash(tendril_home: &Path, project_name: &str) -> Option<String> {
    let config_path = crate::config::get_config_path(tendril_home);
    let settings = crate::config::load_config(&config_path).ok()?;
    settings
        .projects
        .iter()
        .find(|p| p.name == project_name)
        .and_then(|p| p.stack_hash.clone())
}

/// Replaces a bare `Process exited with code 1` with what the output actually says went wrong.
///
/// Only for `Failed`: a timeout and a cancellation already carry the whole story. Leaves the original
/// message in place as context, and says nothing when the analysis has nothing to add.
fn enrich_failure_message(
    output_lines: &[String],
    job: &JobItem,
    final_status: JobStatus,
    msg: String,
) -> String {
    if final_status != JobStatus::Failed || output_lines.is_empty() {
        return msg;
    }

    let reason = extract_failure_reason(output_lines, &job.job_type, None);
    if reason.is_empty() || reason == "Unknown error (exit code non-zero)" || msg.contains(&reason)
    {
        return msg;
    }
    format!("{} — {}", msg, reason)
}

/// Removes the folder a CreatePlan run left behind with no revision in it.
fn cleanup_empty_create_plan(
    tendril_home: &Path,
    plans_dir: &Path,
    job: &mut JobItem,
    output_lines: &[String],
) {
    let Some(folder) = resolve_created_plan_folder(plans_dir, job, output_lines) else {
        return;
    };
    if revision_count(&folder) > 0 {
        return;
    }
    if cleanup_plan_folder_and_database(tendril_home, plans_dir, &folder) {
        // Nothing to link to any more.
        job.plan_file = String::new();
    }
}

/// Writes a job to the in-memory map and SQLite, and announces the transition.
///
/// Every status a job reaches after it is created is written through here, which is why the event is
/// published here too: an emission bolted onto individual call sites is one `return` away from a
/// status that reaches the database and nothing else. `events` is `None` for a caller that has no
/// manager to publish through — the free-function test entry points, and nothing in production.
async fn persist(
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
