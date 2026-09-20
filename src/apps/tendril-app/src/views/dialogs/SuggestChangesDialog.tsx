import * as React from "react";
import { Button, Callout, Textarea } from "@ivy-interactive/components/ui";
import { bridge } from "../../api/bridge";
import { PlanActionsController } from "../../controllers/plan_actions";
import { formatChangeRequest, readSource, type AppComment } from "../../utils/appComments";
import {
  describeBridgeError,
  type Job,
  type PlanDetail,
  type PlanLifecycleState,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";
import { DialogShell } from "./DialogShell";

export interface SuggestChangesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  onJobStarted?: (response: StartJobResponse) => void;
  /**
   * Text the request opens with, for a caller that has already assembled one — the inline diff
   * comments, formatted. Editable: it is a draft put in front of the reviewer, not a dispatch.
   */
  initialChangeRequest?: string;
  /**
   * Unresolved inline comments on the file diffs, from V1's `Review/Dialogs/SuggestChangesDialog`.
   * It drives the callout, the submit label, and whether an empty field may still be submitted.
   */
  inlineCommentCount?: number;
  /**
   * The comments the reviewer left on the running app. Present means this is V1's
   * `ReviewAction/UpdateFromCommentsDialog` rather than the diff-side Request Changes: a different
   * header, a read-only listing grouped by page, and a queue behind whatever the plan is already
   * running.
   */
  appComments?: AppComment[];
  /** The app's entry URL — the page a comment that carries no `url` of its own belongs to. */
  appUrl?: string;
  /**
   * The plan's jobs, for the two `AppPreview` gates below. Only read in app-comment mode, where V1
   * re-reads plan and jobs from the services on both render and click.
   */
  planJobs?: Job[];
}

/**
 * Port of `AppPreview.IsUnfinished`. `Blocked` counts: it is a job already waiting its turn, and the
 * next request belongs after it rather than beside it — which is what makes repeated Update presses
 * form a chain instead of a pile-up.
 */
const UNFINISHED: ReadonlyArray<Job["status"]> = ["Pending", "Queued", "Running", "Blocked"];

/**
 * Port of `AppPreview.JobsToWaitFor`: everything unfinished on this plan, not only the retries. Two
 * agents rewriting one worktree at the same time is how a branch ends up with half of each. Ids that
 * have finished by the time the job is built are harmless — the service counts only the ones it
 * still holds, so a stale id makes the new job start rather than wedge.
 */
function jobsToWaitFor(planJobs: Job[]): string[] {
  return planJobs.filter((job) => UNFINISHED.includes(job.status)).map((job) => job.id);
}

/**
 * Port of `AppPreview.CanRequestChanges`. Review is where a plan sits while it is being looked at,
 * and where a finished RetryPlan puts it back. The second case is allowed on purpose: the moment a
 * retry starts the plan moves to Executing, and a reviewer who keeps walking the app and finds three
 * more things should be able to queue them rather than be locked out until the agent finishes.
 */
function canRequestChanges(state: PlanLifecycleState, planJobs: Job[]): boolean {
  return (
    state === "Review" ||
    planJobs.some((job) => job.type === "RetryPlan" && UNFINISHED.includes(job.status))
  );
}

/**
 * Port of the private `groupByPage` in `utils/appComments`, which is not exported. Keeps both the
 * pages and the comments within them in the order they arrived, and groups on plain equality — the
 * viewer guarantees one canonical string per page.
 */
function groupByPage(url: string, comments: AppComment[]): Array<[string, AppComment[]]> {
  const pages = new Map<string, AppComment[]>();
  for (const comment of comments) {
    const page = comment.url ?? url;
    const existing = pages.get(page);
    if (existing) existing.push(comment);
    else pages.set(page, [comment]);
  }
  return [...pages.entries()];
}

/** V1's stand-in when a reviewer submits with nothing typed but inline comments waiting. */
const INLINE_ONLY_REQUEST =
  "Look at inline comments, implement changes, and come back with a new plan.";

