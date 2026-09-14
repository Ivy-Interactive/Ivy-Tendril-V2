import * as React from "react";
import { bridge } from "../../api/bridge";
import { describeBridgeError, type PlanDetail } from "../../types/api";
import { ConfirmDialog } from "./ConfirmDialog";

export interface PartialDeliveryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail;
  /** Called once the backend has confirmed the plan is Completed. */
  onCompleted?: (planId: string) => void;
}

/**
 * Completes the plan while accepting that some verifications failed.
 *
 * The fourth argument of `updatePlanField` is `allowFailedVerifications`, which
 * the completion guard turns into `partial_delivery = true`. Without it the same
 * request is refused with a 409 listing the failures — which is exactly what this
 * dialog exists to acknowledge, by name, before sending the flag.
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

  const failing = (plan.verifications || []).filter((v) => v.status === "Fail");

  const handleAccept = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await bridge.updatePlanField(plan.id, "state", "Completed", true);
      onCompleted?.(plan.id);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Accept partial delivery?"
      testId="partial-delivery-dialog"
      confirmLabel="Accept Partial Delivery"
      confirmVariant="warning"
      onConfirm={handleAccept}
      isBusy={isBusy}
      error={error}
      body={
        <>
          <p>
            The plan is recorded as <span className="text-foreground">Completed</span> and flagged
            as a partial delivery, despite these failing verifications:
          </p>
          <ul className="space-y-1" data-testid="failing-verifications">
            {failing.map((verification) => (
              <li key={verification.name} className="text-warning">
                {verification.name}
              </li>
            ))}
          </ul>
        </>
      }
    />
  );
}
