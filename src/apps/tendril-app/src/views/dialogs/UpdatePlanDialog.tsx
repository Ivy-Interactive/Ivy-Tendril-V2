import * as React from "react";
import { Button, Callout, Textarea } from "@ivy-interactive/components/ui";
import { PlanActionsController } from "../../controllers/plan_actions";
import {
  describeBridgeError,
  type Job,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";
import { DialogShell } from "./DialogShell";

export interface UpdatePlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Called with the started job so the caller can open its session tab. */
  onJobStarted?: (response: StartJobResponse) => void;
  /**
   * The job list, for V1's "UpdatePlan is already running for this plan" warning.
   *
   * Optional: without it the dialog cannot tell, and V1's own check is a convenience rather than the
   * authority — the service refuses a second UpdatePlan on the same folder either way.
   */
  planJobs?: Job[];
}

/** V1's in-flight statuses for this check: `Running or Queued or Pending`. */
const IN_FLIGHT: ReadonlyArray<Job["status"]> = ["Running", "Queued", "Pending"];

/**
 * Hands the agent a set of instructions and runs UpdatePlan, which writes a new
 * revision. This is also where the two answer-related execute guards send the
 * operator: an UpdatePlan run is what folds answers into the plan body.
 *
 * V1 renders the instructions field as a `ContentInput` whose submit button carries the label
 * ("Update") and which also accepts file attachments. V2 has no upload session endpoint behind
 * `UpdatePlanArgs.uploadSessionId`, so the field is a plain textarea with the submit in the footer
 * where the rest of this family puts it, keeping V1's label and its `Ctrl+Enter`.
 */
export function UpdatePlanDialog({
  isOpen,
  onClose,
  plan,
  onJobStarted,
  planJobs,
}: UpdatePlanDialogProps) {
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

  const hasActiveJob = (planJobs ?? []).some(
    (job) => job.type === "UpdatePlan" && job.planId === plan.id && IN_FLIGHT.includes(job.status),
  );

  const canSubmit = !isBusy && !hasActiveJob && instructions.trim() !== "";

  const handleSubmit = async () => {
    const trimmed = instructions.trim();
    if (!canSubmit) return;
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
      title={`Update Plan #${plan.id}`}
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={() => void handleSubmit()}
      description="Provide instructions for revising this plan. UpdatePlan rewrites the plan into a new revision — it does not touch any code."
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
            disabled={!canSubmit}
          >
            {isBusy ? "Starting…" : "Update"}
          </Button>
        </>
      }
    >
      {/* V1: `Text.P("⚠️ UpdatePlan is already running for this plan. Please wait...").Color(Warning)`,
          as a Callout here — `Alert` has only default and destructive, so it has no warning to give. */}
      {hasActiveJob && (
        <Callout.Warning className="mb-3" data-testid="update-plan-already-running">
          UpdatePlan is already running for this plan. Please wait…
        </Callout.Warning>
      )}
      <label
        htmlFor="update-plan-instructions"
        className="mb-1 block text-xs text-muted-foreground"
      >
        Instructions
      </label>
      <Textarea
        id="update-plan-instructions"
        ref={textareaRef}
        aria-label="Update instructions"
        rows={5}
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder="Fold in the answered questions, then narrow the scope to the guard chain only…"
        className="text-sm"
      />
      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
