import type { Meta, StoryObj } from "@storybook/react";
import { StopAllJobsDialog } from "./JobConfirmDialogs";

/**
 * `JobsApp.DataTable.cs:335-350`, copy included: the Jobs header menu's Stop All. Running agents are
 * killed and their plans revert, and that cannot be undone.
 */
const meta: Meta<typeof StopAllJobsDialog> = {
  title: "Dialogs/StopAllJobsDialog",
  component: StopAllJobsDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {}, count: 4 },
};

export default meta;
type Story = StoryObj<typeof StopAllJobsDialog>;

/** Several active jobs. */
export const Default: Story = {};

/** One, where the sentence takes its singular form. */
export const OneJob: Story = { args: { count: 1 } };

/** Mid-request: every agent is being stopped. */
export const Busy: Story = { args: { isBusy: true } };

/** The daemon refused. */
export const Failed: Story = {
  args: { error: "Failed to stop jobs (500 Internal Server Error): database is locked" },
};
