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
