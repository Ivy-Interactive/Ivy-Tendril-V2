import type { StackedProgressColor } from "@ivy-interactive/components/ui";
import type { Job, JobStatus } from "../types/api";
import type { ChatMessage } from "../types/chat";
import { formatSystemEvent } from "./systemEvents";

export const isRunningJob = (job: Job): boolean =>
  job.status === "Running" ||
  job.status === "Pending" ||
  job.status === "Queued" ||
  job.status === "Blocked";

export const isCompletedJob = (job: Job): boolean => job.status === "Completed";

export const isFailedJob = (job: Job): boolean =>
  job.status === "Failed" || job.status === "Timeout" || job.status === "Stopped";

export type JobDisplayState = "running" | "completed" | "failed" | "unknown";

/**
 * Resolves the display state for a job by checking the live job list first, then falling back to
 * terminal system-event messages in the history. Returns "unknown" if the job cannot be found or
 * carries an unrecognised status.
 */
export function resolveJobState(
  jobId: string | undefined,
  jobs: Job[],
  messages: ChatMessage[],
): JobDisplayState {
  if (!jobId) return "unknown";

  const job = jobs.find((j) => j.id === jobId);
  if (job) {
    if (isCompletedJob(job)) return "completed";
    if (isFailedJob(job)) return "failed";
    if (isRunningJob(job)) return "running";
    return "unknown";
  }

  // The job may have aged out of the live list; its completion is still in the transcript.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "system") {
      const view = formatSystemEvent(msg.content);
      if (view.jobId === jobId && (view.kind === "completed" || view.kind === "failed")) {
        return view.kind;
      }
    }
  }

  return "unknown";
}

/**
 * `Constants.JobStatusColors` (`src/Ivy.Tendril/Constants.cs:54-64`), value for value.
 *
 * V1 renders the Status cell through a `LabelsDisplayRenderer` whose `BadgeColorMapping` is this
 * dictionary (`JobsApp.DataTable.cs:61-67`), so a status's colour *is* its name here. The design system
 * publishes one token per Ivy colour (`styles/tokens.css`) and `Badge`'s `color` prop tints from it, so
 * these are V1's colours rather than an approximation of them — including the two that no semantic
 * token could tell apart: Queued/Pending **Amber** and Blocked **Orange**.
 */
export const JOB_STATUS_COLOR: Record<JobStatus, string> = {
  Running: "Blue",
  Completed: "Green",
  Failed: "Red",
  Timeout: "Red",
  Queued: "Amber",
  Pending: "Amber",
  Stopped: "Gray",
  Blocked: "Orange",
};

/**
 * `Constants.JobTypeColors` (`Constants.cs:66-79`), the Type column's `BadgeColorMapping`
 * (`JobsApp.DataTable.cs:68-74`). Eleven job types, eleven hues.
 *
 * A type not listed here renders on `Slate`, which is what V1's renderer does with a value its mapping
 * has no entry for — a new job type gets a neutral chip rather than borrowing another type's colour.
 */
export const JOB_TYPE_COLOR: Record<string, string> = {
  CreatePlan: "Purple",
  ExecutePlan: "Blue",
  UpdatePlan: "Cyan",
  ExpandPlan: "Teal",
  SplitPlan: "Indigo",
  CreatePr: "Green",
  CreateIssue: "Rose",
  RetryPlan: "Orange",
  SetupProject: "Slate",
  SyncRepo: "Amber",
  AddProject: "Purple",
};

/** V1's fallback hue for a value outside a `BadgeColorMapping`. */
export const UNMAPPED_COLOR = "Slate";

/**
 * The Project column's palette.
 *
 * V1 colours each project from configuration (`ProjectHelper.BuildColorMapping(config)`, passed as the
 * Project column's `BadgeColorMapping` at `JobsApp.DataTable.cs:75-78`), so two projects are always
 * distinguishable at a glance. V2's `ProjectSummary` does not carry the configured colour — the daemon
 * has one (`bridge.createProject` sets it) and the DTO drops it — so the colour is derived from the
 * project's name instead: stable, distinct, and the same colour in every view that uses this. Reported
 * rather than worked around: the moment the DTO carries `color`, this becomes a lookup.
 */
const PROJECT_COLORS = [
  "Blue",
  "Purple",
  "Teal",
  "Amber",
  "Rose",
  "Cyan",
  "Indigo",
  "Green",
  "Orange",
  "Violet",
];

export function projectColor(project: string): string {
  let hash = 0;
  for (let index = 0; index < project.length; index += 1) {
    // The classic 31-multiplier string hash. Deterministic and stable across runs, which is the only
    // property that matters: a project whose colour changed between renders would be worse than grey.
    hash = (hash * 31 + project.charCodeAt(index)) | 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

/** The same mapping for the header's `StackedProgress` segments (`JobsApp.Data.cs` `GetStatusColor`). */
export const JOB_STATUS_SEGMENT_COLOR: Record<JobStatus, StackedProgressColor> = {
  Running: "info",
  Completed: "success",
  Failed: "destructive",
  Timeout: "destructive",
  Queued: "warning",
  Pending: "warning",
  Blocked: "warning",
  Stopped: "muted",
};
