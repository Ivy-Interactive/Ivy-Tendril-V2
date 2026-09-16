import * as React from "react";
import { bridge } from "../../api/bridge";
import { describeBridgeError, type PlanDetail, type PlanSummary } from "../../types/api";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DiscardPlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Called once the backend has confirmed the plan is Skipped. */
  onDiscarded?: (planId: string) => void;
}

/**
 * Moves the plan to Skipped: the work is not wanted, but the folder stays.
 *
 * Awaits `bridge.updatePlanField` rather than going through
 * `plansStore.updateFieldOptimistic` — for a state change the operator may act
 * on, a flicker to "Skipped" and back on rejection is worse than a pause.
 */
export function DiscardPlanDialog({ isOpen, onClose, plan, onDiscarded }: DiscardPlanDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleDiscard = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await bridge.updatePlanField(plan.id, "state", "Skipped");
      onDiscarded?.(plan.id);
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
      // Header, button label and destructive treatment from V1's `DiscardPlanDialog`; the body keeps
      // V2's account of what survives, which V1's bare "Are you sure…" leaves the operator to guess.
      title="Discard Plan"
      testId="discard-plan-dialog"
      confirmLabel="Discard"
      confirmVariant="destructive"
      onConfirm={handleDiscard}
      isBusy={isBusy}
      error={error}
      body={
        <p>
          Are you sure you want to discard plan #{plan.id}? The plan moves to{" "}
          <span className="text-foreground">Skipped</span> and leaves the review queue. Its folder,
          revisions and verification reports stay on disk, and no pull request is opened for the
          work already done.
        </p>
      }
    />
  );
}
