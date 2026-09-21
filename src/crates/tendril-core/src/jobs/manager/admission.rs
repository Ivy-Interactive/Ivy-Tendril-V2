//! Starting a job: the gates it must pass and the row it leaves behind.
//!
//! [`JobManager::start_job_with`] is the only way a job comes into existence. It runs the
//! idempotency-key lookup, the conflict check, the duplicate-work check, the plan dependency gate
//! and the wait-for-jobs gate, then allocates an id and inserts the job — the first four under the
//! `start_lock`, so check-then-insert is indivisible. The priority and chat-session resolvers live
//! here because nothing else calls them.

use super::conflicts::{conflict_group, duplicate_or_other, normalize_plan_folder};
use super::internals::{JobManager, WaitOutcome};
use super::plan_state::{in_flight_plan_state, read_plan_state};
use super::usage::{non_empty, telemetry_plan_id};
use super::waiting::wait_for_jobs_block;
use crate::db::jobs::{
    find_inflight_job_by_dedupe_key, find_job_by_idempotency_key, insert_new_job,
};
use crate::db::open_database;
use crate::error::{Result, TendrilError};
use crate::jobs::firmware_values::resolve_project;
use crate::models::{JobArgs, JobItem, JobStatus, PlanStatus};
use crate::plans::dependencies::check_dependencies;
use crate::plans::helpers::resolve_plan_folder;
use crate::plans::reader::read_plan_yaml;
use crate::telemetry::Track;
use chrono::Utc;
use std::path::{Path, PathBuf};

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

impl JobManager {
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

/// The conversation a plan already belongs to, used to link a job that names the plan but was started
/// without a `--chat-session` of its own. Empty for a job with no plan — a `CreatePlan` has none yet,
/// which is why [`finish_job`](super::completion::finish_job) stamps the link the other way round once the plan exists.
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
