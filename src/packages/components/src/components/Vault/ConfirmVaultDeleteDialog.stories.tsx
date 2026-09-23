import type { Meta, StoryObj } from "@storybook/react";
import { ConfirmVaultDeleteDialog } from "./ConfirmVaultDeleteDialog";

/**
 * The inline confirm in V1's `VaultSetupView.cs` (`confirmDeleteDialog`): removing a project from
 * the vault opens a deletion PR rather than deleting anything outright, but it is still destructive
 * for the team, so it names what disappears. Cancel is outline and first, the confirm destructive
 * and last, and nothing is focused on open.
 */
const meta: Meta<typeof ConfirmVaultDeleteDialog> = {
  title: "Dialogs/ConfirmVaultDeleteDialog",
  component: ConfirmVaultDeleteDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: () => {},
    onConfirm: () => {},
    projectName: "Ivy-Tendril-V2",
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmVaultDeleteDialog>;

export const Default: Story = {};

/** The PR is being opened; the confirm is disabled so a double click opens one PR, not two. */
export const Busy: Story = {
  args: { isBusy: true },
};

/** The push was refused, and the reason lands where the button was pressed. */
export const PushRefused: Story = {
  args: {
    error:
      "Failed to push branch vault/delete-ivy-tendril-v2: permission denied for acme/Tendril-Vault.",
  },
};

/** A long project name still wraps inside the title and the warning. */
export const LongProjectName: Story = {
  args: { projectName: "Ivy-Interactive-Customer-Portal-Frontend-Monorepo-Legacy-Migration" },
};
