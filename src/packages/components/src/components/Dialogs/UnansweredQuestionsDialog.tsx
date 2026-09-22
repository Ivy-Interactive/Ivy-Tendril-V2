import * as React from "react";
import { Button } from "../ui/button";
import type { PlanQuestion } from "../PlanMarkdown/questionsSchema";
import { DialogShell, DialogShortcutHint } from "./DialogShell";

export interface UnansweredQuestionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  questions: PlanQuestion[];
  /** Opens `UpdatePlanDialog`, handing the decision to the agent. */
  onUpdatePlan: () => void;
  onProceed: () => void;
  /**
   * The primary: answer the questions through an UpdatePlan run, then execute behind it.
   *
   * Optional so a caller that cannot chain a job still renders a coherent dialog — without it there
   * is no primary, the shell is given no chord, and *Execute Anyway* stays a deliberate click.
   */
  onUpdateAndExecute?: () => void;
}

/**
 * Warns that the plan still asks questions nobody has answered — execute now and
 * the agent decides the scope for itself.
 *
 * Still not a block — executing with questions open is a real choice, and ExecutePlan resolves each
 * one itself by taking the `recommended` option where there is one. But it is the *worse* choice by
 * default, so it is not the one the keyboard reaches. V1 made *Execute Anyway* primary and bound it
 * to `Ctrl+Enter`; here the chord runs *Update Plan & Execute* instead, and *Execute Anyway* is an
 * outline button that has to be clicked. An operator who has learned the chord on
 * `PendingAnnotationsDialog` — where it has always meant "fix it, then run" — would otherwise fire
 * the opposite meaning here on muscle memory, and skip the questions rather than answer them.
 *
 * The middle button is *Update Plan…*, not V1's own *Answer Questions*, and that is not a gap being
 * papered over: answering happens in the plan document itself. Every question listed here is rendered
 * as a picker in the revision behind this dialog, and picking an option writes straight back into the
 * same revision (`PlanDetailView.applyAnswer` → `bridge.updateLatestRevision`). So cancelling *is*
 * "answer questions"; what *Update Plan…* adds is the job that folds the answers into the plan's prose.
 */
export function UnansweredQuestionsDialog({
  isOpen,
  onClose,
  questions,
  onUpdatePlan,
  onProceed,
  onUpdateAndExecute,
}: UnansweredQuestionsDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const plural = questions.length === 1;

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Unanswered Questions"
      width="rem32"
      footerClassName="flex-wrap"
      {...(onUpdateAndExecute
        ? { shortcut: "Ctrl+Enter" as const, onShortcut: onUpdateAndExecute }
        : {})}
      description={`⚠ This plan has ${questions.length} unanswered ${
        plural ? "question" : "questions"
      }. Executing now leaves ${
        plural ? "it" : "them"
      } to the agent, which will take the recommended option where there is one and decide for itself where there is not.`}
      testId="unanswered-questions-dialog"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            Cancel
          </Button>
          <Button variant="outline" onClick={onUpdatePlan} data-testid="guard-update-plan">
            Update Plan…
          </Button>
          <Button variant="outline" onClick={onProceed} data-testid="guard-proceed">
            Execute Anyway
          </Button>
          {/* Cap and chord are spread from the same `onUpdateAndExecute` check as the shell's
              above, so neither can outlive the other: no handler means no primary, no chord, and
              no key cap naming a chord the dialog does not listen for. */}
          {onUpdateAndExecute && (
            <Button onClick={onUpdateAndExecute} data-testid="guard-update-and-execute">
              Update Plan &amp; Execute
              <DialogShortcutHint shortcut="Ctrl+Enter" />
            </Button>
          )}
        </>
      }
    >
      <ul className="space-y-2">
        {questions.map((question) => (
          <li key={question.id} className="rounded-box border border-border p-3">
            {question.header && (
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {question.header}
              </div>
            )}
            <div className="text-sm text-foreground">{question.title}</div>
          </li>
        ))}
      </ul>
    </DialogShell>
  );
}
