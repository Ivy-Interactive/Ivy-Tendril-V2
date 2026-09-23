//! The operator's **Rerun**: V1's `RerunJobDialog` (`Apps/Jobs/Dialogs/RerunJobDialog.cs`).
//!
//! V1 deletes the job and starts a new one from its original `TypedArgs`, folding the operator's
//! optional feedback into them. The client cannot do that on its own - the job list's DTO carries
//! the args only as a JSON string, and turning a `CreatePlan` into an `ExecutePlan` needs the plan
//! folder resolved against the plans directory - so it lives here, next to the two calls it is made
//! of, and the route is one request.

use super::internals::{is_terminal, JobManager};
use super::StartOptions;
use crate::error::{Result, TendrilError};
use crate::models::{JobArgs, JobItem, JobStatus, RetryPlanArgs};
use crate::plans::helpers::resolve_plan_folder;
use crate::plans::orphans::find_plan_folder_created_by_job;
use std::path::Path;

/// `RerunJobDialog.SupportsFeedback(JobArgsBase)`: the arg types feedback can be folded into.
pub fn supports_feedback(args: &JobArgs) -> bool {
    matches!(
        args,
        JobArgs::ExecutePlan(_) | JobArgs::RetryPlan(_) | JobArgs::UpdatePlan(_)
    )
}

/// `JobsApp.CanRerun` (`JobsApp.Helpers.cs:235`): every failure state, and a Completed job only when
/// its args take feedback - rerunning a finished `CreatePr` unchanged would just open the PR again.
pub fn can_rerun(status: JobStatus, args: Option<&JobArgs>) -> bool {
    match status {
        JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped => true,
        JobStatus::Completed => args.is_some_and(supports_feedback),
        _ => false,
    }
}

/// `RerunJobDialog.BuildRerunArgs`, over args that are already known to exist.
///
/// - A `CreatePlan` whose plan now exists is not created again: it becomes an `ExecutePlan` of that
///   plan, or a `RetryPlan` carrying the feedback.
/// - Feedback on an `ExecutePlan` or a `RetryPlan` becomes the `RetryPlan`'s change request; on an
///   `UpdatePlan` it replaces the instructions.
/// - Anything else, and anything with no feedback, reruns exactly as it was submitted.
pub fn build_rerun_args(
    original: &JobArgs,
    feedback: Option<&str>,
    plan_folder: Option<&str>,
) -> JobArgs {
    let feedback = feedback.map(str::trim).filter(|f| !f.is_empty());

    if let (JobArgs::CreatePlan(_), Some(folder)) = (original, plan_folder) {
        if !folder.is_empty() {
            return match feedback {
                Some(text) => JobArgs::RetryPlan(RetryPlanArgs {
                    folder_path: folder.to_string(),
                    change_request: text.to_string(),
                }),
                None => JobArgs::ExecutePlan(crate::models::ExecutePlanArgs {
                    folder_path: folder.to_string(),
                    note: None,
                }),
            };
        }
    }

    let Some(text) = feedback else {
        return original.clone();
    };

    match original {
        JobArgs::ExecutePlan(e) => JobArgs::RetryPlan(RetryPlanArgs {
            folder_path: e.folder_path.clone(),
            change_request: text.to_string(),
        }),
        JobArgs::RetryPlan(r) => JobArgs::RetryPlan(RetryPlanArgs {
            folder_path: r.folder_path.clone(),
            change_request: text.to_string(),
        }),
        JobArgs::UpdatePlan(u) => {
            let mut updated = u.clone();
            updated.instructions = Some(text.to_string());
            JobArgs::UpdatePlan(updated)
        }
        other => other.clone(),
    }
}

/// `RerunJobDialog.ResolvePlanFolder` for a `CreatePlan`: the plan the job reported, or failing that
/// the one whose `plan.yaml` records this job as its creator. `None` while no plan exists, which is
/// what makes an early-failed `CreatePlan` rerun as a `CreatePlan`.
fn created_plan_folder(job: &JobItem, plans_dir: &Path) -> Option<String> {
    job.reported_plan_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| resolve_plan_folder(id, plans_dir).ok())
        .or_else(|| find_plan_folder_created_by_job(plans_dir, &job.id))
        .map(|folder| folder.to_string_lossy().to_string())
}

