import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell } from "./DialogShell";

export interface PendingAnnotationsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  annotationCount: number;
  /** Opens `UpdatePlanDialog` so the pending items get folded into the plan body. */
  onUpdatePlan: () => void;
  onProceed: () => void;
}

/**
 * Warns that annotations or answers have been written onto the plan but never
 * folded into its body — the cheapest of the three guards to resolve, hence the
 * first asked.
 *
 * The count sums both sources (see `collectExecuteGuards`), so the copy names
 * neither: one phrasing that stays true whichever of them is pending.
 */
export function PendingAnnotationsDialog({
  isOpen,
  onClose,
  annotationCount,
  onUpdatePlan,
  onProceed,
}: PendingAnnotationsDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Pending annotations"
      description={`⚠ This plan has ${annotationCount} item${
        annotationCount === 1 ? "" : "s"
      } that no UpdatePlan run has incorporated yet.`}
      testId="pending-annotations-dialog"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            Cancel
          </Button>
          <Button variant="outline" onClick={onUpdatePlan} data-testid="guard-update-plan">
            Update Plan First
          </Button>
          <Button variant="warning" onClick={onProceed} data-testid="guard-proceed">
            Execute Anyway
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Executing now runs the plan as written, so those notes will not shape what the agent does.
        Running UpdatePlan first folds them into the plan body.
      </p>
    </DialogShell>
  );
}
