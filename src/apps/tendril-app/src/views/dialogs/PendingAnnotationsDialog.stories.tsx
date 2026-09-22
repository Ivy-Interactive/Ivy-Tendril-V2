import type { Meta, StoryObj } from "@storybook/react";
import { PendingAnnotationsDialog } from "./PendingAnnotationsDialog";

/**
 * The second execute guard, which had exactly one mention inside `ExecuteGuardChain` before this.
 *
 * V1's `Message(annotationCount, answeredQuestionCount)` is a two-count message: the two are
 * addressed by the same UpdatePlan job, so they share one dialog, but they are not discarded alike
 * — annotations live only in the UI, answers are already in the revision file — and the copy has to
 * say which is which.
 */
const meta = {
  title: "Dialogs/Guards/PendingAnnotationsDialog",
  component: PendingAnnotationsDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onUpdatePlan: () => {}, onProceed: () => {} },
} satisfies Meta<typeof PendingAnnotationsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Today's caller passes the sum and omits the breakdown, so the copy names neither kind. */
export const AnnotationsOnlySummed: Story = {
  args: { annotationCount: 4 },
};

/** The singular branch of the count. */
export const OneAnnotation: Story = {
  args: { annotationCount: 1 },
};

/** Supplying `answeredQuestionCount` restores V1's naming, where the two kinds are distinguished. */
export const AnnotationsAndAnswers: Story = {
  args: { annotationCount: 3, answeredQuestionCount: 2 },
};

/** Zero annotations with answers pending: the half of V1's message that names answers alone. */
export const AnswersOnly: Story = {
  args: { annotationCount: 0, answeredQuestionCount: 5 },
};

/** Both counts at 1, which is where two independently-written singular branches meet. */
export const OneOfEach: Story = {
  args: { annotationCount: 1, answeredQuestionCount: 1 },
};

/**
 * `onUpdateAndExecute` is V1's primary — fold the pending items in, then execute. Optional, so its
 * absence is every other story and its presence is this one.
 */
export const WithUpdateAndExecute: Story = {
  args: { annotationCount: 2, onUpdateAndExecute: () => {} },
};
