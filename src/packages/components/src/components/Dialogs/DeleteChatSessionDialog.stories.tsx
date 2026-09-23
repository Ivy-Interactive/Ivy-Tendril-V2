import type { Meta, StoryObj } from "@storybook/react";
import { DeleteChatSessionDialog } from "./DeleteChatSessionDialog";

/**
 * Deletes a chat, from a Chats row's Delete action or the chat header's menu. V1's
 * `Apps/Chat/Dialogs/DeleteSessionDialog.cs`, with its wording.
 *
 * Unlike V1, Delete is not the default focus: a destructive confirm never is (`DialogShell`'s
 * contract). A refusal is shown in place and the dialog stays open.
 */
const meta: Meta<typeof DeleteChatSessionDialog> = {
  title: "Dialogs/DeleteChatSessionDialog",
  component: DeleteChatSessionDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onConfirm: () => {},
    sessionTitle: "Architecture Planning",
  },
};

export default meta;
type Story = StoryObj<typeof DeleteChatSessionDialog>;

/** A titled chat: the question quotes it. */
export const Default: Story = {};

/** An untitled chat: V1 asks about "this chat session" rather than quoting a fallback. */
export const Untitled: Story = { args: { sessionTitle: "" } };

/** Mid-request: both buttons disabled. */
export const Busy: Story = { args: { isBusy: true } };

/** The daemon refused, with the reason where Delete was pressed. */
export const Refused: Story = { args: { error: "session is still generating" } };
