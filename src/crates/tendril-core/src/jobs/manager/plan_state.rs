//! Moving a plan through its states as the jobs that name it run.
//!
//! Each job type claims a plan into an in-flight state on launch and settles it on exit, and every
//! one of those writes goes through [`PlanCompletionGuard`] so the `Completed`-over-`Fail` rule
//! holds no matter which path got here. [`sync_plan_state_to_db`] is the mirror: `plan.yaml` is the
//! record, but the plan list and the Kanban columns read SQLite.

use super::usage::plan_id_from_folder_name;
use crate::db::open_database;
use crate::models::{JobItem, PlanStatus, PlanYaml};
use crate::plans::guards::PlanCompletionGuard;
use crate::plans::reader::read_plan_yaml;
use crate::plans::verification_gate::resolve_post_execution_state;
use crate::plans::writer::write_plan_yaml;
use crate::telemetry::Track;
use chrono::Utc;
use std::path::Path;

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

    // Wireframes are plan material only: a plan whose changes still carry wireframe code may not
    // be marked Completed, however it got here.
    if let Some(reason) = PlanCompletionGuard::wireframe_refusal(state, plan_folder, None) {
        tracing::warn!("Not completing plan {}: {}", plan_id, reason);
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

pub(super) fn read_plan_state(plan_folder: &Path) -> Option<PlanStatus> {
    if plan_folder.as_os_str().is_empty() || !plan_folder.is_dir() {
        return None;
    }
    read_plan_yaml(plan_folder)
        .ok()
        .and_then(|(plan, _)| PlanStatus::from_str_loose(&plan.state))
}
