import type { Meta, StoryObj } from "@storybook/react";
import { StopQueuedJobsDialog } from "./JobConfirmDialogs";

/**
 * `JobsApp.DataTable.cs:319-333`, copy included: the Jobs header menu's Stop All Queued. Running jobs
 * are left alone, which the body says because the button label does not.
 */
const meta: Meta<typeof StopQueuedJobsDialog> = {
  title: "Dialogs/StopQueuedJobsDialog",
  component: StopQueuedJobsDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {}, count: 7 },
};

export default meta;
type Story = StoryObj<typeof StopQueuedJobsDialog>;

/** Several queued jobs. */
export const Default: Story = {};

/** One, where the sentence takes its singular form. */
export const OneJob: Story = { args: { count: 1 } };

/** Mid-request. */
export const Busy: Story = { args: { isBusy: true } };

/** The daemon could not be reached. */
export const Failed: Story = {
  args: { error: "Tendril service is not running: daemon metadata (.master) not found" },
};
