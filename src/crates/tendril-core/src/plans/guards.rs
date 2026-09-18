use crate::error::{Result, TendrilError};
use crate::models::{PlanStatus, PlanYaml, VerificationStatus};

pub struct PlanCompletionGuard;

impl PlanCompletionGuard {
    pub fn failed_verifications(plan: &PlanYaml) -> Vec<String> {
        plan.verifications
            .iter()
            .filter(|v| v.status == VerificationStatus::Fail)
            .map(|v| v.name.clone())
            .collect()
    }

    /// Terminal plans (Completed, Skipped) are immutable. Returns the refusal reason, or None.
    ///
    /// `requested` is the state the caller wants to write, when the caller is a state transition.
    /// A transition into another terminal state is allowed, so a plan can still move between
    /// Completed and Skipped. Callers that mutate something other than the state (an MCP write
    /// tool, a revert with no single target) pass `None`, which refuses on any terminal plan.
    pub fn terminal_refusal(
        current: Option<PlanStatus>,
        requested: Option<PlanStatus>,
    ) -> Option<String> {
        let current = current?;
        if !matches!(current, PlanStatus::Completed | PlanStatus::Skipped) {
            return None;
        }
        if matches!(requested, Some(PlanStatus::Completed | PlanStatus::Skipped)) {
            return None;
        }
        Some(format!(
            "Plan is {} and terminal plans are immutable",
            current
        ))
    }

    /// Refuses `Completed` for a plan whose changes still carry wireframe code.
    ///
    /// Separate from [`Self::apply_state`] because it needs the plan folder on disk, which that
    /// function does not take. Callers that have one should run this first; the execution gate and
    /// the PR launch check cover the other two ways a plan moves on.
    pub fn wireframe_refusal(
        new_state: PlanStatus,
        plan_folder: &std::path::Path,
        project: Option<&crate::models::project::ProjectConfig>,
    ) -> Option<String> {
        if new_state != PlanStatus::Completed {
            return None;
        }
        crate::wireframes::plan_guard::block_reason(plan_folder, project)
    }

    pub fn apply_state(
        plan: &mut PlanYaml,
        new_state: PlanStatus,
        allow_failed_verifications: bool,
        plan_id: &str,
    ) -> Result<Option<String>> {
        let mut warning = None;

        if new_state == PlanStatus::Completed {
            let failed = Self::failed_verifications(plan);
            if !failed.is_empty() {
                if !allow_failed_verifications {
                    return Err(TendrilError::TransitionBlocked(format!(
                        "Plan '{}' cannot be marked Completed because verifications failed: {}",
                        plan_id,
                        failed.join(", ")
                    )));
                }
                plan.partial_delivery = true;
                warning = Some(format!(
                    "Warning: completing over failed verification(s) {}. Marked partialDelivery: true.",
                    failed.join(", ")
                ));
            }
        }

        plan.state = new_state.to_string();
        Ok(warning)
    }
}
