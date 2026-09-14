import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { PlanActionsController } from "../../controllers/plan_actions";
import {
  describeBridgeError,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";
import { DialogShell } from "./DialogShell";
import { ALERT_CLASS, FIELD_CLASS } from "./fieldStyles";

export interface UpdatePlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Called with the started job so the caller can open its session tab. */
  onJobStarted?: (response: StartJobResponse) => void;
}

/**
 * Hands the agent a set of instructions and runs UpdatePlan, which writes a new
 * revision. This is also where the two answer-related execute guards send the
 * operator: an UpdatePlan run is what folds answers into the plan body.
 */
export function UpdatePlanDialog({ isOpen, onClose, plan, onJobStarted }: UpdatePlanDialogProps) {
  const [instructions, setInstructions] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setInstructions("");
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const trimmed = instructions.trim();
    if (!trimmed) return;
    setIsBusy(true);
    setError(null);
    try {
      const response = await PlanActionsController.updatePlan(plan, trimmed);
      onJobStarted?.(response);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={`Update plan ${plan.id}`}
      description="Describe what should change. UpdatePlan rewrites the plan into a new revision — it does not touch any code."
      testId="update-plan-dialog"
      initialFocusRef={textareaRef}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            data-testid="dialog-confirm"
            disabled={isBusy || instructions.trim() === ""}
          >
            {isBusy ? "Starting…" : "Update Plan"}
          </Button>
        </>
      }
    >
      <label
        htmlFor="update-plan-instructions"
        className="mb-1 block text-xs text-muted-foreground"
      >
        Instructions
      </label>
      <textarea
        id="update-plan-instructions"
        ref={textareaRef}
        aria-label="Update instructions"
        rows={5}
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder="Fold in the answered questions, then narrow the scope to the guard chain only…"
        className={FIELD_CLASS}
      />
      {error && (
        <div role="alert" className={ALERT_CLASS}>
          {error}
        </div>
      )}
    </DialogShell>
  );
}
