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
  /** Called after the plan is archived instead. */
  onArchived?: (planId: string) => void;
}

/**
 * The one action with no recovery path, so it asks for the strongest signal of
 * intent available: the operator has to type the plan id before the destructive
 * button enables, and *Archive instead* is offered right beside it.
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

  const handleArchive = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await bridge.updatePlanField(plan.id, "state", "Icebox");
      onArchived?.(plan.id);
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
      title={`Delete plan ${plan.id}?`}
      testId="delete-plan-dialog"
      confirmLabel="Delete Permanently"
      confirmVariant="destructive"
      confirmDisabled={typedId.trim() !== plan.id}
      onConfirm={handleDelete}
      isBusy={isBusy}
      error={error}
      body={
        <p>
          The plan folder, all revisions and all verification reports are removed permanently. This
          cannot be undone.
        </p>
      }
      secondaryAction={
        <Button
          variant="outline"
          onClick={() => void handleArchive()}
          data-testid="dialog-archive"
          disabled={isBusy}
        >
          Archive instead (Icebox)
        </Button>
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
