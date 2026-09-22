import type { Meta, StoryObj } from "@storybook/react";
import { CreatePrDialog } from "./CreatePrDialog";

/**
 * Opens a pull request from the plan's worktrees via the CreatePr promptware.
 *
 * Five toggles, and one rule worth seeing: V1 sends `DeleteBranch: deleteBranch && merge`, so a
 * stale tick cannot reach the job. The toggles are interactive here, so that rule is best checked
 * from the controls rather than from a story per combination.
 */
const meta: Meta<typeof CreatePrDialog> = {
  title: "Dialogs/CreatePrDialog",
  component: CreatePrDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onSubmit: () => {}, planId: "00412" },
};

export default meta;
type Story = StoryObj<typeof CreatePrDialog>;

/** The toggles at their defaults, which is what most dispatches send. */
export const Defaults: Story = { args: { repoCount: 1 } };

/** Three repos means three branches, which the copy says. */
export const MultiRepo: Story = { args: { repoCount: 3 } };

/** Nothing to open a PR against. */
export const NoRepos: Story = { args: { repoCount: 0 } };

/** Mid-dispatch. */
export const Busy: Story = { args: { repoCount: 1, isBusy: true } };

/** A rejected dispatch, reported in place. */
export const Rejected: Story = {
  args: { repoCount: 1, error: "No commits between development and the plan's branch." },
};
