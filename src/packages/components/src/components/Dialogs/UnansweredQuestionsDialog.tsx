import * as React from "react";
import { Button } from "../ui/button";
import type { PlanQuestion } from "../PlanMarkdown/questionsSchema";
import { DialogShell } from "./DialogShell";

export interface UnansweredQuestionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  questions: PlanQuestion[];
  /** Opens `UpdatePlanDialog`, handing the decision to the agent. */
  onUpdatePlan: () => void;
  onProceed: () => void;
}

/**
 * Warns that the plan still asks questions nobody has answered — execute now and
 * the agent decides the scope for itself.
 *
 * Not a block, which is why V1 makes *Execute Anyway* the primary button and gives it
 * `ShortcutKey("Ctrl+Enter")`: an unanswered question means "you decide", and ExecutePlan resolves
 * one itself by taking the `recommended` option. This is the confirmation that you meant to let it.
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
      shortcut="Ctrl+Enter"
      onShortcut={onProceed}
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
          <Button onClick={onProceed} data-testid="guard-proceed">
            Execute Anyway
          </Button>
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