impl JobManager {
    /// Deletes a finished job and starts it again from its original args, with the operator's
    /// feedback folded in. Answers the new job's id.
    ///
    /// Delete first, as V1 does: deleting reverts the plan to the state it had before the job, and
    /// doing that *after* the new job had moved it would undo the new job's own transition.
    pub async fn rerun_job(&self, id: &str, feedback: Option<&str>) -> Result<String> {
        let Some(job) = self.get_job(id).await? else {
            return Err(TendrilError::JobNotFound(id.to_string()));
        };
        if !is_terminal(job.status) {
            return Err(TendrilError::Conflict(format!(
                "Job {} is {}; only a finished job can be rerun",
                id, job.status
            )));
        }
        let Some(original) = job.typed_args.clone() else {
            return Err(TendrilError::Conflict(
                "Cannot rerun: original args were not preserved.".to_string(),
            ));
        };
        if !can_rerun(job.status, Some(&original)) {
            return Err(TendrilError::Conflict(format!(
                "A {} {} job cannot be rerun",
                job.status, job.job_type
            )));
        }

        let plan_folder = if matches!(original, JobArgs::CreatePlan(_)) {
            let settings = self.settings.read().await.clone();
            created_plan_folder(&job, &self.plans_dir(&settings))
        } else {
            None
        };
        let args = build_rerun_args(&original, feedback, plan_folder.as_deref());

        self.delete_job(id).await?;
        self.start_job_with(
            args,
            StartOptions {
                chat_session_id: job.chat_session_id.clone(),
                ..StartOptions::default()
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreatePlanArgs, ExecutePlanArgs, SplitPlanArgs, UpdatePlanArgs};

    fn create_plan() -> JobArgs {
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "Add a rerun route".into(),
            project: "Tendril".into(),
            priority: 0,
            force: false,
            source_path: None,
            upload_session_id: None,
        })
    }

    #[test]
    fn no_feedback_reruns_the_original_args() {
        let args = JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: "/plans/00042-X".into(),
            note: Some("note".into()),
        });
        let rerun = build_rerun_args(&args, Some("   "), None);
        assert!(matches!(rerun, JobArgs::ExecutePlan(ref e) if e.note.as_deref() == Some("note")));
    }

    #[test]
    fn feedback_on_an_execution_becomes_a_retry() {
        let args = JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: "/plans/00042-X".into(),
            note: None,
        });
        let rerun = build_rerun_args(&args, Some(" use the other API "), None);
        assert!(matches!(rerun, JobArgs::RetryPlan(ref r)
            if r.folder_path == "/plans/00042-X" && r.change_request == "use the other API"));
    }

    #[test]
    fn feedback_on_an_update_replaces_its_instructions() {
        let args = JobArgs::UpdatePlan(UpdatePlanArgs {
            folder_path: "/plans/00042-X".into(),
            instructions: Some("old".into()),
            upload_session_id: None,
        });
        let rerun = build_rerun_args(&args, Some("new"), None);
        assert!(
            matches!(rerun, JobArgs::UpdatePlan(ref u) if u.instructions.as_deref() == Some("new"))
        );
    }

    #[test]
    fn a_create_plan_whose_plan_exists_executes_it() {
        let rerun = build_rerun_args(&create_plan(), None, Some("/plans/00042-X"));
        assert!(matches!(rerun, JobArgs::ExecutePlan(ref e) if e.folder_path == "/plans/00042-X"));
        let rerun = build_rerun_args(&create_plan(), Some("fix it"), Some("/plans/00042-X"));
        assert!(matches!(rerun, JobArgs::RetryPlan(ref r) if r.change_request == "fix it"));
    }

    #[test]
    fn a_create_plan_with_no_plan_is_created_again() {
        let rerun = build_rerun_args(&create_plan(), Some("ignored"), None);
        assert!(matches!(rerun, JobArgs::CreatePlan(_)));
    }

    #[test]
    fn feedback_is_ignored_where_it_has_nowhere_to_go() {
        let args = JobArgs::SplitPlan(SplitPlanArgs {
            folder_path: "/plans/00042-X".into(),
        });
        assert!(matches!(
            build_rerun_args(&args, Some("anything"), None),
            JobArgs::SplitPlan(_)
        ));
    }

    #[test]
    fn completed_jobs_rerun_only_when_they_take_feedback() {
        let execute = JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: "x".into(),
            note: None,
        });
        assert!(can_rerun(JobStatus::Failed, None));
        assert!(can_rerun(JobStatus::Completed, Some(&execute)));
        assert!(!can_rerun(JobStatus::Completed, Some(&create_plan())));
        assert!(!can_rerun(JobStatus::Running, Some(&execute)));
    }
}
