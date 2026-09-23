import type { Meta, StoryObj } from "@storybook/react";
import { UpdatePlanDialog } from "./UpdatePlanDialog";

/**
 * Asks UpdatePlan to revise the plan into a new revision.
 *
 * It rewrites the plan document and touches no code, which the description says explicitly because
 * the name does not: an operator reading "Update Plan" as "apply the plan" would be dispatching the
 * wrong thing.
 */
const meta: Meta<typeof UpdatePlanDialog> = {
  title: "Dialogs/UpdatePlanDialog",
  component: UpdatePlanDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onSubmit: () => {}, planId: "00412" },
};

export default meta;
type Story = StoryObj<typeof UpdatePlanDialog>;

/** Nothing running, empty field: Update is refused until something is typed. */
export const Empty: Story = {};

/** V1's warning. A convenience rather than the authority — the service refuses a duplicate anyway. */
export const AlreadyRunning: Story = { args: { hasActiveJob: true } };

/** Mid-dispatch. */
export const Busy: Story = { args: { isBusy: true } };

/** A rejected dispatch, reported in place rather than as a toast that can be missed. */
export const Rejected: Story = {
  args: { error: "UpdatePlan is already running for plan 00412." },
};

/**
 * V1's uploads: files staged for this update, referenced from the instructions and moved into the
 * plan folder when UpdatePlan succeeds.
 */
export const WithAttachments: Story = {
  args: {
    onAttachFiles: () => {},
    onRemoveAttachment: () => {},
    attachments: [
      { name: "login-flow.png", path: "C:/Users/dev/.tendril/Attachments/3f2a/login-flow.png" },
      { name: "error.log", path: "C:/Users/dev/.tendril/Attachments/3f2a/error.log" },
    ],
  },
};

/** A pick is being staged. */
export const Attaching: Story = { args: { onAttachFiles: () => {}, isAttaching: true } };

/** A pick could not be staged. */
export const AttachFailed: Story = {
  args: {
    onAttachFiles: () => {},
    attachError: "'recording.mov' is larger than 16 MiB and cannot be attached",
  },
};
