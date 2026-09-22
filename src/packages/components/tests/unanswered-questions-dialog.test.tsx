import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { UnansweredQuestionsDialog } from "../src/components/Dialogs/UnansweredQuestionsDialog";
import type { PlanQuestion } from "../src/components/PlanMarkdown/questionsSchema";

/**
 * The questions guard's chord used to fire *Execute Anyway* — the one answer that leaves the
 * questions unanswered. The other two execute guards bind `Ctrl+Enter` to the button that resolves
 * the warning, so an operator carrying that habit across fired the opposite meaning here and skipped
 * the questions instead of answering them.
 *
 * These assertions pin the chord to *Update Plan & Execute*. Each is about the pairing rather than
 * the cap alone: a cap with no chord names a dead key, and a chord with no cap is invisible.
 */
const QUESTIONS: PlanQuestion[] = [
  {
    id: "caching-strategy",
    title: "Which caching strategy?",
    multiple: false,
    other: false,
    optional: false,
    answerPresent: false,
  },
];

function hintIn(testId: string): HTMLElement | null {
  return screen.getByTestId(testId).querySelector(".tui-kbd");
}

/** `DialogShell` reads `ctrlKey || metaKey`, so Cmd and Ctrl are one chord on both platforms. */
function chord(init: KeyboardEventInit = { metaKey: true }): void {
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", ...init });
}

describe("UnansweredQuestionsDialog", () => {
  it("fires Update Plan & Execute on the chord, not Execute Anyway", () => {
    const onUpdateAndExecute = vi.fn();
    const onProceed = vi.fn();
    render(
      <UnansweredQuestionsDialog
        isOpen
        onClose={vi.fn()}
        questions={QUESTIONS}
        onUpdatePlan={vi.fn()}
        onProceed={onProceed}
        onUpdateAndExecute={onUpdateAndExecute}
      />,
    );

    chord();

    expect(onUpdateAndExecute).toHaveBeenCalledTimes(1);
    expect(onProceed).not.toHaveBeenCalled();
  });

  it("fires on Ctrl+Enter as well as Cmd+Enter", () => {
    const onUpdateAndExecute = vi.fn();
    render(
      <UnansweredQuestionsDialog
        isOpen
        onClose={vi.fn()}
        questions={QUESTIONS}
        onUpdatePlan={vi.fn()}
        onProceed={vi.fn()}
        onUpdateAndExecute={onUpdateAndExecute}
      />,
    );

    chord({ ctrlKey: true });

    expect(onUpdateAndExecute).toHaveBeenCalledTimes(1);
  });

  it("puts the cap on the button the chord fires rather than on the decline", () => {
    render(
      <UnansweredQuestionsDialog
        isOpen
        onClose={vi.fn()}
        questions={QUESTIONS}
        onUpdatePlan={vi.fn()}
        onProceed={vi.fn()}
        onUpdateAndExecute={vi.fn()}
      />,
    );

    expect(hintIn("guard-update-and-execute")).not.toBeNull();
    expect(hintIn("guard-proceed")).toBeNull();
    expect(hintIn("guard-update-plan")).toBeNull();
  });

  /** Executing past the questions stays possible — it just has to be clicked, never chorded. */
  it("keeps Execute Anyway clickable", () => {
    const onProceed = vi.fn();
    render(
      <UnansweredQuestionsDialog
        isOpen
        onClose={vi.fn()}
        questions={QUESTIONS}
        onUpdatePlan={vi.fn()}
        onProceed={onProceed}
        onUpdateAndExecute={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("guard-proceed"));

    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  /** A bare Enter must not become a second, unlabelled way to run the plan. */
  it("ignores a bare Enter", () => {
    const onUpdateAndExecute = vi.fn();
    const onProceed = vi.fn();
    render(
      <UnansweredQuestionsDialog
        isOpen
        onClose={vi.fn()}
        questions={QUESTIONS}
        onUpdatePlan={vi.fn()}
        onProceed={onProceed}
        onUpdateAndExecute={onUpdateAndExecute}
      />,
    );

    chord({});

    expect(onUpdateAndExecute).not.toHaveBeenCalled();
    expect(onProceed).not.toHaveBeenCalled();
  });

  /**
   * Without a primary there is no chord, so the decline must not inherit it: that is exactly the
   * behaviour this change removed, and it must not come back through the no-primary path.
   */
  it("advertises nothing and chords nothing when no primary was supplied", () => {
    const onProceed = vi.fn();
    render(
      <UnansweredQuestionsDialog
        isOpen
        onClose={vi.fn()}
        questions={QUESTIONS}
        onUpdatePlan={vi.fn()}
        onProceed={onProceed}
      />,
    );

    expect(screen.getByTestId("unanswered-questions-dialog").querySelector(".tui-kbd")).toBeNull();
    chord();
    expect(onProceed).not.toHaveBeenCalled();
  });
});
