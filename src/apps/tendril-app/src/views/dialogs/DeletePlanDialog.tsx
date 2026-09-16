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
 * V1's `Apps/Plans/Dialogs/DeletePlanDialog`: not a yes/no but a "what would you like to do with
 * this plan", offering the two states that keep the folder — Skipped and Icebox — beside the delete
 * that does not. Both alternatives are outline, delete is destructive, and they sit in that order
 * between Cancel and it, so the reversible answers are read first.
 *
 * The typed-id gate is V2's, and stays: V1 pairs its one-click delete with `.ShortcutKey("Enter")
 * .AutoFocus()`, which is the combination this family declines (see `ConfirmDialog`). Typing the id
 * is the strongest signal of intent available for the one action with no recovery path.
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
  const [typedId, setTypedId] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setTypedId("");
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
      confirmDisabled={typedId.trim() !== plan.id}
      onConfirm={handleDelete}
      isBusy={isBusy}
      error={error}
      body={
        <p>
          What would you like to do with plan #{plan.id}? Deleting removes the plan folder, all
          revisions and all verification reports permanently. This cannot be undone.
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
    >
      <div className="mt-4">
        <label htmlFor="delete-plan-confirm" className="mb-1 block text-xs text-muted-foreground">
          Type <span className="font-mono text-foreground">{plan.id}</span> to confirm
        </label>
        <input
          id="delete-plan-confirm"
          aria-label="Confirm plan id"
          value={typedId}
          onChange={(event) => setTypedId(event.target.value)}
          className="w-full rounded-field border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </ConfirmDialog>
  );
}
