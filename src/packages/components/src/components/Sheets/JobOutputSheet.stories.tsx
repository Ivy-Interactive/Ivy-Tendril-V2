import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { JobOutputSheet, type JobOutputSheetProps } from "./JobOutputSheet";

/** A job row click, which is what opens the output sheet over the Jobs table. Open on load. */
function WithTrigger(props: Omit<JobOutputSheetProps, "isOpen" | "onClose">) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="p-4">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="job-output-story-trigger"
      >
        Open job output
      </Button>
      <JobOutputSheet {...props} isOpen={open} onClose={() => setOpen(false)} />
    </div>
  );
}

const FAKE_LOG = [
  "▸ Read plan.yaml",
  "▸ Read src/apps/tendril-app/src/views/JobsView.tsx",
  "  The row menu's Rerun entry is disabled with RERUN_UNAVAILABLE_REASON.",
  "▸ Edit crates/tendril-server/src/routes/jobs.rs",
  "  + pub async fn rerun_job(...)",
  "▸ Bash cargo check -p tendril-server",
  "  Finished `dev` profile [unoptimized] target(s) in 58.10s",
  "▸ Edit src/apps/tendril-app/src/views/jobs/rows.tsx",
  "✓ Verification RustBuild passed",
];

/**
 * A static stand-in for the app's body. The real one is `JobSessionView`, which is connected - it
 * streams the agent's events through the bridge - so it cannot render here; the sheet is chrome,
 * and this shows what it gives a body: the full height of the panel, unscrolled, so the body's own
 * scroller and footer sit where they should.
 */
function FakeOutputBody({ lines = FAKE_LOG }: { lines?: string[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 text-xs text-muted-foreground">
        <span className="font-mono font-bold">01184</span>
        <span>Split the connected dialogs</span>
      </div>
      <pre className="m-4 min-h-0 flex-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">
        {lines.join("\n")}
      </pre>
      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Tokens 148,213 · Cost $1.9042 · Elapsed 27m 53s
      </div>
    </div>
  );
}

/**
 * V1's output sheet (`Apps/Jobs/Sheets/OutputSheet.cs`) as chrome: the panel, the title V1 builds
 * from the job's type and plan id, and the unscrolled box the output fills. The app hands it the
 * connected body; V1's callouts for a job that has produced nothing are the sheet's own.
 */
const meta: Meta<typeof JobOutputSheet> = {
  title: "Sheets/JobOutputSheet",
  component: JobOutputSheet,
  parameters: { layout: "fullscreen" },
  args: { title: "ExecutePlan 00412" },
  render: (args) => <WithTrigger {...args} />,
};

export default meta;
type Story = StoryObj<typeof JobOutputSheet>;

/** A job with output: the body fills the sheet. */
export const WithOutput: Story = {
  render: (args) => (
    <WithTrigger {...args}>
      <FakeOutputBody />
    </WithTrigger>
  ),
};

/** A very long log, which scrolls inside the body while the title stays put. */
export const LongOutput: Story = {
  render: (args) => (
    <WithTrigger {...args}>
      <FakeOutputBody
        lines={Array.from({ length: 30 }, (_, i) => FAKE_LOG.map((l) => `${i + 1}: ${l}`)).flat()}
      />
    </WithTrigger>
  ),
};

/** `OutputSheet.cs:36-40`: a Blocked job with no message of its own gets V1's sentence. */
export const Blocked: Story = {
  args: { status: { status: "Blocked" } },
};

/** `OutputSheet.cs:42-47`: a Pending job gets "Job is queued and waiting to start." */
export const Pending: Story = {
  args: { status: { status: "Pending" } },
};

/** `OutputSheet.cs:28-33`: the job's own message under `$"Job {job.Status}"`; red for a failure. */
export const FailedWithMessage: Story = {
  args: {
    status: {
      status: "Failed",
      message: "RustClippy failed: 2 warnings denied in tendril-core::agents::providers",
    },
  },
};

/** A job the service no longer has, or one that stopped before saying anything. */
export const NoOutput: Story = {
  args: { title: "Job Output" },
};

/** The body's chunk is still arriving. */
export const Loading: Story = {
  args: { loading: true },
};
