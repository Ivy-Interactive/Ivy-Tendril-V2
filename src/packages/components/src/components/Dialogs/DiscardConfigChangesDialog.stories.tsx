import type { Meta, StoryObj } from "@storybook/react";
import { DiscardConfigChangesDialog } from "./DiscardConfigChangesDialog";

/**
 * The `config.yaml` editor's *Reload* confirm, shown only while the editor holds unsaved edits. The
 * reload itself is also what the editor offers after a stale-write refusal, so this is the dialog an
 * operator meets right after a conflict.
 */
const meta: Meta<typeof DiscardConfigChangesDialog> = {
  title: "Dialogs/DiscardConfigChangesDialog",
  component: DiscardConfigChangesDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {} },
};

export default meta;
type Story = StoryObj<typeof DiscardConfigChangesDialog>;

export const Default: Story = {};
