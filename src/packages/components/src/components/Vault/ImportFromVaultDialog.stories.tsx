import type { Meta, StoryObj } from "@storybook/react";
import { ImportFromVaultDialog } from "./ImportFromVaultDialog";
import type { VaultCatalogItem } from "./types";

function item(overrides: Partial<VaultCatalogItem> = {}): VaultCatalogItem {
  return {
    name: "Ivy-Tendril-V2",
    description: "Tendril desktop app, daemon and component library.",
    color: "Emerald",
    remoteVersion: "2026.09.22.141500",
    latestChangelog: "Adds the RustClippy verification and the release skill.",
    reposCount: 2,
    skillsCount: 3,
    mcpsCount: 1,
    memoriesCount: 2,
    reviewActionsCount: 1,
    verificationsCount: 2,
    skillNames: ["release", "code-review", "i18n-extract"],
    mcpServerNames: ["github"],
    memoryFileNames: ["stack.md", "conventions.md"],
    reviewActionNames: ["Run Storybook"],
    verificationNames: ["RustClippy", "NpmTest"],
    syncStatus: "NotImported",
    repos: [
      { owner: "Ivy-Interactive", name: "Ivy-Tendril-V2" },
      { owner: "Ivy-Interactive", name: "Ivy-Framework" },
    ],
    hasLocalConflict: false,
    ...overrides,
  };
}

/**
 * V1's `Apps/Settings/Dialogs/ImportFromVaultDialog.cs`: the local name, where each repo should
 * live, and which assets to bring. *Link & Merge* is the same dialog in `mergeMode`, which keeps the
 * vault's name because that name is the link.
 *
 * The existence badges come from `existingPaths`, which the host looks up — the dialog is pure.
 */
const meta: Meta<typeof ImportFromVaultDialog> = {
  title: "Dialogs/ImportFromVaultDialog",
  component: ImportFromVaultDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: () => {},
    onSubmit: () => {},
    item: item(),
    existingNames: ["Ivy-Web"],
    existingPaths: ["/home/dev/git/Ivy-Framework"],
    homeDir: "/home/dev",
  },
};

export default meta;
type Story = StoryObj<typeof ImportFromVaultDialog>;

/** A fresh import: one repo will be cloned, the other is already on disk. */
export const Default: Story = {};

/** The vault's name is taken locally, so the dialog proposes the next free one and says why. */
export const NameTaken: Story = {
  args: {
    item: item({ syncStatus: "Conflict", hasLocalConflict: true }),
    existingNames: ["Ivy-Tendril-V2"],
  },
};

/** *Link & Merge*: the name is fixed, and the local project's repo paths are kept. */
export const MergeMode: Story = {
  args: {
    mergeMode: true,
    existingNames: ["Ivy-Tendril-V2"],
    localProjects: [
      {
        name: "Ivy-Tendril-V2",
        repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework"],
      },
    ],
    existingPaths: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework"],
  },
};

/** A project that publishes nothing but its repos: every asset group says it is empty. */
export const NoAssets: Story = {
  args: {
    item: item({
      skillNames: [],
      mcpServerNames: [],
      memoryFileNames: [],
      reviewActionNames: [],
      verificationNames: [],
      latestChangelog: null,
    }),
  },
};

/** The import is running. */
export const Busy: Story = {
  args: { isBusy: true },
};

/** The daemon refused; the mappings and selections the operator made are still there. */
export const ImportFailed: Story = {
  args: {
    error:
      "Clone of Ivy-Interactive/Ivy-Tendril-V2 failed: destination path already exists and is not empty.",
  },
};
