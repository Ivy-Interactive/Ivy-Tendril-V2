use crate::agents::providers::{build_agent_spec, AgentLaunchConfig, AgentProcessSpec};
use crate::agents::runner::{run_agent_process_with_grace, AgentRunOutcome, TerminationReason};
use crate::config::{get_plans_dir_with_settings, TendrilSettings};
use crate::db::jobs::{
    get_job, insert_job, insert_new_job, list_jobs, list_non_terminal_jobs, max_numeric_job_id,
};
use crate::db::open_database;
use crate::error::{Result, TendrilError};
use crate::jobs::attachments::move_attachments_to_plan_folder;
use crate::jobs::deliverable::{
    cleanup_plan_folder_and_database, resolve_created_plan_folder, revision_count,
    verify_deliverable, Cleanup, Deliverable,
};
use crate::jobs::denials::{describe_denials, extract_permission_denials, summarize_denials};
use crate::jobs::dependents::release_dependents;
use crate::jobs::failure_analysis::extract_failure_reason;
use crate::jobs::firmware_values::{
    build_firmware_values, execution_profile_override, resolve_project, resolve_working_directory,
};
use crate::jobs::logger::{
    append_agent_log, append_to_eventwire, append_to_raw_log, find_log_file, read_eventwire_log,
    read_raw_log, write_prompt,
};
use crate::jobs::outcome::write_job_outcome_log;
use crate::jobs::process_tree::{kill_tree, DEFAULT_KILL_GRACE};
use crate::models::{JobArgs, JobItem, JobStatus, PlanStatus, PlanYaml};
use crate::plans::dependencies::check_dependencies;
use crate::plans::guards::PlanCompletionGuard;
use crate::plans::reader::read_plan_yaml;
use crate::plans::verification_gate::resolve_post_execution_state;
use crate::plans::writer::write_plan_yaml;
use crate::promptware::compiler::compile_firmware;
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;
use tokio::sync::{watch, Mutex, RwLock, Semaphore};

/// Builds the process spec for an agent launch. Injectable so tests can exercise the whole launch
/// path against a throwaway script instead of a real agent CLI.
pub type SpecBuilder = Arc<dyn Fn(&str, &AgentLaunchConfig) -> AgentProcessSpec + Send + Sync>;

/// Live control surface for a running job.
pub struct JobHandle {
    pub cancel_tx: watch::Sender<bool>,
    /// 0 until the agent process is spawned.
    pub pid: Arc<AtomicU32>,
    /// Claimed exactly once, by whichever of cancellation and normal completion gets there first.
    pub completion_claimed: Arc<AtomicBool>,
}

