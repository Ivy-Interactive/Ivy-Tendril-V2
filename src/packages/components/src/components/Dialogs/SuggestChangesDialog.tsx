import * as React from "react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Textarea } from "../ui/textarea";
import { useTranslation, type TFunction } from "@/i18n/uiDialogs";
import { formatChangeRequest, readSource, type AppComment } from "./appComments";
import { DialogShell } from "./DialogShell";
import { DialogAttachments, type DialogAttachmentProps } from "./DialogAttachments";

/**
 * The attachment props apply to the diff-side request only: the app-preview side has no field, and
 * V1's `UpdateFromCommentsDialog` takes no uploads.
 */
export interface SuggestChangesDialogProps extends DialogAttachmentProps {
  isOpen: boolean;
  onClose: () => void;
  /** The plan's id, as it appears in every title and callout. */
  planId: string;
  /** The plan's state, named in the refusal copy. */
  planState: string;
  /**
   * Whether a change request may land now.
   *
   * Decided by the app, because it needs the job list: a request lands only while the plan is in
   * Review, or while it is Executing with nothing already queued behind it.
   */
  allowed?: boolean;
  /** Jobs already in flight for this plan, so the queue notice can name how many. */
  inFlightCount?: number;
  /** Dispatches the request. The app decides whether that is a retry or a queued job. */
  onSubmit: (changeRequest: string) => void | Promise<void>;
  isBusy?: boolean;
  error?: string | null;
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

/**
 * The plan states the refusal copy can name, by raw value. A state the daemon added after this build
 * is shown as it is, never as a key; logic keeps comparing the raw value.
 *
 * A copy of the app's `common:enums.planState`, because a component can reach only its own catalog
 * and `uiCommon`: translate the two with the same words. It can go once the app hands the dialog its
 * own label for the state, or once the enum labels move to `uiCommon`.
 */
const PLAN_STATE_LABELS: Partial<Record<string, Parameters<TFunction>[0]>> = {
  Draft: "planStates.draft",
  Creating: "planStates.creating",
  Updating: "planStates.updating",
  Executing: "planStates.executing",
  Review: "planStates.review",
  Failed: "planStates.failed",
  Completed: "planStates.completed",
  Skipped: "planStates.skipped",
  Blocked: "planStates.blocked",
  Icebox: "planStates.icebox",
};

function planStateLabel(t: TFunction, state: string): string {
  const key = Object.hasOwn(PLAN_STATE_LABELS, state) ? PLAN_STATE_LABELS[state] : undefined;
  return key ? t(key) : state;
}

/**
 * V1's stand-in when a reviewer submits with nothing typed but inline comments waiting.
 *
 * Not translated: it is the change request the agent reads, not text on screen.
 */
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
  planId,
  planState,
  initialChangeRequest,
  inlineCommentCount,
  appComments,
  appUrl,
  allowed = true,
  inFlightCount,
  onSubmit,
  isBusy = false,
  error,
  ...attachmentProps
}: SuggestChangesDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const [changeRequest, setChangeRequest] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const primaryRef = React.useRef<HTMLButtonElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  const inlineCount = inlineCommentCount ?? 0;
  const fromApp = appComments !== undefined && appComments.length > 0;
  const waitForCount = fromApp ? (inFlightCount ?? 0) : 0;

  React.useEffect(() => {
    if (isOpen) {
      // Re-read on every open: a reviewer who cancels, leaves another comment and reopens should see
      // the request the comments now add up to, not the one they added up to last time.
      setChangeRequest(initialChangeRequest ?? "");
    }
    // `initialChangeRequest` is deliberately not a dependency: rewriting the field while the dialog is
    // open would discard whatever the reviewer had typed into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const typed = changeRequest.trim();
  const canSubmit = fromApp ? !isBusy : !isBusy && (typed !== "" || inlineCount > 0);

  // V1 re-reads plan and jobs at the click as well as on render, because the dialog may have been
  // open a while. Here both arrive as props from live state, so the value read at the click is
  // already the current one and the guard needs no second read.
  const handleSubmit = () => {
    if (!canSubmit) return;
    // The caller's formatted request when it has one, otherwise assembled here: either way it is
    // `formatChangeRequest` over these comments, never a canned string.
    const request = fromApp
      ? typed || formatChangeRequest(appUrl ?? "", appComments ?? [])
      : typed || INLINE_ONLY_REQUEST;
    void onSubmit(request);
  };

  // V1's whole alternate dialog for a plan that cannot take the request: one Close, and the comments
  // are explicitly kept rather than silently dropped.
  if (fromApp && !allowed) {
    const count = appComments?.length ?? 0;
    return (
      <DialogShell
        isOpen={isOpen}
        onClose={onClose}
        title={t("suggestChanges.notAllowed.title", { planId })}
        width="rem32"
        testId="suggest-changes-dialog"
        initialFocusRef={closeRef}
        footer={
          <Button ref={closeRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            {t("actions.close")}
          </Button>
        }
      >
        <p>{t("suggestChanges.notAllowed.state", { state: planStateLabel(t, planState) })}</p>
        <p className="mt-2 text-muted-foreground">
          {t("suggestChanges.notAllowed.commentsKept", { count })}
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
        title={t("suggestChanges.fromApp.title", { planId })}
        width="rem32"
        shortcut="Enter"
        onShortcut={() => handleSubmit()}
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
              {t("actions.cancel")}
            </Button>
            <Button
              ref={primaryRef}
              onClick={() => handleSubmit()}
              data-testid="dialog-confirm"
              disabled={!canSubmit}
            >
              {isBusy
                ? t("status.starting")
                : waitForCount > 0
                  ? t("suggestChanges.fromApp.queue")
                  : t("suggestChanges.fromApp.submit")}
            </Button>
          </>
        }
      >
        <p>{t("suggestChanges.fromApp.summary", { count: comments.length })}</p>
        {waitForCount > 0 && (
          <p className="mt-2 text-muted-foreground" data-testid="suggest-changes-queue-note">
            {t("suggestChanges.fromApp.queueNote", { planId, count: waitForCount })}
          </p>
        )}
        <div className="mt-3 space-y-3" data-testid="suggest-changes-summary">
          {groupByPage(appUrl ?? "", comments).map(([page, pageComments]) => (
            <div key={page} className="space-y-1">
              <div className="break-all font-semibold text-foreground">{page}</div>
              <div className="space-y-2">
                {pageComments.map((comment) => {
                  const where = readSource(comment.debugJson).label ?? comment.selector;
                  const tag = comment.tag || t("suggestChanges.fromApp.untaggedElement");
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
      title={t("suggestChanges.diff.title", { planId })}
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={() => handleSubmit()}
      description={t("suggestChanges.diff.description")}
      testId="suggest-changes-dialog"
      initialFocusRef={textareaRef}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => handleSubmit()} data-testid="dialog-confirm" disabled={!canSubmit}>
            {isBusy
              ? t("status.starting")
              : inlineCount > 0
                ? t("suggestChanges.diff.submitWithInline", { count: inlineCount })
                : t("suggestChanges.diff.submit")}
          </Button>
        </>
      }
    >
      {/* V1: `Callout.Info($"{n} inline comment(s) on file diffs will be included with your
          feedback.")` — the ported `Callout`, not `Alert`, which has no info variant. */}
      {inlineCount > 0 && (
        <Callout.Info className="mb-3" data-testid="suggest-changes-inline-note">
          {t("suggestChanges.diff.inlineNote", { count: inlineCount })}
        </Callout.Info>
      )}
      <label htmlFor="suggest-changes-request" className="mb-1 block text-xs text-muted-foreground">
        {t("suggestChanges.diff.requestLabel")}
      </label>
      <Textarea
        id="suggest-changes-request"
        ref={textareaRef}
        aria-label={t("suggestChanges.diff.requestLabel")}
        // A pre-filled request is a grouped listing several screens long; five rows of it is a
        // keyhole to read one's own feedback through.
        rows={initialChangeRequest ? 14 : 5}
        value={changeRequest}
        onChange={(event) => setChangeRequest(event.target.value)}
        placeholder={t("suggestChanges.diff.requestPlaceholder")}
        className="text-sm"
      />
      <DialogAttachments {...attachmentProps} disabled={isBusy} />
      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
