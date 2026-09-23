import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { PlanRevisionSheet, type PlanRevisionSheetProps } from "./PlanRevisionSheet";

const REVISION = [
  "# Port the chat dialogs",
  "",
  "## Problem",
  "",
  "The chat search dialog is a plain `Dialog`, so it misses the shell's focus and Escape contract.",
  "",
  "## Solution",
  "",
  "- Rebuild it on `DialogShell` in the component library.",
  "- Keep the app's `chat-search-result` test ids.",
  "",
  "## Tests",
  "",
  "| Test | Covers |",
  "| --- | --- |",
  "| `chat-view.test.tsx` | search, delete |",
].join("\n");

/**
 * A plan's latest revision, opened from a Pull Requests row. V1's
 * `Apps/PullRequest/PullRequestApp.cs:37`.
 *
 * The revision is read over IPC, so there are loading and error states V1 does not have. Each story
 * starts open and carries a trigger to reopen it.
 */
const meta: Meta<typeof PlanRevisionSheet> = {
  title: "Sheets/PlanRevisionSheet",
  component: PlanRevisionSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof PlanRevisionSheet>;

function Trigger(props: Omit<PlanRevisionSheetProps, "open" | "onClose">) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="plan-sheet-story-trigger"
      >
        View plan
      </Button>
      <PlanRevisionSheet {...props} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** The revision, rendered as the plan page renders it. */
export const Default: Story = {
  render: () => <Trigger planId="00412" planTitle="Port the chat dialogs" revision={REVISION} />,
};

/** The read is still out. */
export const Loading: Story = {
  render: () => <Trigger planId="00412" planTitle="Port the chat dialogs" revision={null} />,
};

/** No revision on disk: V1's "Plan not found or empty.". */
export const NotFound: Story = {
  render: () => <Trigger planId="00412" planTitle="Port the chat dialogs" revision="" />,
};

/** The read failed, with the daemon's reason. */
export const ReadFailed: Story = {
  render: () => (
    <Trigger
      planId="00412"
      planTitle="Port the chat dialogs"
      revision={null}
      error="PLAN_NOT_FOUND: no plan folder for 00412"
    />
  ),
};

/** A long plan with a long title: the header truncates and stays put while the body scrolls. */
export const LongContent: Story = {
  render: () => (
    <Trigger
      planId="00413"
      planTitle="Split every connected dialog into a presentational component and a thin app wrapper"
      revision={Array.from({ length: 12 }, () => REVISION).join("\n\n")}
    />
  ),
};
