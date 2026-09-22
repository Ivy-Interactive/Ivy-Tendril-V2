import { formatCost, formatTokens, formatTimeSpan, NO_VALUE } from "@ivy-interactive/components";
import { formatDateTime } from "@ivy-interactive/components/i18n";
import { i18n, type TFunction } from "../../i18n";
import type { Job } from "../../types/api";

/**
 * `JobsApp.Helpers.cs`' formatters, and the two placeholders they answer with. Each is a pure
 * function of a job field, which is why they sit apart from the table that renders them: {@link
 * JobRow} is built from these, the column cells call four of them directly, and the tests drive
 * them without mounting anything.
 *
 * `formatCost`, `formatTokens`, `formatTimeSpan` and `NO_VALUE` are the shared, V1-parity
 * implementations from `@ivy-interactive/components` (`lib/formatters.ts`); re-exported here so
 * this module keeps its existing public names and {@link JobsView} does not have to change what it
 * imports from it.
 */
export { formatTimeSpan, formatTokens, NO_VALUE };

/**
 * The `jobs` namespace's `t` for the helpers in this folder, which run outside React. It translates
 * into the language current at each call, so it is safe to hold at module level; a component that
 * memoizes one of these helpers' output passes its own `t` instead, so the memo recomputes when the
 * language changes.
 */
export const jobsT: TFunction<"jobs"> = i18n.getFixedT(null, "jobs");

/** Ceiling on the Prompt cell, from `JobsApp.Helpers.cs` `PromptDisplayMaxLength`. */
const PROMPT_DISPLAY_MAX_LENGTH = 500;

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
export function formatJobCost(
  job: Pick<Job, "cost" | "costSource">,
  t: TFunction<"jobs"> = jobsT,
): string | null {
  if (job.cost === undefined || job.cost === null || !Number.isFinite(job.cost)) return null;
  const formatted = formatCost(job.cost);
  return job.costSource?.toLowerCase() === "estimated"
    ? t("cost.estimated", { cost: formatted })
    : formatted;
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
export function jobStatusMessage(
  job: Pick<Job, "status" | "statusMessage">,
  t: TFunction<"jobs"> = jobsT,
): string {
  // The daemon's own message is shown as it came: it is the daemon's text, in the daemon's language.
  if (job.statusMessage) return job.statusMessage;
  switch (job.status) {
    case "Blocked":
      return t("statusMessage.blocked");
    case "Failed":
      return t("statusMessage.failed");
    case "Timeout":
      return t("statusMessage.timeout");
    case "Queued":
      return t("statusMessage.queued");
    case "Stopped":
      return t("statusMessage.stopped");
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
 *
 * The English text, which is what the tests hold the cell to. What the cell shows is
 * `jobs:agentOutput.starting`, in the current language; this constant is never rendered.
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
export function agentOutputLabel(
  job: Pick<Job, "status" | "lastOutputAt">,
  now: number,
  t: TFunction<"jobs"> = jobsT,
): string {
  if (job.status === "Running") {
    const lastOutput = job.lastOutputAt ? Date.parse(job.lastOutputAt) : NaN;
    if (Number.isNaN(lastOutput)) return t("agentOutput.starting");
    return formatTimeSpan((now - lastOutput) / 1000);
  }
  if (job.status === "Completed") return t("agentOutput.done");
  return NO_TIME;
}

/**
 * The month, day and 24-hour time, two digits each, in the order and with the separators of the
 * current language: "03/04, 15:04" in English, "04.03., 15:04" in German, "03/04 15:04" in Japanese.
 */
const MONTH_DAY_TIME: Intl.DateTimeFormatOptions = {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

/**
 * `JobsApp.Helpers.cs` `TimestampFormat` (`"MM-dd HH:mm"`, local time), in the current language's
 * own field order and separators. The Timestamp cell and the job session header both show it.
 *
 * No `Intl` option reproduces V1's `MM-dd HH:mm` exactly, so English now reads "03/04, 15:04" (the
 * guide's rule: no English-only formatting path). Most other languages write the day first, where a
 * fixed "03-04" would read as the 3rd of April.
 */
export function formatMonthDayTime(epochMs: number): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return NO_TIME;
  return formatDateTime(date, MONTH_DAY_TIME);
}
