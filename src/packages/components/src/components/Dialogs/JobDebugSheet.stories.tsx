import type { Meta, StoryObj } from "@storybook/react";
import { JobDebugSheet, type JobDebugDetail } from "./JobDebugSheet";

function job(overrides: Partial<JobDebugDetail> = {}): JobDebugDetail {
  return {
    id: "1184",
    type: "ExecutePlan",
    planId: "00412",
    planTitle: "Split the connected dialogs",
    project: "Ivy-Tendril-V2",
    status: "Completed",
    startedAt: "2026-09-22T09:14:02Z",
    completedAt: "2026-09-22T09:41:55Z",
    provider: "claude",
    workingDirectory: "/home/dev/.tendril/Plans/00412-SplitTheConnectedDialogs/Worktrees/main",
    planFolder: "/home/dev/.tendril/Plans/00412-SplitTheConnectedDialogs",
    ...overrides,
  };
}

/**
 * V1's `Apps/Views/Sheets/JobDebugSheet.cs`: the details table behind a job row's Debug action,
 * and its Copy Details button.
 *
 * The only sheet V2 has so far, against V1's twelve, and it had no coverage of any kind before
 * this. Unlike the dialogs it takes no `isOpen`/`onClose` — it is a sheet *body*, rendered inside a
 * host that owns the open state, so it owes none of `DialogShell`'s contract.
 *
 * Every field is rendered only when present, so these stories are about how much of the table
 * exists at each point in a job's life.
 */
const meta: Meta<typeof JobDebugSheet> = {
  title: "Dialogs/JobDebugSheet",
  component: JobDebugSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof JobDebugSheet>;

/** A job still going: no completion time, and no artifacts written yet. */
export const RunningJob: Story = {
  args: {
    job: job({
      status: "Running",
      completedAt: undefined,
      lastOutputAt: "2026-09-22T09:20:31Z",
    }),
  },
};

/** The full table: a finished run with every artifact on disk. */
export const CompletedWithArtifacts: Story = {
  args: {
    job: job({
      cliCommand: "claude --permission-mode acceptEdits --model claude-opus-5",
      args: '{"folderPath":"/home/dev/.tendril/Plans/00412-SplitTheConnectedDialogs"}',
      tokens: 148213,
      cost: 1.9042,
      model: "claude-opus-5",
      agent: "claude",
      jobLogPath: "/home/dev/.tendril/Jobs/1184-00412-ExecutePlan/job.log",
      jobPromptPath: "/home/dev/.tendril/Jobs/1184-00412-ExecutePlan/prompt.md",
      jobRawLogPath: "/home/dev/.tendril/Jobs/1184-00412-ExecutePlan/raw.log",
      jobEventwirePath: "/home/dev/.tendril/Jobs/1184-00412-ExecutePlan/eventwire.jsonl",
    }),
  },
};

/** A failure, where `reportedFailureReason` is the field the operator actually came for. */
export const FailedWithReason: Story = {
  args: {
    job: job({
      status: "Failed",
      reportedFailureReason:
        "RustClippy failed: 2 warnings denied in tendril-core::agents::providers",
      jobLogPath: "/home/dev/.tendril/Jobs/1184-00412-ExecutePlan/job.log",
    }),
  },
};

/**
 * Permission denials. These are why `resolve_agent` matters: a launch config built without it gets
 * no tool allow-list, and the run then trips a restrictive permission mode.
 */
export const WithPermissionDenials: Story = {
  args: {
    job: job({
      status: "Failed",
      permissionDenials: [
        "Bash(cargo build --workspace)",
        "Write(/repos/Ivy-Tendril-V2/src/crates/tendril-core/src/lib.rs)",
        "Bash(git push origin development)",
      ],
    }),
  },
};

/** A job that has not said anything yet — V1 renders this as "Starting...". */
export const NoOutputYet: Story = {
  args: {
    job: job({
      status: "Queued",
      startedAt: undefined,
      completedAt: undefined,
      lastOutputAt: undefined,
    }),
  },
};

/**
 * A long `args` blob, which is why the sheet uses `HeaderLayout`: the actions stay put while it
 * scrolls underneath them.
 */
export const LongArgsBlob: Story = {
  args: {
    job: job({
      args: JSON.stringify(
        {
          folderPath: "/home/dev/.tendril/Plans/00412-SplitTheConnectedDialogs",
          repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework", "/repos/Ivy-Tendril"],
          verifications: ["NpmBuild", "NpmLint", "NpmTest", "RustBuild", "RustClippy", "RustTest"],
          executionProfile: "default",
        },
        null,
        2,
      ),
    }),
  },
};
