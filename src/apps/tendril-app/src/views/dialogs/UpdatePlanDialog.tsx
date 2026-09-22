import * as React from "react";
import { UpdatePlanDialog as UpdatePlanDialogView } from "@ivy-interactive/components/dialogs";
import { PlanActionsController } from "../../controllers/planActions";
import {
  describeBridgeError,
  type Job,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";

export interface UpdatePlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Called with the started job so the caller can open its session tab. */
  onJobStarted?: (response: StartJobResponse) => void;
  /**
   * The job list, for V1's "UpdatePlan is already running for this plan" warning.
   *
   * Optional: without it the dialog cannot tell, and V1's own check is a convenience rather than
   * the authority — the service refuses a second UpdatePlan on the same folder either way.
   */
  planJobs?: Job[];
}

/** A job in any of these has not finished, so a second UpdatePlan would be a duplicate. */
const IN_FLIGHT: ReadonlyArray<Job["status"]> = ["Running", "Queued", "Pending"];

/**
 * The connected half of `UpdatePlanDialog`.
 *
 * Two things live here rather than in the view: the dispatch through
 * `PlanActionsController.updatePlan`, and the in-flight check, which needs the job list the view
 * has no way to see. The view is handed the answer as a boolean.
 */
export function UpdatePlanDialog({
  isOpen,
  onClose,
  plan,
  onJobStarted,
  planJobs,
}: UpdatePlanDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const hasActiveJob = (planJobs ?? []).some(
    (job) => job.type === "UpdatePlan" && job.planId === plan.id && IN_FLIGHT.includes(job.status),
  );

  const handleSubmit = async (instructions: string) => {
    setIsBusy(true);
    setError(null);
    try {
      const response = await PlanActionsController.updatePlan(plan, instructions);
      onJobStarted?.(response);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <UpdatePlanDialogView
      isOpen={isOpen}
      onClose={onClose}
      planId={plan.id}
      hasActiveJob={hasActiveJob}
      onSubmit={handleSubmit}
      isBusy={isBusy}
      error={error}
    />
  );
}
