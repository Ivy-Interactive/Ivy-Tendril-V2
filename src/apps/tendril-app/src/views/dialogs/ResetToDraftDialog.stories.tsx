import type { Meta, StoryObj } from "@storybook/react";
import { ResetToDraftDialog } from "./ResetToDraftDialog";
import { plan } from "./storyModels";

/**
 * Sends the plan back to Draft and removes its worktrees, so it can be executed again from a clean
 * slate.
 *
 * State change and cleanup happen in one request, so the UI cannot leave a half-reset plan behind.
 * The stories are the plan states that reach it, including the two the backend refuses.
 */
const meta = {
  title: "Dialogs/Confirms/ResetToDraftDialog",
  component: ResetToDraftDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof ResetToDraftDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The ordinary case: execution failed and the plan goes back for another pass. */
export const FailedPlan: Story = {
  args: { plan: plan({ state: "Failed" }) },
};

/** Execution succeeded but the work needs redoing. */
export const ReviewPlan: Story = {
  args: { plan: plan({ state: "Review" }) },
};

/** A terminal state the backend refuses. `TerminalStateRejection` covers the refusal; this is the
 *  rendering half. */
export const CompletedPlan: Story = {
  args: { plan: plan({ state: "Completed" }) },
};

/** The other terminal state, refused for the same reason and reading the same way. */
export const SkippedPlan: Story = {
  args: { plan: plan({ state: "Skipped" }) },
};

/** A job still holds the worktrees this would remove. */
export const ExecutingPlan: Story = {
  args: { plan: plan({ state: "Executing" }) },
};

/** Reset removes every worktree, so a multi-repo plan is where that consequence is largest. */
export const MultiRepoPlan: Story = {
  args: {
    plan: plan({
      state: "Failed",
      repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework", "/repos/Ivy-Tendril"],
    }),
  },
};
