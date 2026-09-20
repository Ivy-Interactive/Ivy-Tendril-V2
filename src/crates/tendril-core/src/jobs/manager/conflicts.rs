//! The "is this already running" question, in both of its forms.
//!
//! [`conflict_group`] is the authoritative answer to which job types may not overlap on one plan;
//! the searches below apply it to SQLite and to the in-memory map. [`duplicate_or_other`] turns the
//! unique-index violation that backstops all of this into the error the caller expects.

use super::internals::JobManager;
use crate::db::jobs::list_non_terminal_jobs_for_plan;
use crate::db::open_database;
use crate::error::{Result, TendrilError};
use crate::models::JobStatus;

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
pub(super) fn normalize_plan_folder(folder: &str) -> String {
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
pub(super) fn duplicate_or_other(
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

impl JobManager {
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
}
