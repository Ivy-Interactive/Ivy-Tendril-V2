import type { Meta, StoryObj } from "@storybook/react";
import { DeletePlanDialog } from "./PlanConfirmDialogs";

/**
 * Deletes the plan, with the two reversible answers beside it.
 *
 * Framework's body is the question plus its consequence; V1 words the same question as "Are you
 * sure you want to permanently delete plan #{id}?". The second sentence is what V1's bare copy
 * leaves the operator to guess, and the third names the reversible answers so the footer's four
 * buttons are not a surprise.
 */
const meta: Meta<typeof DeletePlanDialog> = {
  title: "Dialogs/DeletePlanDialog",
  component: DeletePlanDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onConfirm: () => {},
    onSkip: () => {},
    onArchive: () => {},
    planId: "00412",
  },
};

export default meta;
type Story = StoryObj<typeof DeletePlanDialog>;

/** All four answers offered. */
export const Default: Story = {};

/** Mid-request: every answer is disabled, not just the destructive one. */
export const Busy: Story = { args: { isBusy: true } };

/** Deletion refused server-side, with the reason in place. */
export const Refused: Story = {
  args: { error: "Plan 00412 is held by a running job (#1184) and cannot be deleted." },
};
