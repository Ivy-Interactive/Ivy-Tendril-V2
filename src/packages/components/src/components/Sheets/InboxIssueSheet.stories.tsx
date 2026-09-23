import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { InboxIssueSheet, type InboxIssueSheetProps, type InboxSheetItem } from "./InboxIssueSheet";

const ISSUE: InboxSheetItem = {
  number: 1184,
  title: "Chat search dialog loses its query when a new chat arrives",
  repoLabel: "Ivy-Interactive/Ivy-Tendril",
  assignees: ["nielsbosma", "octocat"],
  labels: ["bug", "chat", "good first issue"],
  url: "https://github.com/Ivy-Interactive/Ivy-Tendril/issues/1184",
  body: [
    "When a chat is created while the search dialog is open, the list re-renders and the query",
    "resets.",
    "",
    "## Steps",
    "",
    "1. Open **Search Chats** from the Chats section.",
    "2. Type `deploy`.",
    "3. Start a chat from another window.",
    "",
    "```ts",
    "const results = filterChatSessions(sessions, query);",
    "```",
  ].join("\n"),
};

/**
 * The Inbox's details sheet: V1's issue sheet (`Apps/Inbox/ContentView.cs:166`) and review sheet
 * (`:202`) in one component, told apart by `kind`.
 *
 * Every story starts open and carries a trigger to reopen it, because a sheet rendered bare shows
 * something the app never displays.
 */
const meta: Meta<typeof InboxIssueSheet> = {
  title: "Sheets/InboxIssueSheet",
  component: InboxIssueSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof InboxIssueSheet>;

function Trigger(props: Omit<InboxIssueSheetProps, "item" | "onClose"> & { item: InboxSheetItem }) {
  const { item, ...rest } = props;
  const [open, setOpen] = React.useState(true);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="inbox-sheet-story-trigger"
      >
        View details
      </Button>
      <InboxIssueSheet {...rest} item={open ? item : null} onClose={() => setOpen(false)} />
    </div>
  );
}

const noop = () => {};

/** An assigned issue with nothing pending: GitHub, and Fire off in Tendril. */
export const Issue: Story = {
  render: () => <Trigger kind="issue" item={ISSUE} onOpenGitHub={noop} onFireOff={noop} />,
};

/** An auto-accept proposal is waiting: Accept and Dismiss take Fire off's place. */
export const IssueWithProposal: Story = {
  render: () => (
    <Trigger
      kind="issue"
      item={ISSUE}
      onOpenGitHub={noop}
      proposal={{ project: "Ivy-Tendril" }}
      onAccept={noop}
      onDismiss={noop}
    />
  ),
};

/** The decision is in flight: both buttons disabled until it answers. */
export const IssueDeciding: Story = {
  render: () => (
    <Trigger
      kind="issue"
      item={ISSUE}
      onOpenGitHub={noop}
      proposal={{ project: "Ivy-Tendril" }}
      isDeciding
      onAccept={noop}
      onDismiss={noop}
    />
  ),
};

/** No body, no labels, no assignees and no url: the smallest sheet there is. */
export const IssueEmpty: Story = {
  render: () => (
    <Trigger
      kind="issue"
      item={{ number: 7, title: "Untriaged", body: "", assignees: [], labels: [] }}
      onOpenGitHub={noop}
      onFireOff={noop}
    />
  ),
};

/** A review request: one primary Open on GitHub, and no labels row. */
export const ReviewRequest: Story = {
  render: () => (
    <Trigger
      kind="review"
      item={{
        ...ISSUE,
        number: 402,
        title: "feat(chat): search dialog on DialogShell",
        url: "https://github.com/Ivy-Interactive/Ivy-Tendril/pull/402",
      }}
      onOpenGitHub={noop}
    />
  ),
};

/** A long body, to show the header stays put while the body scrolls. */
export const LongBody: Story = {
  render: () => (
    <Trigger
      kind="issue"
      item={{
        ...ISSUE,
        body: Array.from(
          { length: 30 },
          (_, i) => `### Section ${i + 1}\n\nA paragraph of reproduction notes, logs and guesses.`,
        ).join("\n\n"),
      }}
      onOpenGitHub={noop}
      onFireOff={noop}
    />
  ),
};
