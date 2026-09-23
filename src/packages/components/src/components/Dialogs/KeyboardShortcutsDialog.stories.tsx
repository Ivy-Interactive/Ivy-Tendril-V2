import type { Meta, StoryObj } from "@storybook/react";
import { KeyboardShortcutsDialog, type KeyboardShortcutEntry } from "./KeyboardShortcutsDialog";

const entry = (
  id: string,
  displayKey: string,
  description: string,
  isActive = true,
): KeyboardShortcutEntry => ({ id, displayKey, description, isActive });

/**
 * The keyboard shortcut help, opened with `?`. V2 only.
 *
 * It lists what the shortcut registry holds when it opens, sorted by description. A shortcut whose
 * view is mounted but not in front is registered and inactive, and renders dimmed. Key caps follow
 * the platform: `Ctrl` reads `⌘` on a Mac.
 */
const meta: Meta<typeof KeyboardShortcutsDialog> = {
  title: "Dialogs/KeyboardShortcutsDialog",
  component: KeyboardShortcutsDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
};

export default meta;
type Story = StoryObj<typeof KeyboardShortcutsDialog>;

/** What the shell registers on the Plans page, out of order to show the sort. */
export const Default: Story = {
  args: {
    shortcuts: [
      entry("search", "Ctrl+K", "Search plans"),
      entry("help", "?", "Show keyboard shortcuts"),
      entry("new-plan", "Ctrl+N", "New plan"),
      entry("toggle-sidebar", "Ctrl+B", "Toggle sidebar"),
      entry("new-chat", "Ctrl+Alt+A", "New chat"),
    ],
  },
};

/** Registered but not live right now: dimmed, and marked `aria-disabled`. */
export const SomeInactive: Story = {
  args: {
    shortcuts: [
      entry("help", "?", "Show keyboard shortcuts"),
      entry("approve", "Ctrl+Enter", "Approve plan", false),
      entry("next-question", "Ctrl+J", "Next question", false),
      entry("search", "Ctrl+K", "Search plans"),
    ],
  },
};

/** Nothing registered, which only a test harness or a broken boot would show. */
export const Empty: Story = { args: { shortcuts: [] } };
