import type { Meta, StoryObj } from "@storybook/react";
import { CreateVaultDialog } from "./CreateVaultDialog";

/**
 * V1's `Apps/Settings/Dialogs/CreateVaultDialog.cs`, opened from the empty vault state's *Create
 * GitHub Vault* (`VaultSetupView.cs`).
 *
 * The owner field is a picker over the GitHub identities the daemon found, and falls back to a text
 * box when it found none — so the two shapes are separate stories rather than one with a knob.
 */
const meta: Meta<typeof CreateVaultDialog> = {
  title: "Dialogs/CreateVaultDialog",
  component: CreateVaultDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: () => {},
    onSubmit: () => {},
    accounts: [
      { login: "octocat", type: "User" },
      { login: "acme", type: "Organization" },
      { login: "acme-labs", type: "Organization" },
    ],
  },
};

export default meta;
type Story = StoryObj<typeof CreateVaultDialog>;

/** Signed in with a personal account and two organisations; the first is the default owner. */
export const WithAccounts: Story = {};

/** No accounts came back, so the owner is typed rather than picked. */
export const NoAccountsDetected: Story = {
  args: { accounts: [] },
};

/** Mid-request: the confirm is disabled so a second click cannot create two repositories. */
export const Busy: Story = {
  args: { isBusy: true },
};

/** GitHub refused, and the dialog stays open with the name and owner the operator chose. */
export const RepositoryAlreadyExists: Story = {
  args: {
    error: "Repository creation failed: name already exists on this account (acme/Tendril-Vault).",
  },
};
