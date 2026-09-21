//! The job engine: everything between "start this" and "it is done".
//!
//! One module per lifecycle stage, in the order a job passes through them — `admission` decides
//! whether a job may exist at all, `dispatch` gets it a slot, `runner` runs it, `progress`
//! keeps it honest while it does, and `completion` writes down what happened. `conflicts` and
//! `waiting` hold the two gates admission and maintenance both consult; `termination` is the
//! other way out; `supervision` and `maintenance` are the recovery paths for jobs no live task
//! is watching any more. `plan_state`, `usage` and `worktrees` are the things a job does to
//! the world around it, and `internals` and `events` are the state and the single status write
//! every stage shares.
//!
//! Every public item is re-exported here, so `jobs::manager::*` is the same surface it has always
//! been.

mod admission;
mod completion;
mod conflicts;
mod dispatch;
mod events;
mod internals;
mod maintenance;
mod plan_state;
mod progress;
mod runner;
mod supervision;
mod termination;
mod usage;
mod waiting;
mod worktrees;

pub use admission::StartOptions;
pub use completion::{find_abandoned_background_tasks, finish_job};
pub use conflicts::conflict_group;
pub use events::{JobEvent, JOB_EVENT_COMPLETED, JOB_EVENT_FAILED, JOB_EVENT_STATUS_CHANGED};
pub use internals::{JobHandle, JobManager, SpecBuilder};
pub use maintenance::{stale_eviction_candidates, MaintenanceReport};
pub use plan_state::{
    apply_plan_state, fallback_previous_state, in_flight_plan_state, plan_state_on_success,
    revert_plan_state, revert_target, sync_plan_state_to_db,
};
pub use supervision::{stuck_job_reason, STUCK_JOB_HARD_CAP_MARGIN, STUCK_JOB_REAP_GRACE};
pub use termination::CLEARABLE_STATUSES;
pub use usage::extract_and_record_usage;
pub use waiting::describe_wait_dependency;
pub use worktrees::prepare_plan_worktrees;
