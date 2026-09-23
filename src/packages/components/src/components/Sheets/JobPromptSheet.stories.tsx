import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { JobPromptSheet, type JobPromptSheetProps } from "./JobPromptSheet";

/** The Jobs table's Prompt cell, which is what opens this sheet. Open on load. */
function WithTrigger(props: Omit<JobPromptSheetProps, "isOpen" | "onClose">) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="p-4">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="job-prompt-story-trigger"
      >
        Open Full Prompt
      </Button>
      <JobPromptSheet {...props} isOpen={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/**
 * V1's Full Prompt sheet (`Apps/Jobs/Sheets/PromptSheet.cs`): the untruncated text behind the Jobs
 * table's Prompt cell, in one wrapped code block. The cell cuts at 500 characters; this is the
 * only place the whole request is readable.
 */
const meta: Meta<typeof JobPromptSheet> = {
  title: "Sheets/JobPromptSheet",
  component: JobPromptSheet,
  parameters: { layout: "fullscreen" },
  render: (args) => <WithTrigger {...args} />,
};

export default meta;
type Story = StoryObj<typeof JobPromptSheet>;

/** A `CreatePlan` whose description is the whole request. */
export const ShortPrompt: Story = {
  args: {
    prompt: "Add a Rerun action to the Jobs table that restarts a failed job with feedback.",
  },
};

/** A long request, which wraps rather than scrolling sideways (`.WrapLines()`). */
export const LongPrompt: Story = {
  args: {
    prompt: [
      "The Jobs table's row menu offers Rerun for Failed, Timeout and Stopped jobs, but the entry is disabled because the job DTO drops TypedArgs.",
      "",
      "Port V1's RerunJobDialog: an optional feedback textarea; on confirm, delete the job and start it again from its original args with the feedback folded in — a RetryPlan change request for ExecutePlan and RetryPlan, new instructions for UpdatePlan, and an ExecutePlan of the produced plan for a CreatePlan whose plan now exists.",
      "",
      "Keep the daemon as the one place that reads the args. ".repeat(12),
    ].join("\n"),
  },
};

/** A job type with no prose of its own (`ExpandPlan`, `SplitPlan`): the sheet says so. */
export const NoPrompt: Story = {
  args: { prompt: undefined },
};
