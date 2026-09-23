import type { Meta, StoryObj } from "@storybook/react";
import { PushToVaultDialog } from "./PushToVaultDialog";
import type { ProjectAssets } from "./types";

const ASSETS: ProjectAssets[] = [
  {
    projectName: "Ivy-Tendril-V2",
    skills: ["release", "code-review", "i18n-extract"],
    mcpServers: ["github"],
    memories: ["stack.md", "conventions.md"],
    reviewActions: ["Run Storybook"],
    verifications: ["RustClippy", "NpmTest"],
  },
  {
    projectName: "Ivy-Web",
    skills: ["seo-audit"],
    mcpServers: [],
    memories: ["stack.md"],
    reviewActions: [],
    verifications: ["NpmBuild"],
  },
  {
    projectName: "Scratch",
    skills: [],
    mcpServers: [],
    memories: [],
    reviewActions: [],
    verifications: [],
  },
];

/**
 * V1's `Apps/Settings/Dialogs/PushToVaultDialog.cs`: pick projects, pick each one's assets, write a
 * version and changelog, and open one PR against the vault. Every local project is listed, ticked or
 * not, so the assets of one you have not chosen can still be inspected.
 */
const meta: Meta<typeof PushToVaultDialog> = {
  title: "Dialogs/PushToVaultDialog",
  component: PushToVaultDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: () => {},
    onSubmit: () => {},
    vaultDisplayName: "acme/Tendril-Vault",
    targetVaultId: "default",
    availableProjects: ASSETS.map((entry) => entry.projectName),
    assets: ASSETS,
  },
};

export default meta;
type Story = StoryObj<typeof PushToVaultDialog>;

/** Every project preselected, each with everything it has. */
export const AllProjects: Story = {};

/** Opened from one row's *Open PR*: only that project is ticked and expanded. */
export const OneProjectPreselected: Story = {
  args: { defaultProject: "Ivy-Web" },
};

/** No local projects at all. */
export const NoProjects: Story = {
  args: { availableProjects: [], assets: [] },
};

/** The PR is being opened. */
export const Busy: Story = {
  args: { isBusy: true },
};

/** The PR exists; the dialog stays open so its link lands where the operator is looking. */
export const PrOpened: Story = {
  args: { prUrl: "https://github.com/acme/Tendril-Vault/pull/42" },
};

/** The push was refused. */
export const PushFailed: Story = {
  args: {
    error:
      "Failed to push branch vault/export-2026-09-23: remote rejected (protected branch hook declined).",
  },
};
