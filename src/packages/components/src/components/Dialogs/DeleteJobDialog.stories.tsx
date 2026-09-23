import type { Meta, StoryObj } from "@storybook/react";
import { DeleteJobDialog } from "./JobConfirmDialogs";

/**
 * `JobsApp.DataTable.cs:296-317`, copy included: the Jobs row menu's Delete, and the output sheet's.
 * The app's handler stops a still-running job first, then deletes, then re-reads the list.
 */
const meta: Meta<typeof DeleteJobDialog> = {
  title: "Dialogs/DeleteJobDialog",
  component: DeleteJobDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {} },
};

export default meta;
type Story = StoryObj<typeof DeleteJobDialog>;

/** The ordinary case. Focus lands on Cancel, never on the destructive button. */
export const Default: Story = {};

/** Mid-request, so a second click cannot double-send. */
export const Busy: Story = { args: { isBusy: true } };

/** The daemon refused, and the dialog stays open with its reason rather than closing. */
export const Refused: Story = {
  args: { error: "Delete failed: Failed to delete job '01184' (404 Not Found): Job not found" },
};
