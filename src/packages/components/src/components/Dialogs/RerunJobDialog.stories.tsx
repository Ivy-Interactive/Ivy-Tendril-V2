import type { Meta, StoryObj } from "@storybook/react";
import { RerunJobDialog } from "./RerunJobDialog";

/**
 * V1's `RerunJobDialog`: the Jobs row menu's Rerun, for a Failed, Timeout or Stopped job - and a
 * Completed one whose args take feedback. The job is deleted and started again from its original
 * args, with any feedback folded in.
 */
const meta: Meta<typeof RerunJobDialog> = {
  title: "Dialogs/RerunJobDialog",
  component: RerunJobDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onConfirm: () => {},
    typeLabel: "ExecutePlan",
    supportsFeedback: true,
  },
};

export default meta;
type Story = StoryObj<typeof RerunJobDialog>;

/** An execution, which can take a change request: the feedback box, focused. */
export const WithFeedback: Story = {};

/** A `CreatePr`, which reruns exactly as submitted: only the question. */
export const WithoutFeedback: Story = {
  args: { typeLabel: "CreatePr", supportsFeedback: false },
};

/** Mid-request. */
export const Busy: Story = { args: { isBusy: true } };

/** The daemon refused, e.g. a job recorded before its args were kept. */
export const Refused: Story = {
  args: {
    error:
      "Failed to rerun job '01184' (409 Conflict): Cannot rerun: original args were not preserved.",
  },
};
