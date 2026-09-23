import * as React from "react";
import { DeletePlanDialog as DeletePlanDialogView } from "@ivy-interactive/components/dialogs";
import { describeBridgeError, type PlanDetail, type PlanSummary } from "../../types/api";
import { plansStore } from "../../state/plansStore";

export interface DeletePlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Called after the plan is gone, so the caller can re-point its selection. */
  onDeleted?: (planId: string) => void;
  /** Called after the plan is moved to Icebox instead. */
  onArchived?: (planId: string) => void;
  /** Called after the plan is moved to Skipped instead. */
  onSkipped?: (planId: string) => void;
  /**
   * `icebox` is V1's `Icebox/Dialogs/DeletePlanDialog`: a bare permanent-delete confirm, without the
   * Skip/Icebox alternatives the Plans page offers.
   */
  variant?: "plans" | "icebox";
}

/**
 * The connected half of `DeletePlanDialog`.
 *
 * All three answers go through `plansStore` rather than the bridge directly, so the row leaves the
 * list the moment the daemon agrees instead of waiting for a list round trip — that is what makes
 * the removal look instant in the sidebar and the nav badge.
 */
export function DeletePlanDialog({
  isOpen,
  onClose,
  plan,
  onDeleted,
  onArchived,
  onSkipped,
  variant = "plans",
}: DeletePlanDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleDelete = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await plansStore.removePlanOptimistic(plan.id);
      onDeleted?.(plan.id);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  /** Both alternatives are one `state` write, so they share the transition and differ only in target. */
  const moveTo = async (state: "Icebox" | "Skipped") => {
    setIsBusy(true);
    setError(null);
    try {
      await plansStore.transitionPlanOptimistic(plan.id, state);
      if (state === "Icebox") onArchived?.(plan.id);
      else onSkipped?.(plan.id);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <DeletePlanDialogView
      isOpen={isOpen}
      onClose={onClose}
      planId={plan.id}
      variant={variant}
      onConfirm={handleDelete}
      onSkip={() => moveTo("Skipped")}
      onArchive={() => moveTo("Icebox")}
      isBusy={isBusy}
      error={error}
    />
  );
}