impl JobHandle {
    pub fn new() -> Self {
        let (cancel_tx, _) = watch::channel(false);
        Self {
            cancel_tx,
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

pub struct JobManager {
    tendril_home: PathBuf,
    settings: Arc<RwLock<TendrilSettings>>,
    jobs: Arc<RwLock<HashMap<String, JobItem>>>,
    handles: Arc<RwLock<HashMap<String, JobHandle>>>,
    semaphore: Arc<Semaphore>,
    /// Serialises ID allocation with the first insert, so two concurrent `start_job` calls cannot
    /// allocate the same ID.
    alloc_lock: Arc<Mutex<()>>,
    spec_builder: SpecBuilder,
    /// Overrides the `jobTimeout` setting. Only used by tests, which need sub-minute timeouts.
    job_timeout_override: Option<Duration>,
    /// Overrides the post-result grace period. Only used by tests.
    post_result_grace_override: Option<Duration>,
    /// A handle back to this manager, so a finished job can start the jobs that were waiting on it.
    /// Empty unless the manager was published with [`JobManager::share`]; empty simply means no
    /// restarts happen, which is what a manager nobody can reach should do.
    self_handle: OnceLock<Weak<JobManager>>,
}

impl JobManager {
    pub fn new(tendril_home: PathBuf, settings: TendrilSettings) -> Self {
        let max_jobs = settings.max_concurrent_jobs.max(1) as usize;
        Self {
            tendril_home,
            settings: Arc::new(RwLock::new(settings)),
            jobs: Arc::new(RwLock::new(HashMap::new())),
            handles: Arc::new(RwLock::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(max_jobs)),
            alloc_lock: Arc::new(Mutex::new(())),
            spec_builder: Arc::new(build_agent_spec),
            job_timeout_override: None,
            post_result_grace_override: None,
            self_handle: OnceLock::new(),
        }
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

    pub async fn allocate_job_id(&self) -> Result<String> {
        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        let max_id = max_numeric_job_id(&conn)?;
        Ok(format!("{:05}", max_id + 1))
    }

    pub async fn start_job(&self, args: JobArgs) -> Result<String> {
        let job_type = args.job_type().to_string();
        let plan_folder_str = args.plan_folder().unwrap_or("").to_string();
        let plan_folder = PathBuf::from(&plan_folder_str);

        let settings = self.settings.read().await.clone();

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
                    .unwrap_or_else(|| {
                        get_plans_dir_with_settings(&self.tendril_home, Some(&settings))
                    });
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

        if let Some(reason) = &block_reason {
            job.status = JobStatus::Blocked;
            job.status_message = Some(reason.clone());
            job.completed_at = Some(Utc::now());
        } else {
            job.status = JobStatus::Queued;
        }

        // Move the plan to its in-flight (or Blocked) state.
        let target_plan_state = if block_reason.is_some() {
            Some(PlanStatus::Blocked)
        } else {
            in_flight_plan_state(&job_type)
        };
        if let Some(state) = target_plan_state {
            self.set_plan_state(&plan_folder, state);
        }

        // Allocate the ID and insert the row under one lock, so a concurrent start cannot reuse it.
        let job_id = {
            let _guard = self.alloc_lock.lock().await;
            let job_id = self.allocate_job_id().await?;
            job.id = job_id.clone();

            let db_path = crate::config::get_database_path(&self.tendril_home);
            let conn = open_database(&db_path)?;
            insert_new_job(&conn, &job).map_err(|e| {
                TendrilError::Other(format!("Failed to persist job {}: {}", job_id, e))
            })?;

            self.jobs.write().await.insert(job_id.clone(), job.clone());
            job_id
        };

        if block_reason.is_some() {
            return Ok(job_id);
        }

        let (cancel_tx, cancel_rx) = watch::channel(false);
        let pid = Arc::new(AtomicU32::new(0));
        let completion_claimed = Arc::new(AtomicBool::new(false));
        self.handles.write().await.insert(
            job_id.clone(),
            JobHandle {
                cancel_tx,
                pid: pid.clone(),
                completion_claimed: completion_claimed.clone(),
            },
        );

        self.spawn_runner(job, cancel_rx, pid, completion_claimed, settings);

        Ok(job_id)
    }

    #[allow(clippy::too_many_lines)]
    fn spawn_runner(
        &self,
        mut job: JobItem,
        cancel_rx: watch::Receiver<bool>,
        pid: Arc<AtomicU32>,
        completion_claimed: Arc<AtomicBool>,
        settings: TendrilSettings,
    ) {
        let tendril_home = self.tendril_home.clone();
        // Resolved once, here, and passed down: `finish_job` deletes orphan plan folders, and an
        // ambient `TENDRIL_PLANS` lookup inside it would point a test at the real plans directory.
        let plans_dir = get_plans_dir_with_settings(&self.tendril_home, Some(&settings));
        let jobs_map = self.jobs.clone();
        let handles = self.handles.clone();
        let sem = self.semaphore.clone();
        let spec_builder = self.spec_builder.clone();
        let self_handle = self.self_handle.get().cloned();
        let timeout = self
            .job_timeout_override
            .or_else(|| job_timeout_duration(&settings));
        let post_result_grace = self
            .post_result_grace_override
            .unwrap_or(crate::agents::runner::DEFAULT_POST_RESULT_GRACE);

        tokio::spawn(async move {
            let job_id = job.id.clone();
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => return,
            };

            // A job cancelled while it was still queued never had a process; cancel_job has already
            // written its terminal state, so there is nothing left to do.
            if *cancel_rx.borrow() {
                return;
            }

            job.status = JobStatus::Running;
            persist(&tendril_home, &jobs_map, &job).await;

            let promptware_folder = tendril_home.join("Promptwares").join(&job.job_type);
            if !promptware_folder.is_dir() {
                let msg = format!(
                    "Promptware folder not found: {}",
                    promptware_folder.display()
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
                )
                .await;
                return;
            }

            let values = build_firmware_values(&job, &tendril_home, &settings);
            let compiled_prompt = match compile_firmware(&promptware_folder, &values) {
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
                    )
                    .await;
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

            let launch_config = AgentLaunchConfig {
                prompt: compiled_prompt,
                working_directory: working_dir.clone(),
                model: job.model.clone(),
                effort: job.effort.clone(),
                ..Default::default()
            };

            let spec = (spec_builder)(&job.provider, &launch_config);
            job.working_directory = Some(working_dir.to_string_lossy().to_string());
            job.cli_command = Some(format!("{} {}", spec.command, spec.args.join(" ")));

            let start_time = std::time::Instant::now();
            let th = tendril_home.clone();
            let jid = job_id.clone();
            let pid_slot = pid.clone();
            let jobs_for_pid = jobs_map.clone();
            let home_for_pid = tendril_home.clone();
            let job_for_pid = job.clone();

            let run_res = run_agent_process_with_grace(
                spec,
                move |evt| {
                    let _ = append_to_raw_log(&th, &jid, &evt.raw_line);
                    let _ = append_to_eventwire(&th, &jid, &evt.raw_line);
                },
                move |spawned_pid| {
                    pid_slot.store(spawned_pid, Ordering::SeqCst);
                    // Persist the PID immediately: startup reconciliation uses it to tell a
                    // detached agent from an interrupted one.
                    let mut with_pid = job_for_pid;
                    with_pid.process_id = Some(spawned_pid);
                    tokio::spawn(async move {
                        persist(&home_for_pid, &jobs_for_pid, &with_pid).await;
                    });
                },
                cancel_rx,
                timeout,
                post_result_grace,
            )
            .await;

            job.process_id = Some(pid.load(Ordering::SeqCst)).filter(|p| *p != 0);
            let duration = start_time.elapsed().as_secs() as i64;
            let (final_status, msg) = classify_outcome(run_res, timeout);

            let finished = job.clone();
            finish_job(
                &tendril_home,
                &plans_dir,
                &jobs_map,
                &handles,
                &completion_claimed,
                job,
                final_status,
                msg,
                Some(duration),
            )
            .await;

            // Anything that was waiting on this job is re-gated now the terminal state is written.
            // A manager that was never published as an `Arc` yields `None` and simply restarts
            // nothing.
            let manager = self_handle.as_ref().and_then(Weak::upgrade);
            release_dependents(
                &tendril_home,
                &plans_dir,
                &jobs_map,
                manager.as_ref(),
                &finished,
            )
            .await;
        });
    }

    fn set_plan_state(&self, plan_folder: &Path, state: PlanStatus) {
        apply_plan_state(plan_folder, state);
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
        }
        if let Some(title) = plan_title {
            job.reported_plan_title = Some(title.to_string());
        }

        persist(&self.tendril_home, &self.jobs, &job).await;
        Ok(true)
    }

    pub async fn report_job_failure(&self, id: &str, message: &str) -> Result<bool> {
        let Some(mut job) = self.get_job(id).await? else {
            return Ok(false);
        };

        job.status = JobStatus::Failed;
        job.reported_failure_reason = Some(message.to_string());
        job.completed_at = Some(Utc::now());

        persist(&self.tendril_home, &self.jobs, &job).await;
        Ok(true)
    }

    /// Stops a job and everything it spawned.
    ///
    /// The cancel flag is raised before the completion claim, so an agent exiting at this exact
    /// instant still sees it and cannot flip the plan to `Review` behind the cancellation. Returns
    /// `false` when the job does not exist or had already finished.
    pub async fn cancel_job(&self, id: &str, message: Option<&str>) -> Result<bool> {
        let handle_state = {
            let handles = self.handles.read().await;
            handles.get(id).map(|h| {
                let _ = h.cancel_tx.send(true);
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
        persist(&self.tendril_home, &self.jobs, &job).await;
        self.handles.write().await.remove(id);

        Ok(true)
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
        "ExecutePlan" | "RetryPlan" => Some(resolve_post_execution_state(plan, plan_folder)),
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

    // Terminal plans (Completed or Skipped) are immutable
    if matches!(current, Some(PlanStatus::Completed | PlanStatus::Skipped)) {
        tracing::info!(
            "Job {}: Not reverting plan {} because it is already {:?}",
            job.id,
            plan_id,
            current.unwrap()
        );
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

    if let Some(current) = PlanStatus::from_str_loose(&plan.state) {
        // Terminal plans (Completed or Skipped) are immutable
        if matches!(current, PlanStatus::Completed | PlanStatus::Skipped)
            && !matches!(state, PlanStatus::Completed | PlanStatus::Skipped)
        {
            tracing::info!(
                "Not setting plan {} to {:?} because it is already {:?}",
                plan_id,
                state,
                current
            );
            return;
        }
    }

    match PlanCompletionGuard::apply_state(&mut plan, state, false, plan_id) {
        Ok(warning) => {
            if let Some(w) = warning {
                tracing::warn!("{}", w);
            }
            plan.updated = Utc::now();
            if let Err(e) = write_plan_yaml(plan_folder, &plan) {
                tracing::warn!("Failed to write plan state for {}: {}", plan_id, e);
            }
        }
        Err(e) => tracing::warn!("Plan {} state transition refused: {}", plan_id, e),
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

fn classify_outcome(
    run_res: Result<AgentRunOutcome>,
    timeout: Option<Duration>,
) -> (JobStatus, String) {
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

                                let cache_read_tok = usage
                                    .get("cache_read_tokens")
                                    .or_else(|| usage.get("cacheReadTokens"))
                                    .or_else(|| usage.get("cached_input_tokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                let cache_write_tok = usage
                                    .get("cache_write_tokens")
                                    .or_else(|| usage.get("cacheWriteTokens"))
                                    .or_else(|| usage.get("cache_write_input_tokens"))
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

                                let provider_cost = usage
                                    .get("cost")
                                    .or_else(|| v.get("cost"))
                                    .or_else(|| v.get("total_cost"))
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

    let tokens = job.tokens.unwrap_or(0);
    let cost = job.cost.unwrap_or(0.0);

    if job.tokens.is_some() || job.cost.is_some() {
        if let Some(pid) = resolve_numerical_plan_id(job) {
            let db_path = crate::config::get_database_path(tendril_home);
            if let Ok(conn) = open_database(&db_path) {
                let plan_exists: bool = conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM Plans WHERE Id = ?1)",
                        rusqlite::params![pid],
                        |row| row.get(0),
                    )
                    .unwrap_or(false);

                if plan_exists {
                    let log_timestamp = extracted_timestamp
                        .or_else(|| job.completed_at.map(|dt| dt.to_rfc3339()))
                        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

                    if let Err(e) = crate::db::costs::insert_cost(
                        &conn,
                        pid,
                        &job.job_type,
                        tokens,
                        cost,
                        Some(&log_timestamp),
                    ) {
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
) {
    if !claim(completion_claimed) {
        // Cancellation got there first and has already written the terminal state.
        return;
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

    if !denials.is_empty() {
        // Appended to the existing status message so the Jobs UI shows it with no frontend change.
        effective_msg = format!("{} — {}", effective_msg, summarize_denials(&denials));
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
    } else if matches!(deliverable, Deliverable::Missing { .. })
        && matches!(job.job_type.as_str(), "ExecutePlan" | "RetryPlan")
    {
        // An execution that produced nothing goes to `Failed`, not back to `Draft`: the worktree is
        // still on disk, and reverting would erase the only sign that an attempt happened.
        apply_plan_state(Path::new(&job.plan_file), PlanStatus::Failed);
    } else {
        revert_plan_state(&job);
    }

    extract_and_record_usage(tendril_home, &mut job);

    persist(tendril_home, jobs_map, &job).await;
    handles.write().await.remove(&job.id);

    // Written last, so the record carries the final status, usage and plan outcome. Never fails a job.
    write_job_outcome_log(tendril_home, &job);
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

/// Writes a job to the in-memory map and SQLite.
async fn persist(
    tendril_home: &Path,
    jobs_map: &Arc<RwLock<HashMap<String, JobItem>>>,
    job: &JobItem,
) {
    jobs_map.write().await.insert(job.id.clone(), job.clone());

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
