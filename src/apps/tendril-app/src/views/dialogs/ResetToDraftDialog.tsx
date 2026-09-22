import * as React from "react";
import { ResetToDraftDialog as ResetToDraftDialogView } from "@ivy-interactive/components/tendril";
import { describeBridgeError, type PlanDetail, type PlanSummary } from "../../types/api";
import { plansStore } from "../../state/plansStore";

export interface ResetToDraftDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Called once the backend has confirmed the plan is back at Draft. */
  onReset?: (planId: string) => void;
}

/**
 * The connected half of `ResetToDraftDialog`.
 *
 * The write goes through `plansStore`, as `DeletePlanDialog`'s four answers do, so the row is back
 * at Draft in `state.plans` the moment the daemon agrees: that is what takes the plan out of the
 * Review queue, the sidebar list and the nav badge without waiting for a list round trip. Calling
 * `bridge.resetPlan` directly left the store believing the plan was still in Review, which is the
 * "does not get removed instantly" complaint on this path.
 */
export function ResetToDraftDialog({ isOpen, onClose, plan, onReset }: ResetToDraftDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleReset = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await plansStore.resetPlanOptimistic(plan.id);
      onReset?.(plan.id);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <ResetToDraftDialogView
      isOpen={isOpen}
      onClose={onClose}
      planId={plan.id}
      onConfirm={handleReset}
      isBusy={isBusy}
      error={error}
    />
  );
}
