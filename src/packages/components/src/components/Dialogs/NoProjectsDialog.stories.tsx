import type { Meta, StoryObj } from "@storybook/react";
import { NoProjectsDialog } from "./NoProjectsDialog";

/**
 * The empty state for the new-plan flow: a plan needs a project and none is configured.
 *
 * Little varies, which is itself worth recording — there is no `projects` nav id, so Settings is
 * where this points, and the copy names the Projects section within it.
 */
const meta: Meta<typeof NoProjectsDialog> = {
  title: "Dialogs/NoProjectsDialog",
  component: NoProjectsDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onOpenSettings: () => {} },
};

export default meta;
type Story = StoryObj<typeof NoProjectsDialog>;

/** The one state it has. */
export const NoProjectConfigured: Story = {};
