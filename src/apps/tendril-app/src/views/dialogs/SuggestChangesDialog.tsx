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

export interface SuggestChangesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  onJobStarted?: (response: StartJobResponse) => void;
}

/**
 * Asks for changes on an executed plan: the typed text becomes the RetryPlan
 * job's `changeRequest`, which the promptware reads as the delta to apply on top
 * of the existing worktree.
 *
 * The text reaching the job is the point of this dialog. Both call sites route
 * through it, so nothing dispatches RetryPlan with a canned change request.
 */
export function SuggestChangesDialog({
  isOpen,
  onClose,
  plan,
  onJobStarted,
}: SuggestChangesDialogProps) {
  const [changeRequest, setChangeRequest] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setChangeRequest("");
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const trimmed = changeRequest.trim();
    if (!trimmed) return;
    setIsBusy(true);
    setError(null);
    try {
      const response = await PlanActionsController.retryPlan(plan, trimmed);
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
      title="Request changes"
      description="RetryPlan resumes in the existing worktree and applies this as a delta on the work already committed."
      testId="suggest-changes-dialog"
      initialFocusRef={textareaRef}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            Cancel
          </Button>
          <Button
            variant="warning"
            onClick={() => void handleSubmit()}
            data-testid="dialog-confirm"
            disabled={isBusy || changeRequest.trim() === ""}
          >
            {isBusy ? "Starting…" : "Submit Change Request"}
          </Button>
        </>
      }
    >
      <label htmlFor="suggest-changes-request" className="mb-1 block text-xs text-muted-foreground">
        Change request
      </label>
      <textarea
        id="suggest-changes-request"
        ref={textareaRef}
        aria-label="Change request"
        rows={5}
        value={changeRequest}
        onChange={(event) => setChangeRequest(event.target.value)}
        placeholder="Describe what needs to be changed, fixed or rewritten in the worktree…"
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
