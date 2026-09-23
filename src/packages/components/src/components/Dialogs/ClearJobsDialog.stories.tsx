import type { Meta, StoryObj } from "@storybook/react";
import { ClearJobsDialog } from "./JobConfirmDialogs";

/**
 * The Jobs header menu's bulk clears. V1 fires them straight off the menu item; V2 asks first,
 * because a bulk delete of unbounded size is what the confirmation contract is for - and the
 * question names the count, which the daemon answers over the whole table, not the loaded window.
 * The confirm stays disarmed until that count is in and non-zero.
 */
const meta: Meta<typeof ClearJobsDialog> = {
  title: "Dialogs/ClearJobsDialog",
  component: ClearJobsDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {}, scope: "failed", count: 12 },
};

export default meta;
type Story = StoryObj<typeof ClearJobsDialog>;

/** Counted, and armed: the sentence names the number. */
export const Default: Story = {};

/** One row, where the sentence takes its singular form. */
export const OneJob: Story = { args: { count: 1 } };

/** The count is still out, so nothing is armed yet. */
export const Counting: Story = { args: { count: null } };

/** Nothing to clear: said, not asked. */
export const NothingToClear: Story = { args: { count: 0 } };

/** The widest scope: every terminal status. */
export const AllFinished: Story = { args: { scope: "all", count: 412 } };

/** Mid-request. */
export const Busy: Story = { args: { isBusy: true } };

/** The count or the clear failed; the dialog stays open with the reason. */
export const Failed: Story = {
  args: { count: null, error: "Could not count jobs: Tendril service is not running" },
};
