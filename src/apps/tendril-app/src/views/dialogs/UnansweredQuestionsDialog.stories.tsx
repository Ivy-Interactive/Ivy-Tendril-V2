import type { Meta, StoryObj } from "@storybook/react";
import { UnansweredQuestionsDialog } from "./UnansweredQuestionsDialog";
import { question } from "./storyModels";

/**
 * One of the three execute guards, and until this file it had no test of any kind.
 *
 * Every string it shows is assembled from a count, and the singular and plural halves are written
 * separately — which is the whole reason it needs stories rather than one smoke test. The copy is a
 * branch, and a branch nobody renders is a branch nobody checks.
 */
const meta = {
  title: "Dialogs/Guards/UnansweredQuestionsDialog",
  component: UnansweredQuestionsDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onUpdatePlan: () => {}, onProceed: () => {} },
} satisfies Meta<typeof UnansweredQuestionsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The singular copy: `1 unanswered question`, and `leaves it to the agent`. */
export const OneQuestion: Story = {
  args: { questions: [question()] },
};

/** The plural copy: `3 unanswered questions`, and `leaves them to the agent`. */
export const SeveralQuestions: Story = {
  args: {
    questions: [
      question({ id: "q1", title: "Should the harness ship in release builds?" }),
      question({ id: "q2", title: "Does the registry include sheets?" }),
      question({ id: "q3", title: "Which dialogs get stories first?" }),
    ],
  },
};

/** Ten: whether the list scrolls inside the dialog or grows it past the viewport. */
export const ManyQuestions: Story = {
  args: {
    questions: Array.from({ length: 10 }, (_, i) =>
      question({ id: `q${i + 1}`, title: `Open decision number ${i + 1}` }),
    ),
  },
};

/** Wrapping: a title long enough to run past the `rem32` width the dialog declares. */
export const LongQuestionTitle: Story = {
  args: {
    questions: [
      question({
        title:
          "Should the debug harness be gated behind import.meta.env.DEV, given the eager-bundle budget sits at 93.8% and a registry importing every dialog is a large graph?",
      }),
    ],
  },
};

/**
 * Options are what the agent picks from when it answers for itself, so a question carrying a
 * recommended option is the ordinary case rather than an edge one.
 */
export const QuestionWithOptions: Story = {
  args: {
    questions: [
      question({
        title: "Where should the dialog stories live?",
        options: [
          { title: "Beside the dialogs", value: "dialogs", recommended: true },
          { title: "Under views/debug", value: "debug" },
        ],
      }),
    ],
  },
};

/**
 * `optional` means the plan is complete without an answer. The dialog still counts it, which is
 * worth seeing rather than assuming.
 */
export const OptionalQuestion: Story = {
  args: { questions: [question({ title: "Any preference on file naming?", optional: true })] },
};
