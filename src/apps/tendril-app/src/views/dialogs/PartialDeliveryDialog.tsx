import * as React from "react";
import { PartialDeliveryDialog as PartialDeliveryDialogView } from "@ivy-interactive/components/tendril";
import { describeBridgeError, type PlanDetail, type PlanSummary } from "../../types/api";
import { plansStore } from "../../state/plansStore";

export interface PartialDeliveryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Called once the backend has confirmed the plan is Completed. */
  onCompleted?: (planId: string) => void;
}

/**
 * The connected half of `PartialDeliveryDialog`.
 *
 * The fourth argument of `updatePlanField` is `allowFailedVerifications`, which the completion
 * guard turns into `partial_delivery = true`. `transitionPlanOptimistic` carries that flag through
 * and patches the row to Completed the moment the daemon agrees, so the plan leaves the Review
 * queue, the sidebar list and the nav badge at once. Calling `bridge.updatePlanField` directly left
 * the store believing the plan was still in Review until a list read said otherwise.
 *
 * Filtering the failures is this side's job: the view is handed names, not the plan's DTO.
 */
export function PartialDeliveryDialog({
  isOpen,
  onClose,
  plan,
  onCompleted,
}: PartialDeliveryDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const failing = (plan.verifications || [])
    .filter((v) => v.status === "Fail")
    .map((v) => v.name);

  const handleAccept = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await plansStore.transitionPlanOptimistic(plan.id, "Completed", true);
      onCompleted?.(plan.id);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <PartialDeliveryDialogView
      isOpen={isOpen}
      onClose={onClose}
      planId={plan.id}
      failedVerifications={failing}
      onConfirm={handleAccept}
      isBusy={isBusy}
      error={error}
    />
  );
}