/**
 * Asks for changes on an executed plan: the text reaching the job becomes the RetryPlan job's
 * `changeRequest`, which the promptware reads as the delta to apply on top of the existing worktree.
 *
 * One component, two V1 dialogs, because both send the same job with the same argument:
 *
 * - **Diff-side** (`Apps/Review/Dialogs/SuggestChangesDialog`) is the default: a field for the
 *   instructions, a callout counting the inline comments that ride along, and the count in the
 *   submit label. V1 clears the plan's draft diff comments once RetryPlan has started, which this
 *   does too — they have been sent, and leaving them would send them again next time.
 * - **App-preview side** (`Apps/ReviewAction/UpdateFromCommentsDialog`) takes over as soon as
 *   `appComments` is given: the comments are listed read-only and grouped by the page they were left
 *   on, because a comment left three screens back is not feedback on the screen the reviewer happens
 *   to be looking at, and that grouping is exactly what the change request carries. No field, as in
 *   V1: the reviewer edits a comment in the page, not the assembled request.
 *
 * Every call site routes through here, so nothing dispatches RetryPlan with a canned change request.
 */
export function SuggestChangesDialog({
  isOpen,
  onClose,
  plan,
  onJobStarted,
  initialChangeRequest,
  inlineCommentCount,
  appComments,
  appUrl,
  planJobs,
}: SuggestChangesDialogProps) {
  const [changeRequest, setChangeRequest] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const primaryRef = React.useRef<HTMLButtonElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  const inlineCount = inlineCommentCount ?? 0;
  const fromApp = appComments !== undefined && appComments.length > 0;
  const jobs = planJobs ?? [];
  const waitFor = fromApp ? jobsToWaitFor(jobs) : [];
  // V1 re-reads plan and jobs at the click as well as on render, because the dialog may have been
  // open a while. Here both arrive as props from live state, so the value read at the click is
  // already the current one and the guard needs no second read.
  const allowed = !fromApp || canRequestChanges(plan.state, jobs);

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

  const typed = changeRequest.trim();
  const canSubmit = fromApp ? !isBusy : !isBusy && (typed !== "" || inlineCount > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsBusy(true);
    setError(null);
    try {
      if (fromApp) {
        if (!allowed) {
          setError(
            `Plan #${plan.id} is ${plan.state} and cannot take a change request now. Your comments are kept.`,
          );
          return;
        }
        const response = await bridge.startJob({
          type: "RetryPlan",
          folderPath: plan.id,
          // The caller's formatted request when it has one, otherwise assembled here: either way it
          // is `formatChangeRequest` over these comments, never a canned string.
          changeRequest: typed || formatChangeRequest(appUrl ?? "", appComments ?? []),
          // `AppPreview.JobsToWaitFor` → `RetryPlanArgs.WaitForJobs`, which parks the job as
          // `Blocked` until they finish. Bypasses `PlanActionsController.retryPlan` because that
          // gate is `canRetry` (Review or Failed) and this dialog answers to `CanRequestChanges`,
          // which deliberately also allows a plan already applying a retry.
          ...(waitFor.length > 0 ? { waitForJobs: waitFor } : {}),
        });
        onJobStarted?.(response);
      } else {
        const response = await PlanActionsController.retryPlan(plan, typed || INLINE_ONLY_REQUEST);
        if (inlineCount > 0) {
          // V1's `ClearDraftCommentsAsync`: the comments are in the request now, so the plan's
          // drafts go. Not awaited into the failure path — the job has already started, and a plan
          // whose comments outlived their dispatch is a smaller problem than a dialog that reports
          // failure for a job that ran.
          void bridge.clearDiffComments(plan.id).catch(() => undefined);
        }
        onJobStarted?.(response);
      }
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  // V1's whole alternate dialog for a plan that cannot take the request: one Close, and the comments
  // are explicitly kept rather than silently dropped.
  if (fromApp && !allowed) {
    const count = appComments?.length ?? 0;
    return (
      <DialogShell
        isOpen={isOpen}
        onClose={onClose}
        title={`Plan #${plan.id} is not taking changes`}
        width="rem32"
        testId="suggest-changes-dialog"
        initialFocusRef={closeRef}
        footer={
          <Button ref={closeRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            Close
          </Button>
        }
      >
        <p>
          The plan is {plan.state}. A change request lands only while it is in Review, or while it
          is already applying one.
        </p>
        <p className="mt-2 text-muted-foreground">
          The {count} comment(s) are still here — send them once the plan is back in Review.
        </p>
      </DialogShell>
    );
  }

  if (fromApp) {
    const comments = appComments ?? [];
    return (
      <DialogShell
        isOpen={isOpen}
        onClose={onClose}
        title={`Update Plan #${plan.id}`}
        width="rem32"
        shortcut="Enter"
        onShortcut={() => void handleSubmit()}
        testId="suggest-changes-dialog"
        initialFocusRef={primaryRef}
        footer={
          <>
            <Button
              variant="outline"
              onClick={onClose}
              data-testid="dialog-cancel"
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button
              ref={primaryRef}
              onClick={() => void handleSubmit()}
              data-testid="dialog-confirm"
              disabled={!canSubmit}
            >
              {isBusy ? "Starting…" : waitFor.length > 0 ? "Queue Update" : "Update"}
            </Button>
          </>
        }
      >
        <p>
          {comments.length} comment(s) from the running app will be sent to the agent as a change
          request.
        </p>
        {waitFor.length > 0 && (
          <p className="mt-2 text-muted-foreground" data-testid="suggest-changes-queue-note">
            Plan #{plan.id} already has {waitFor.length} job(s) in flight, so this one queues behind
            them and starts when they finish.
          </p>
        )}
        <div className="mt-3 space-y-3" data-testid="suggest-changes-summary">
          {groupByPage(appUrl ?? "", comments).map(([page, pageComments]) => (
            <div key={page} className="space-y-1">
              <div className="break-all font-semibold text-foreground">{page}</div>
              <div className="space-y-2">
                {pageComments.map((comment) => {
                  const where = readSource(comment.debugJson).label ?? comment.selector;
                  const tag = comment.tag || "element";
                  return (
                    <div key={comment.id}>
                      <div>
                        {comment.number}. {comment.comment}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {tag} · {where}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
      </DialogShell>
    );
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={`Request Changes for Plan #${plan.id}`}
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={() => void handleSubmit()}
      description="Provide suggestions or instructions for changes to the implementation. RetryPlan resumes in the existing worktree and applies them as a delta on the work already committed."
      testId="suggest-changes-dialog"
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
            {isBusy
              ? "Starting…"
              : inlineCount > 0
                ? `Request Changes (${inlineCount} inline)`
                : "Request Changes"}
          </Button>
        </>
      }
    >
      {/* V1: `Callout.Info($"{n} inline comment(s) on file diffs will be included with your
          feedback.")` — the ported `Callout`, not `Alert`, which has no info variant. */}
      {inlineCount > 0 && (
        <Callout.Info className="mb-3" data-testid="suggest-changes-inline-note">
          {inlineCount} inline comment(s) on file diffs will be included with your feedback.
        </Callout.Info>
      )}
      <label htmlFor="suggest-changes-request" className="mb-1 block text-xs text-muted-foreground">
        Change request
      </label>
      <Textarea
        id="suggest-changes-request"
        ref={textareaRef}
        aria-label="Change request"
        // A pre-filled request is a grouped listing several screens long; five rows of it is a
        // keyhole to read one's own feedback through.
        rows={initialChangeRequest ? 14 : 5}
        value={changeRequest}
        onChange={(event) => setChangeRequest(event.target.value)}
        placeholder="Describe what needs to be changed, fixed or rewritten in the worktree…"
        className="text-sm"
      />
      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
