import type { Meta, StoryObj } from "@storybook/react";
import { SyncRepoDialog } from "./SyncRepoDialog";

/**
 * V1's SyncRepo policy dialog (`DirtyRepoDialog.BuildPolicyDialog`), reached from *Sync Repos* on
 * the dirty-repo guard when there is local work to reconcile: stash it, commit and push it, or open
 * a PR with it, before the repo is brought up to date.
 *
 * The copy names what was found and, only when every repo shares one, the branch it goes to.
 */
const meta: Meta<typeof SyncRepoDialog> = {
  title: "Dialogs/SyncRepoDialog",
  component: SyncRepoDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onSync: () => {},
    baseBranches: ["main"],
    hasUncommitted: true,
    hasUntracked: false,
  },
};

export default meta;
type Story = StoryObj<typeof SyncRepoDialog>;

/** Modified files only, one base branch, which the copy names. */
export const UncommittedChanges: Story = {};

/** Untracked files only. */
export const UntrackedFiles: Story = { args: { hasUncommitted: false, hasUntracked: true } };

/** Both kinds of local work. */
export const Both: Story = { args: { hasUntracked: true } };

/** Repos on different base branches: none is named, rather than a made-up joined one. */
export const SeveralBaseBranches: Story = {
  args: { baseBranches: ["main", "development", "release/2.0"], hasUntracked: true },
};
