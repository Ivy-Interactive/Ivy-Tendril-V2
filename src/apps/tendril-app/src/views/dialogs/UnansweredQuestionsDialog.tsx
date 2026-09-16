import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import type { PlanQuestion } from "@ivy-interactive/components/tendril";
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
 * This is the first place the app surfaces unanswered plan questions at all.
 * Legacy's third button was *Answer Questions*, which navigated to a questions
 * view; V2 has neither that view nor an answer-a-plan-question endpoint, so the
 * port offers *Update Plan…* instead of a button that would go nowhere.
 *
 * TODO: when a plan-question answer path exists (a `PUT` alongside the chat
 * answering flow in `hooks/usePendingChatQuestions.ts`), add *Answer Questions*
 * here and let the operator answer in place.
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
