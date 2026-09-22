import * as React from "react";
import { Button } from "../ui/button";
import { DialogShell, DialogShortcutHint } from "./DialogShell";

export interface PendingAnnotationsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Unresolved annotations. Today's caller (`collectExecuteGuards`) passes the **sum** of
   * annotations and unfolded answers here, which is why the copy names neither unless
   * `answeredQuestionCount` is also given.
   */
  annotationCount: number;
  /**
   * Answers written into the plan but not yet folded into its body — V1's second count.
   *
   * Optional because V2 sums the two before they reach here. Supplying it restores V1's naming:
   * the two are not discarded alike (annotations live only in the UI, answers are already in the
   * revision file and survive), and V1's header and decline label say which is which.
   */
  answeredQuestionCount?: number;
  /** Opens `UpdatePlanDialog` so the pending items get folded into the plan body. */
  onUpdatePlan: () => void;
  /** V1's `onDiscardAndExecute`: execute as written, leaving the pending items behind. */
  onProceed: () => void;
  /** V1's primary: fold the pending items in and execute once that has landed. */
  onUpdateAndExecute?: () => void;
}

/**
 * V1's `Message(annotationCount, answeredQuestionCount)`, verbatim: the two counts are addressed by
 * the same UpdatePlan job, so they share one dialog, but they are not discarded alike and the copy
 * has to say so.
 */
function splitMessage(annotationCount: number, answeredQuestionCount: number): string {
  const annotations = `${annotationCount} ${annotationCount === 1 ? "annotation" : "annotations"}`;
  const answers = `${answeredQuestionCount} answered ${
    answeredQuestionCount === 1 ? "question" : "questions"
  }`;

  if (annotationCount > 0 && answeredQuestionCount > 0) {
    return (
      `This plan has ${annotations} and ${answers} that haven't been incorporated yet. ` +
      "Executing now would ignore the annotations, and the agent would read the answers as they " +
      "stand rather than as part of the plan."
    );
  }

  if (answeredQuestionCount > 0) {
    return (
      `This plan has ${answers} that haven't been incorporated yet. Executing now means the agent ` +
      "reads them as they stand rather than as part of the plan."
    );
  }

  return (
    `This plan has ${annotations} that haven't been incorporated yet. Executing now would ignore ` +
    "them."
  );
}

/**
 * Warns that annotations or answers have been written onto the plan but never
 * folded into its body — the cheapest of the three guards to resolve, hence the
 * first asked.
 *
 * The footer is V1's, in V1's order: Cancel, *Update Plan* (leave the guard and go fold them in),
 * the decline, and *Update Plan & Execute* as the primary with `Ctrl+Enter` — the answer that
 * resolves the warning rather than steps over it. All three alternatives are outline, so the one
 * that fixes the problem is the only filled button.
 *
 * When only the summed count is known the header stays on V1's mixed-case wording
 * ("Unincorporated Changes") and the body keeps V2's count-agnostic sentence: naming annotations
 * specifically would be a guess, and a decline button offering to "discard annotations" when the
 * count is all answers discards nothing.
 */
export function PendingAnnotationsDialog({
  isOpen,
  onClose,
  annotationCount,
  answeredQuestionCount,
  onUpdatePlan,
  onProceed,
  onUpdateAndExecute,
}: PendingAnnotationsDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  const knowsSplit = answeredQuestionCount !== undefined;
  const hasAnnotations = annotationCount > 0;
  const hasAnswers = (answeredQuestionCount ?? 0) > 0;

  const title = knowsSplit
    ? hasAnnotations && hasAnswers
      ? "Unincorporated Changes"
      : hasAnswers
        ? "Unincorporated Answers"
        : "Unincorporated Annotations"
    : "Unincorporated Changes";

  const description = knowsSplit
    ? `⚠ ${splitMessage(annotationCount, answeredQuestionCount ?? 0)}`
    : `⚠ This plan has ${annotationCount} item${
        annotationCount === 1 ? "" : "s"
      } that no UpdatePlan run has incorporated yet.`;

  const declineLabel = knowsSplit
    ? hasAnnotations
      ? "Discard Annotations & Execute"
      : "Execute Without Updating"
    : "Execute Anyway";

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width="rem32"
      footerClassName="flex-wrap"
      {...(onUpdateAndExecute
        ? { shortcut: "Ctrl+Enter" as const, onShortcut: onUpdateAndExecute }
        : {})}
      description={description}
      testId="pending-annotations-dialog"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            Cancel
          </Button>
          <Button variant="outline" onClick={onUpdatePlan} data-testid="guard-update-plan">
            Update Plan
          </Button>
          <Button variant="outline" onClick={onProceed} data-testid="guard-proceed">
            {declineLabel}
          </Button>
          {/* The cap lives inside the same conditional as the shortcut spread above, so the two
              appear and disappear together: without `onUpdateAndExecute` there is no primary, the
              shell is given no chord, and a cap here would name a key the dialog does not listen
              for. It is on this button rather than `guard-proceed` because the chord fires this
              one — the decline is outline, and the chord belongs to the answer that resolves the
              warning. */}
          {onUpdateAndExecute && (
            <Button onClick={onUpdateAndExecute} data-testid="guard-update-and-execute">
              Update Plan &amp; Execute
              <DialogShortcutHint shortcut="Ctrl+Enter" />
            </Button>
          )}
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
