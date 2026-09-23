import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { JobCostSheet, type JobCostFacts, type JobCostSheetProps } from "./JobCostSheet";

function facts(overrides: Partial<JobCostFacts> = {}): JobCostFacts {
  return {
    type: "ExecutePlan",
    model: "claude-opus-5",
    provider: "claude",
    executionProfile: "default",
    tokens: 148213,
    cost: 1.9042,
    costSource: "agent",
    inputTokens: 92140,
    outputTokens: 31880,
    cacheReadTokens: 21400,
    cacheWriteTokens: 2793,
    ...overrides,
  };
}

/**
 * The trigger the Jobs table gives this sheet: its Cost and Tokens cells. Open on load, so the
 * story shows the sheet; closing it leaves the button to open it again, as a cell click would.
 */
function WithTrigger(props: Omit<JobCostSheetProps, "isOpen" | "onClose">) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="p-4">
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="job-cost-story-trigger">
        Open Cost &amp; Tokens
      </Button>
      <JobCostSheet {...props} isOpen={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/**
 * V1's Cost & Tokens sheet, opened by the Cost *and* Tokens cells of the jobs table.
 *
 * Every details row is kept and dashed when empty, as V1 does, so which facts the sheet reports is
 * the same for every job and a blank Profile reads as "none recorded" rather than as a row the
 * reader has to notice is missing. The breakdown table is the sum of what was reported; `tokens` is
 * the daemon's own total, and they agree only on a job with a full breakdown — which is why the
 * partial cases below are worth looking at.
 */
const meta: Meta<typeof JobCostSheet> = {
  title: "Sheets/JobCostSheet",
  component: JobCostSheet,
  parameters: { layout: "fullscreen" },
  args: { title: "Cost & Tokens — 00412" },
  render: (args) => <WithTrigger {...args} />,
};

export default meta;
type Story = StoryObj<typeof JobCostSheet>;

/** A fully reported run: every bucket present, the breakdown agrees with the total, and the agent
 *  quoted its own charge. */
export const FullBreakdown: Story = {
  args: { job: facts() },
};

/**
 * A flat-rate subscription. The cost is left empty rather than zeroed when a run cannot be priced,
 * so the tokens are still on record without inventing a number.
 */
export const NoCostRecorded: Story = {
  args: { job: facts({ cost: undefined, costSource: undefined }) },
};

/** An estimate rather than a billed figure, which the sheet marks with a leading `~`. */
export const EstimatedCost: Story = {
  args: { job: facts({ costSource: "estimated" }) },
};

/**
 * No breakdown at all — only the daemon's total. This is the case the fallback exists for: with no
 * buckets the total is all there is to show, rather than a table of zeros.
 */
export const TotalOnly: Story = {
  args: {
    job: facts({
      inputTokens: undefined,
      outputTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    }),
  },
};

/**
 * Cache writes absent rather than zero. "No cache writes" and "cache writes not recorded" are
 * different facts and only one of them earns a row, which is what the bucket builder decides.
 */
export const PartialBuckets: Story = {
  args: { job: facts({ cacheWriteTokens: undefined, reasoningTokens: 8120 }) },
};

/** Nothing recorded at all, where every row dashes. */
export const NothingRecorded: Story = {
  args: { title: "Cost & Tokens", job: { type: "CreatePlan" } },
};

/** The detail read is still out, so the sheet says so rather than showing a table of blanks. */
export const Pending: Story = {
  args: { job: undefined },
};
