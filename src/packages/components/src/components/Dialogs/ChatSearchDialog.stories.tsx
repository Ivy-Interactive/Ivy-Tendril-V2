import type { Meta, StoryObj } from "@storybook/react";
import { ChatSearchDialog, type ChatSearchSession } from "./ChatSearchDialog";

const session = (
  id: string,
  title: string,
  updatedAt: string,
  isTerminal = false,
): ChatSearchSession => ({ id, title, updatedAt, isTerminal });

const SESSIONS: ChatSearchSession[] = [
  session("s-1", "Deploy the daemon to staging", "2026-09-22T16:40:00Z"),
  session("s-2", "Why is the jobs table empty?", "2026-09-21T09:12:00Z"),
  session("s-3", "Terminal", "2026-09-20T11:03:00Z", true),
  session("s-4", "Port the chat search dialog", "2026-09-18T14:55:00Z"),
  session("s-5", "Plan 00412 follow-up questions", "2026-09-02T08:30:00Z"),
];

/**
 * Search over chat titles, opened from the Chats sidebar section's search icon. V1's
 * `Apps/Chat/Dialogs/ChatSearchDialog.cs`.
 *
 * The match is synchronous over a list the app already holds, so there is no loading or error
 * state: an empty box lists the fifteen most recent chats, and a query that matches nothing reads
 * "No chats found.". Type in the box to filter.
 */
const meta: Meta<typeof ChatSearchDialog> = {
  title: "Dialogs/ChatSearchDialog",
  component: ChatSearchDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onSelectSession: () => {}, sessions: SESSIONS },
};

export default meta;
type Story = StoryObj<typeof ChatSearchDialog>;

/** The state it opens in: every chat, newest first, a terminal session marked by its icon. */
export const Default: Story = {};

/** Twenty-five chats against the 15-row cap (V1's `.Take(15)`), so the cap is visible. */
export const ManyChats: Story = {
  args: {
    sessions: Array.from({ length: 25 }, (_, i) =>
      session(
        `s-${i}`,
        `Conversation number ${i + 1} about a fairly long subject that has to truncate`,
        new Date(Date.UTC(2026, 8, 22 - i)).toISOString(),
        i % 7 === 3,
      ),
    ),
  },
};

/** No chats at all: the empty message shows even before anything is typed, as in V1. */
export const NoChats: Story = { args: { sessions: [] } };
