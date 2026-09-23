import type { Meta, StoryObj } from "@storybook/react";
import { ResetToDraftDialog } from "./PlanConfirmDialogs";

/**
 * The plan-lifecycle confirms share one shape, so they share a stories file: a `ConfirmDialog`
 * whose copy names a consequence, over a request the app owns.
 */
const meta: Meta<typeof ResetToDraftDialog> = {
  title: "Dialogs/ResetToDraftDialog",
  component: ResetToDraftDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {}, planId: "00412" },
};

export default meta;
type Story = StoryObj<typeof ResetToDraftDialog>;

/** The ordinary case: execution failed and the plan goes back for another pass. */
export const Default: Story = {};

/** Mid-request, so a second click cannot double-send. */
export const Busy: Story = { args: { isBusy: true } };

/**
 * A Completed or Skipped plan, or one a job still holds, is refused with a 409 whose message
 * renders in place.
 */
export const Refused: Story = {
  args: { error: "Plan 00412 is Completed and cannot be reset." },
};
