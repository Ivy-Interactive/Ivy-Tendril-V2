import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { bridge } from "../../api/bridge";
import { describeBridgeError, type PlanDetail, type PlanSummary } from "../../types/api";
import { ConfirmDialog } from "./ConfirmDialog";

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
}

/**
 * V1's `Apps/Plans/Dialogs/DeletePlanDialog`, in Framework's confirmation shape (see
 * `ConfirmDialog`): Cancel outline first, the destructive Delete last, nothing to type.
 *
 * The two alternatives between them — Skipped and Icebox — are V1's, and are the reversible answers
 * to the same question, so they are read before the one with no recovery path. They are also the
 * app's only writes of those two states, so they carry information the two-button form would lose:
 * `IceboxView`'s Thaw is the way *out* of Icebox and this is the way in.
 *
 * There is deliberately no typed-id gate. Framework's confirm is armed as soon as it opens —
 * `WithConfirm` has no such affordance at all — and a second, stricter ritual for one delete while
 * every other delete in the app is a single click is the inconsistency the contract exists to
 * remove. The recoverability argument is answered instead by keeping focus on Cancel.
 *
 * Calls `bridge.deletePlan` directly and awaits it. On rejection the dialog stays
 * open with the backend's message — a plan that vanished from the list and then
 * came back is a lie the operator may act on.
 */
export function DeletePlanDialog({
  isOpen,
  onClose,
  plan,
  onDeleted,
  onArchived,
  onSkipped,
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
      await bridge.deletePlan(plan.id);
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
      await bridge.updatePlanField(plan.id, "state", state);
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
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Plan"
      testId="delete-plan-dialog"
      width="rem40"
      confirmLabel="Delete"
      confirmVariant="destructive"
      onConfirm={handleDelete}
      isBusy={isBusy}
      error={error}
      // Framework's body is the question plus its consequence; V1's `Icebox/Dialogs/DeletePlanDialog`
      // words the same question as "Are you sure you want to permanently delete plan #{id}?". The
      // second sentence is what V1's bare copy leaves the operator to guess, and the third names the
      // reversible answers so the footer's four buttons are not a surprise.
      body={
        <p>
          Are you sure you want to permanently delete plan #{plan.id}? This removes the plan folder,
          all revisions and all verification reports, and cannot be undone. To keep the folder, move
          the plan to Skipped or Icebox instead.
        </p>
      }
      secondaryAction={
        <>
          <Button
            variant="outline"
            onClick={() => void moveTo("Skipped")}
            data-testid="dialog-skip"
            disabled={isBusy}
          >
            Move to Skipped
          </Button>
          <Button
            variant="outline"
            onClick={() => void moveTo("Icebox")}
            data-testid="dialog-archive"
            disabled={isBusy}
          >
            Move to Icebox
          </Button>
        </>
      }
    />
  );
}
