import type { Job } from "../../types/api";
import { NO_VALUE, formatCost, formatTimeSpan, formatTokens } from "../../utils/format";

/**
 * `JobsApp.Helpers.cs`' formatters, and the two placeholders they answer with. Each is a pure
 * function of a job field, which is why they sit apart from the table that renders them: {@link
 * JobRow} is built from these, the column cells call four of them directly, and the tests drive
 * them without mounting anything.
 *
 * The scalar half of this file moved to `utils/format.ts`, because `PullRequestsView` and the
 * Dashboard's KPI builder each carried their own drifted copy of the token ladder and nothing under
 * `utils/` may reach into `views/`. What stays here is what takes a `Job` and answers with a cell.
 */

/** Ceiling on the Prompt cell, from `JobsApp.Helpers.cs` `PromptDisplayMaxLength`. */
const PROMPT_DISPLAY_MAX_LENGTH = 500;

/**
 * Re-exported rather than re-homed. `columns.tsx`, `rows.tsx` and `JobsView`'s public surface all
 * reach the Jobs table's vocabulary through this module, and which of its pieces happen to be shared
 * with the Dashboard is an implementation detail those callers have no reason to track.
 */
export { NO_VALUE, formatTimeSpan, formatTokens };

/** `FormatTimer` / `FormatTimestamp` both use this placeholder for "not applicable yet". */
export const NO_TIME = "-";

/**
 * The Cost cell, `JobsApp.Data.cs` `FormatJobCost`.
 *
 * `null` where V1 returns `""`: the job has no cost figure at all. An estimate derived from tokens
 * times the price list carries V1's `"~"` prefix (`JobCostSources.Estimated`) so a figure nobody was
 * billed never presents itself as one.
 *
 * The comparison is case-insensitive on purpose. Both V1 (`JobUsageSnapshot.cs:22`) and the daemon
 * (`jobs/manager.rs:2909`) write the lower-case `"estimated"`, so an exact match against
 * `"Estimated"` never fires and silently drops the tilde. `JobSessionView` had exactly that bug and
 * is fixed alongside this.
 */
export function formatJobCost(job: Pick<Job, "cost" | "costSource">): string | null {
  if (job.cost === undefined || job.cost === null || !Number.isFinite(job.cost)) return null;
  const formatted = formatCost(job.cost);
  return job.costSource?.toLowerCase() === "estimated" ? `~${formatted}` : formatted;
}

/** `JobsApp.Helpers.cs` `CleanPromptText`: newlines become spaces and runs of space collapse. */
function cleanPromptText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `JobsApp.Helpers.cs` `FlattenMarkdownLinks`: `[label](href)` keeps the label. */
export function flattenMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1");
}

/** `JobsApp.Helpers.cs` `TruncatePrompt`. */
export function truncatePrompt(text: string | undefined): string {
  const cleaned = flattenMarkdownLinks(cleanPromptText(text ?? ""));
  return cleaned.length > PROMPT_DISPLAY_MAX_LENGTH
    ? `${cleaned.slice(0, PROMPT_DISPLAY_MAX_LENGTH)}...`
    : cleaned;
}

/**
 * `JobsApp.Helpers.cs` `GetStatusMessage`: the job's own message where it has one, otherwise V1's
 * per-status default. Running and Completed have none, and neither does **Pending** - V1's table
 * leaves that cell empty. `JobSessionView` does give Pending a line, because the sheet it replaced
 * (`OutputSheet.cs:42-47`) has one; the table is the surface being ported here, so it does not.
 */
export function jobStatusMessage(job: Pick<Job, "status" | "statusMessage">): string {
  if (job.statusMessage) return job.statusMessage;
  switch (job.status) {
    case "Blocked":
      return "Waiting for dependency plans to complete.";
    case "Failed":
      return "Job encountered an error during execution";
    case "Timeout":
      return "Job exceeded the configured timeout";
    case "Queued":
      return "Waiting for a job slot to become available";
    case "Stopped":
      return "Job was manually stopped";
    default:
      return "";
  }
}

/**
 * The Agent Output cell's three states, from `JobsApp.Helpers.cs` `FormatAgentOutput`:
 * `AnimatedStatusValue.Running(...)` while running, `Done` on completion and `Idle("-")` otherwise.
 *
 * The state picks the animation and the colour; {@link agentOutputLabel} picks the text. V1 packs both
 * into one string because `AnimatedStatusValue` is a rendered value on a wire; here they are separate
 * because the cell is a component and the column still has to sort by something a database can express.
 */
export type AgentOutputState = "running" | "done" | "idle";

/**
 * V1's label when a running job has produced no output yet — `FormatAgentOutput`'s own fallback for a
 * null `LastOutputAt`, which is the state a job is in between its launch and its first line.
 */
export const AGENT_OUTPUT_STARTING = "Starting...";

/**
 * The Agent Output cell's text, `JobsApp.Helpers.cs` `FormatAgentOutput`.
 *
 * This column is a **staleness gauge, not a status message**: a running job shows how long it has been
 * since the agent last wrote a line, so a cell reading `4m 12s` is the signal that something has gone
 * quiet. The job's own status message has its own column (see {@link jobStatusMessage}), exactly as it
 * does in V1 — the two answer different questions and V1 streams both.
 *
 * `lastOutputAt` is stamped by the daemon at most once every five seconds, so the figure can read up to
 * five seconds short of the true silence. That is the whole reason the column is affordable: the
 * alternative is one SQLite write per output line.
 */
export function agentOutputLabel(job: Pick<Job, "status" | "lastOutputAt">, now: number): string {
  if (job.status === "Running") {
    const lastOutput = job.lastOutputAt ? Date.parse(job.lastOutputAt) : NaN;
    if (Number.isNaN(lastOutput)) return AGENT_OUTPUT_STARTING;
    return formatTimeSpan((now - lastOutput) / 1000);
  }
  if (job.status === "Completed") return "Done";
  return NO_TIME;
}

/** `JobsApp.Helpers.cs` `TimestampFormat`: `"MM-dd HH:mm"`, local time. */
export function formatMonthDayTime(epochMs: number): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return NO_TIME;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}
