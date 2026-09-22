import * as React from "react";
import { describeBridgeError, type PlanDetail, type PlanSummary } from "../../types/api";
import { plansStore } from "../../state/plansStore";
import { ConfirmDialog } from "@ivy-interactive/components/tendril";

export interface ResetToDraftDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Called once the backend has confirmed the plan is back at Draft. */
  onReset?: (planId: string) => void;
}

/**
 * Sends the plan back to Draft and removes its worktrees, so it can be executed
 * again from a clean slate.
 *
 * State change and cleanup happen in one request, so the UI cannot leave a
 * half-reset plan behind. A Completed or Skipped plan — or one a job still holds
 * — is refused with a 409, whose message this dialog renders in place.
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
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      // `DialogHeader($"Reset Plan #{id} to Draft")`, and V1's Warning (not destructive) confirm.
      title={`Reset Plan #${plan.id} to Draft`}
      testId="reset-to-draft-dialog"
      confirmLabel="Reset to Draft"
      confirmVariant="warning"
      onConfirm={handleReset}
      isBusy={isBusy}
      error={error}
      body={
        <p>
          The plan returns to <span className="text-foreground">Draft</span> and its worktrees are
          removed, discarding any uncommitted work inside them. Commits already pushed are not
          affected.
        </p>
      }
    />
  );
}
