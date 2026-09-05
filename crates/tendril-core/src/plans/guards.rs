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
