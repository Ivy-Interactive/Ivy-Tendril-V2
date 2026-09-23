import type { Meta, StoryObj } from "@storybook/react";
import { RemoveSettingsEntryDialog } from "./RemoveSettingsEntryDialog";

/**
 * The Settings removal confirm (`useRemovalConfirm` in the app). Each kind carries its own title and
 * question in every language, so a story per kind is also a check that each one exists; the free
 * noun is the fallback for a caller whose kind has no copy of its own.
 */
const meta: Meta<typeof RemoveSettingsEntryDialog> = {
  title: "Dialogs/RemoveSettingsEntryDialog",
  component: RemoveSettingsEntryDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onConfirm: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof RemoveSettingsEntryDialog>;

/** A level, which is the whole story: no consequence beyond the row. */
export const Level: Story = {
  args: { subject: { kindId: "level" }, name: "Critical" },
};

/** A repository, whose consequence says the checkout is left alone. */
export const Repository: Story = {
  args: {
    subject: { kindId: "repository" },
    name: "/home/dev/git/Ivy-Tendril-V2",
    consequence: "Plans stop being given this repository. The checkout on disk is untouched.",
  },
};

export const ReviewAction: Story = {
  args: {
    subject: { kindId: "reviewAction" },
    name: "Run Storybook",
    consequence: "The Review page stops offering it for this project's plans.",
  },
};

export const EnvironmentFile: Story = {
  args: {
    subject: { kindId: "environmentFile" },
    name: ".env.local",
    consequence: "Worktrees stop receiving a copy of it, so its variables are no longer set there.",
  },
};

export const McpServer: Story = {
  args: {
    subject: { kindId: "mcpServer" },
    name: "github",
    consequence: "Agents working on this project stop being offered its tools.",
  },
};

export const CustomSkill: Story = {
  args: {
    subject: { kindId: "customSkill" },
    name: "code-review",
    consequence:
      "Agents working on this project stop being given it. This removes the project's reference to it, not the skill's own files.",
  },
};

/** A project memory — the one kind here whose removal deletes a file. */
export const MemoryFile: Story = {
  args: {
    subject: { kindId: "memoryFile" },
    name: "conventions.md",
    consequence: "The file is deleted from the project's Memory folder.",
  },
};

/** A caller with its own (already translated) noun. */
export const FreeNoun: Story = {
  args: { subject: { noun: "port" }, name: "frontend (5173)" },
};
