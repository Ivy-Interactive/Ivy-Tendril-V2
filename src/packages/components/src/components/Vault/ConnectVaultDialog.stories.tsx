import type { Meta, StoryObj } from "@storybook/react";
import { ConnectVaultDialog } from "./ConnectVaultDialog";
import type { DiscoveredVaultRepo } from "./types";

const DISCOVERED: DiscoveredVaultRepo[] = [
  {
    fullName: "acme/Tendril-Vault",
    repoUrl: "https://github.com/acme/Tendril-Vault.git",
    owner: "acme",
    name: "Tendril-Vault",
    accountType: "Organization",
    isPrivate: true,
  },
  {
    fullName: "octocat/tendril-vault-sandbox",
    repoUrl: "https://github.com/octocat/tendril-vault-sandbox.git",
    owner: "octocat",
    name: "tendril-vault-sandbox",
    accountType: "User",
    isPrivate: false,
  },
];

/**
 * V1's `Apps/Settings/Dialogs/ConnectVaultDialog.cs`, opened from *Connect Existing Git Vault*.
 *
 * The detected-vaults picker only appears once discovery has finished and found something; before
 * that the dialog says it is still looking, and a URL can be typed either way.
 */
const meta: Meta<typeof ConnectVaultDialog> = {
  title: "Dialogs/ConnectVaultDialog",
  component: ConnectVaultDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: () => {},
    onSubmit: () => {},
    discovered: DISCOVERED,
  },
};

export default meta;
type Story = StoryObj<typeof ConnectVaultDialog>;

/** Two vaults found on the operator's account and organisations. */
export const WithDetectedVaults: Story = {};

/** Discovery is still running; the URL field is already usable. */
export const Discovering: Story = {
  args: { discovered: [], isDiscovering: true },
};

/** Nothing found (or not signed in to GitHub): only the URL and display name remain. */
export const NothingDetected: Story = {
  args: { discovered: [] },
};

/** The clone is running; Connect is disabled until it answers. */
export const Busy: Story = {
  args: { isBusy: true },
};

/** The clone failed; the typed URL stays so it can be corrected. */
export const CloneFailed: Story = {
  args: {
    error:
      "git clone failed: Repository not found. Check the URL and that your GitHub account can read it.",
  },
};
