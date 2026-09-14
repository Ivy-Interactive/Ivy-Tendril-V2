import type { Job } from "../types/api";
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
