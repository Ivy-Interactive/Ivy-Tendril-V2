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
  /**
   * Text the request opens with, for a caller that has already assembled one — the app preview's
   * comments, formatted. Still editable: it is a draft put in front of the reviewer, not a dispatch.
   */
  initialChangeRequest?: string;
  /**
   * A read-only listing of what the pre-filled request was built from, shown above the field.
   *
   * The reviewer left these comments one at a time, on different screens, possibly over several
   * minutes; this is the only place they see all of them together before they are sent.
   */
  summaryItems?: string[];
  /** Heading for `summaryItems`, e.g. `3 comments on http://localhost:5173/`. */
  summaryTitle?: string;
}

/**
 * Asks for changes on an executed plan: the typed text becomes the RetryPlan
 * job's `changeRequest`, which the promptware reads as the delta to apply on top
 * of the existing worktree.
 *
 * The text reaching the job is the point of this dialog. Every call site routes
 * through it, so nothing dispatches RetryPlan with a canned change request — a
 * pre-filled one included, which is why `initialChangeRequest` lands in the
 * editable field rather than bypassing it.
 */
export function SuggestChangesDialog({
  isOpen,
  onClose,
  plan,
  onJobStarted,
  initialChangeRequest,
  summaryItems,
  summaryTitle,
}: SuggestChangesDialogProps) {
  const [changeRequest, setChangeRequest] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      // Re-read on every open: a reviewer who cancels, leaves another comment and reopens should see
      // the request the comments now add up to, not the one they added up to last time.
      setChangeRequest(initialChangeRequest ?? "");
      setError(null);
      setIsBusy(false);
    }
    // `initialChangeRequest` is deliberately not a dependency: rewriting the field while the dialog is
    // open would discard whatever the reviewer had typed into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {summaryItems && summaryItems.length > 0 && (
        <div
          data-testid="suggest-changes-summary"
          className="mb-3 rounded-lg border border-border bg-muted/40 p-3"
        >
          {summaryTitle && (
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {summaryTitle}
            </div>
          )}
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            {summaryItems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
        </div>
      )}
      <label htmlFor="suggest-changes-request" className="mb-1 block text-xs text-muted-foreground">
        Change request
      </label>
      <textarea
        id="suggest-changes-request"
        ref={textareaRef}
        aria-label="Change request"
        // A pre-filled request is a grouped listing several screens long; five rows of it is a
        // keyhole to read one's own feedback through.
        rows={initialChangeRequest ? 14 : 5}
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
