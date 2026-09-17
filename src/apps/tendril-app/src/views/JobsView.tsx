import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bug, EllipsisVertical, Loader2, Pause, RotateCw, Trash, Zap } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HeaderLayout,
  resolveRemoteSort,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  StackedProgress,
  useRemoteDataTable,
  type DataTableColumn,
  type DataTableFilterOption,
  type DataTableRowAction,
  type RemoteSortColumn,
  type RemoteTableFetcher,
  type RemoteTableFilter,
  type StackedProgressSegment,
  dataTableLinkClass,
  useResponsiveDensity,
  whereColumn,
  Densities,
} from "@ivy-interactive/components/ui";
import { fetchTableColumnValues, queryJobsPage } from "../api/tableQuery";
import { describeBridgeError, type Job, type JobDetail, type JobStatus } from "../types/api";
import { isActiveStatus, jobsStore } from "../state/jobsStore";
import {
  JOB_STATUS_COLOR,
  JOB_STATUS_SEGMENT_COLOR,
  JOB_TYPE_COLOR,
  UNMAPPED_COLOR,
  projectColor,
} from "../utils/jobStatus";
import { ConfirmDialog } from "./dialogs";
import { parseProjects } from "./PlansView";

/**
 * V1's Jobs table, as a table.
 *
 * `Apps/Jobs/JobsApp.cs` composes exactly one thing: the `DataTable` built by
 * `JobsApp.DataTable.cs`. Everything here is that table - its column set and order, its row menu,
 * its header actions and its status progress bar - over V2's shared `DataTable`, which is the
 * component the structural-parity pass exists to reach ("Tables are tables").
 *
 * What V1 has and V2 cannot yet reach is called out at each site rather than faked: the row menu's
 * Rerun (V1's `RerunJobDialog` needs `JobItem.TypedArgs`, which the Tauri DTO drops), the full-prompt
 * sheet and the Cost & Tokens sheet.
 */

/**
 * The output sheet's body. Lazy for the reason every view in this app is: it is the only thing here
 * that pulls in `AgentViewer`, and it is fetched when a row is opened rather than with the table.
 */
const JobOutput = React.lazy(() =>
  import("./JobSessionView").then((m) => ({ default: m.JobSessionView })),
);

/**
 * V1's Job Debug sheet. Lazy for the same reason as the output sheet: it is opened from one row action
 * and has no business in the table's own chunk.
 */
const JobDebug = React.lazy(() =>
  import("./JobDebugSheet").then((m) => ({ default: m.JobDebugSheet })),
);

/** Ceiling on the Prompt cell, from `JobsApp.Helpers.cs` `PromptDisplayMaxLength`. */
const PROMPT_DISPLAY_MAX_LENGTH = 500;

/**
 * `JobsApp.DataTable.cs:93`: `c.BatchSize = 50`. A job list is long and mostly history.
 *
 * In V1 this is the *infinite scroll* window, not a page: the framework's grid fetches fifty rows and
 * appends fifty more each time the visible region comes within ten of the end
 * (`widgets/dataTables/hooks/useDataLoading.ts`), and `LoadAllRows` is never set. V2's table does the
 * same through `useRemoteDataTable({ infinite: true })` and `DataTable`'s `onLoadMore`.
 */
const JOBS_PAGE_SIZE = 50;

/**
 * `JobsApp.Data.cs` / `JobCostSheet.cs` use this for "nothing recorded here", and `JobSessionView`
 * already does the same. Keeping the em dash rather than an empty cell is what stops a job that
 * reported no cost from reading as one that cost nothing: `—` and `$0.00` are different claims, and
 * a run on a subscription plan reports tokens and no charge at all.
 *
 * V1's cell is literally `""` there. The em dash is a deliberate deviation: V1's table draws a
 * visible grid, so an empty Cost cell under a `Cost` header is unambiguous, whereas V2's rows are
 * separated by whitespace and an empty cell reads as a figure that has not landed yet.
 */
const NO_VALUE = "—";

/** `FormatTimer` / `FormatTimestamp` both use this placeholder for "not applicable yet". */
const NO_TIME = "-";

/**
 * The reason V1 gives when Rerun is invoked on a job whose original arguments were not preserved
 * (`JobsApp.DataTable.cs:235`). V1 raises it as a toast after the click because `TypedArgs` is null
 * only occasionally; here it is the permanent state of every job, because `JobDto`/`JobDetailDto`
 * (`src-tauri/src/models.rs`) do not carry `typedArgs` at all, so the entry is disabled and carries
 * the reason instead of pretending to work.
 */
export const RERUN_UNAVAILABLE_REASON = "Cannot rerun: original args were not preserved.";

/** The four statuses `FormatTimer` reports a duration for. */
const FINISHED_STATUSES: readonly JobStatus[] = ["Completed", "Failed", "Timeout", "Stopped"];

/** `JobsApp.Helpers.cs` `FormatTimeSpan`: hours drop the seconds, a sub-minute span is seconds only. */
export function formatTimeSpan(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours >= 1) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes === 0) return `${secs}s`;
  return `${minutes}m ${String(secs).padStart(2, "0")}s`;
}

/** `FormatHelper.FormatTokens`: millions to one decimal, thousands to none, and it keeps scaling. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return NO_VALUE;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

/** `FormatHelper.FormatCost`: two decimals, dollars. */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

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

/**
 * The table's initial order, and V1's declared one: `.SortDirection(t => t.Id, SortDirection.Descending)`
 * (`JobsApp.DataTable.cs:85`) — newest job first.
 *
 * Executed by SQLite now rather than in the client. V1 reached the same order through
 * `OrderByDescending(ExtractJobNumber(r.Id))`, a *numeric* extraction, and `ORDER BY Id DESC` is a
 * *lexicographic* one; they agree for every id the daemon issues, because `allocate_job_id`
 * (`jobs/manager.rs:414`) formats them as `{:05}` and equal-width numeric strings sort the same either
 * way. They would diverge past job 99999, where a six-digit id sorts below a five-digit one — a real but
 * distant divergence, and one no client-side sort could fix now that the client holds a window rather
 * than the table.
 */
const JOBS_INITIAL_SORT = { column: "id", direction: "Descending" } as const;

/**
 * Each column of the table, and the `Jobs` column SQLite must order by when its header is clicked.
 *
 * `JobRow`'s field names are a *rendering*, not a schema, so four of them have to say what they mean to
 * the database. Two are renames the filter already declares (`planId` → `PlanFile`, `prompt` →
 * `ReportedPlanTitle`) and are repeated here only because `resolveRemoteSort` reads a list of names
 * rather than the rendered columns — the fetcher is built before them. Two are genuinely derived:
 *
 * - **Timer** counts up from `StartedAt` for a running job and shows the recorded duration for a
 *   finished one, so `DurationSeconds` is the closest total order the table has. Running rows have no
 *   duration yet, so they group at the `NULL` end rather than interleaving by elapsed time.
 * - **Agent Output** counts up from `LastOutputAt` for a running job, so the column has no total order
 *   of its own: `Status` is what groups the three forms the cell takes (an elapsed silence, `Done`,
 *   `-`). Ordering by `LastOutputAt` instead would be a real order over running rows and meaningless
 *   over every other row, which is the larger part of any job list. V1 cannot express it either — it
 *   sorts the rendered string.
 *
 * Everything else resolves by name: the daemon matches a column case- and underscore-insensitively, so
 * `statusMessage` reaches `StatusMessage`.
 */
const SORT_COLUMNS: RemoteSortColumn[] = [
  { name: "id" },
  { name: "status" },
  { name: "planId", sortColumn: "planFile" },
  { name: "prompt", sortColumn: "reportedPlanTitle" },
  { name: "type" },
  { name: "project" },
  { name: "timer", sortColumn: "durationSeconds" },
  { name: "agentOutput", sortColumn: "status" },
  { name: "cost" },
  { name: "tokens" },
  { name: "timestamp", sortColumn: "completedAt" },
  { name: "statusMessage" },
];

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

/**
 * One table row, mirroring `JobItemRow` (`Models/JobModels.cs:360`) field for field and in its
 * order, which is the order V1's `ToDataTable` renders the columns in.
 *
 * Two deliberate differences. `JobItemRow` is all strings because Ivy's table sorts and filters what
 * it displays; here Timer, Cost, Tokens and Timestamp keep their raw value so the column sorts
 * numerically (`45K` before `1.2M`, not after it) while the cell still renders V1's text.
 * `ErrorContext` is absent: V1 hides that column *and* disables filtering on it, so it has no
 * visible surface, and the `outputLines` it is built from are not on the DTO anyway.
 */
export interface JobRow {
  id: string;
  status: JobStatus;
  planId: string;
  prompt: string;
  type: string;
  project: string;
  /** Seconds, or `null` for V1's `"-"`. */
  timerSeconds: number | null;
  agentOutput: AgentOutputState;
  /**
   * The Agent Output cell's text: the elapsed silence for a running job, `"Done"`, or `"-"`. Kept
   * beside the state rather than derived in the cell so it is built from the same `now` the Timer is
   * and the two never disagree by a second. See {@link agentOutputLabel}.
   */
  agentOutputLabel: string;
  /** Formatted (with V1's `~` where estimated), or `null` where no figure was reported at all. */
  cost: string | null;
  /** The raw figure, so the column sorts by money rather than by the string `"$"` starts with. */
  costValue: number | null;
  tokens: number | null;
  /** The per-bucket breakdown for the cell's tooltip; `null` when the DTO carried no buckets. */
  tokenBreakdown: string | null;
  /** Epoch ms of `completedAt`, or `null` for V1's `"-"`. */
  completedAtMs: number | null;
  statusMessage: string;
  /** Whether this job's process survived a daemon restart. See {@link buildJobRows}. */
  detached: boolean;
  processId?: number;
}

/** `FormatTimer`: a running job counts up, a finished one shows how long it took. */
function timerSeconds(job: Job, now: number): number | null {
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  if (job.status === "Running" && !Number.isNaN(started)) {
    return Math.max(0, (now - started) / 1000);
  }
  if (!FINISHED_STATUSES.includes(job.status)) return null;
  // V1 reads `DurationSeconds`, which the daemon stamps on the terminal transition; the
  // completed-minus-started fallback covers a row restored from SQLite without one.
  if (job.durationSeconds !== undefined && job.durationSeconds !== null) {
    return job.durationSeconds;
  }
  const finished = job.completedAt ? Date.parse(job.completedAt) : NaN;
  if (!Number.isNaN(started) && !Number.isNaN(finished))
    return Math.max(0, (finished - started) / 1000);
  return null;
}

function agentOutputState(status: JobStatus): AgentOutputState {
  if (status === "Running") return "running";
  if (status === "Completed") return "done";
  return "idle";
}

/**
 * `FormatHelper.FormatCount` over the buckets the DTO now carries. `cacheReadTokens` dominates the
 * bill on any long run, so the short `45K` in the cell would understate what was actually spent
 * without this behind it.
 */
function tokenBreakdown(job: Job): string | null {
  const parts: string[] = [];
  const add = (label: string, value: number | undefined) => {
    if (value === undefined || value === null) return;
    parts.push(`${label} ${value.toLocaleString("en-US")}`);
  };
  add("Input", job.inputTokens);
  add("Output", job.outputTokens);
  add("Cache read", job.cacheReadTokens);
  add("Cache write", job.cacheWriteTokens);
  add("Reasoning", job.reasoningTokens);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface BuildJobRowsOptions {
  /** Wall clock for the Timer column. Injected so a test can pin it. */
  now?: number;
  /**
   * Fetched job details, keyed by id. `detached` is only ever reported by `GET /api/jobs/:id`
   * (`JobManager::supervise_detached` rehydrates it in memory and the list projection drops it), so
   * the badge appears for a job whose detail the store happens to hold - which after opening its tab
   * it does - and not for one seen only in the list. Reported rather than worked around: the list
   * endpoint needs to carry the flag for this to be reliable.
   */
  details?: Record<string, JobDetail>;
}

/**
 * `JobsApp.Data.cs` `BuildJobRows`, minus its ordering.
 *
 * V1 sorts here (`.OrderByDescending(r => ExtractJobNumber(r.Id))`) because it holds every row. This
 * table holds one window, so the order is the daemon's `ORDER BY` — see {@link JOBS_INITIAL_SORT} — and
 * re-sorting the rows in hand would silently override whichever sort the reader clicked, shuffling one
 * window's fifty rows inside an order the other windows were chosen by.
 *
 * V1's Prompt cell (`GetPromptDisplay`) walks the plan's title, then `ReportedPlanTitle`, then the
 * job's typed args. V2's DTO carries `planTitle` and nothing else of that chain, so the fallback
 * stops at the plan id.
 */
export function buildJobRows(jobs: readonly Job[], options: BuildJobRowsOptions = {}): JobRow[] {
  const now = options.now ?? Date.now();
  const details = options.details ?? {};

  return jobs.map((job) => {
    const completed = job.completedAt ? Date.parse(job.completedAt) : NaN;
    return {
      id: job.id,
      status: job.status,
      // V1 derives this from `PlanFile` and falls back to `ReportedPlanId`; the daemon has already
      // resolved both into `planId` by the time it reaches here.
      planId: job.planId ?? "",
      prompt: truncatePrompt(job.planTitle ?? job.planId),
      type: job.type,
      // `ProjectHelper.ParseProjects` then `string.Join(", ", ...)`: a job can name several.
      project: parseProjects(job.project).join(", "),
      timerSeconds: timerSeconds(job, now),
      agentOutput: agentOutputState(job.status),
      agentOutputLabel: agentOutputLabel(job, now),
      cost: formatJobCost(job),
      costValue: job.cost ?? null,
      tokens: job.tokens ?? null,
      tokenBreakdown: tokenBreakdown(job),
      completedAtMs: Number.isNaN(completed) ? null : completed,
      statusMessage: jobStatusMessage(job),
      detached: Boolean(job.detached ?? details[job.id]?.detached),
      processId: job.processId ?? details[job.id]?.processId,
    };
  });
}

/** What the row menu is allowed to offer, given what the bridge can actually perform. */
export interface JobRowActionCapabilities {
  canDelete: boolean;
  canForceStart: boolean;
}

/**
 * `JobsApp.DataTable.cs` `RowActions`, in V1's order and with V1's labels, icons and tooltips:
 * Stop, Rerun, Force Start, Debug, Delete.
 *
 * - **Stop** covers every state a job can still be taken out of, not just the two already moving
 *   (`:183`, and `isActiveStatus` is the same set).
 * - **Rerun** is `CanRerun` (`JobsApp.Helpers.cs:235`): Failed, Timeout and Stopped unconditionally,
 *   and Completed only when the job's args support corrective feedback. `SupportsFeedback` returns
 *   false for a null `TypedArgs`, so with the DTO carrying none a Completed job is offered nothing -
 *   which is exactly what V1 would do with the same data - and the three failure states get the
 *   entry **disabled**, carrying {@link RERUN_UNAVAILABLE_REASON}.
 * - **Force Start** is Blocked-only (`:195`): its whole point is skipping the dependency gate.
 * - **Debug** (`:201`) is unconditional. V1 gates it on being passed a `showDebug`, and `JobsApp.cs:113`
 *   always passes one, so the gate has no false case in practice and there is none here. It opens
 *   {@link JobDebugSheet}, which is V1's own sheet over the fields the DTO carries.
 * - **Delete** is unconditional in V1 (`:207`), including on terminal rows; here it additionally
 *   needs the bridge to be able to perform it.
 */
export function buildJobRowActions(
  row: Pick<JobRow, "status">,
  capabilities: JobRowActionCapabilities,
): DataTableRowAction<JobRow>[] {
  const items: DataTableRowAction<JobRow>[] = [];

  if (isActiveStatus(row.status)) {
    items.push({
      tag: "stop-job",
      label: "Stop",
      icon: <Pause aria-hidden="true" />,
      tooltip: "Stop this job",
    });
  }

  if (row.status === "Failed" || row.status === "Timeout" || row.status === "Stopped") {
    items.push({
      tag: "rerun-job",
      label: "Rerun",
      icon: <RotateCw aria-hidden="true" />,
      tooltip: RERUN_UNAVAILABLE_REASON,
      disabled: true,
    });
  }

  if (row.status === "Blocked" && capabilities.canForceStart) {
    items.push({
      tag: "force-start-job",
      label: "Force Start",
      icon: <Zap aria-hidden="true" />,
      tooltip: "Force start this blocked job",
    });
  }

  // Between Force Start and Delete, which is V1's order, and needing no capability: the sheet reads
  // the detail the store already fetches for every opened job.
  items.push({
    tag: "debug-job",
    label: "Debug",
    icon: <Bug aria-hidden="true" />,
    tooltip: "Show debug details for this job",
  });

  if (capabilities.canDelete) {
    items.push({
      tag: "delete-job",
      label: "Delete",
      icon: <Trash aria-hidden="true" />,
      tooltip: "Delete this job",
      variant: "destructive",
    });
  }

  // V1's `RowActions` can never return an empty array either — its Delete is unconditional — and
  // neither can this now that Debug is. Kept as a guard rather than deleted because
  // `DataTable.hasActionsColumn` drops the whole column for an empty result, and that is the behaviour
  // a caller with a genuinely empty menu should get.
  if (items.length === 0) return [];

  // V1's `RowActions` produce a `MenuItem[]`, which Ivy renders as one per-row overflow menu. The
  // shared `DataTableRowActions` renders a flat list as inline buttons and only a parent with
  // `children` as a dropdown, so the menu is expressed as that parent.
  return [
    {
      tag: "job-menu",
      label: "Job actions",
      icon: <EllipsisVertical aria-hidden="true" />,
      children: items,
    },
  ];
}

/**
 * `JobsApp.Data.cs` `BuildStatusProgress`: one segment per status, largest first, with labels on.
 * V1 renders none at all for an empty list (`JobsApp.cs:110`).
 */
export function buildStatusSegments(jobs: readonly Job[]): StackedProgressSegment[] {
  const counts = new Map<JobStatus, number>();
  for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({
      value: count,
      label: status,
      color: JOB_STATUS_SEGMENT_COLOR[status] ?? "muted",
    }));
}

/** One entry in the header menu's clear list. */
export interface JobClearScope {
  /** The `status` value `POST /api/jobs/clear` is sent. */
  scope: string;
  /** The menu label, and the dialog's title. */
  label: string;
  /** What the sentence in the dialog calls these rows, e.g. "12 **failed** jobs". */
  noun: string;
  /** The statuses removed, so the count and the sentence are read from one place. */
  statuses: JobStatus[];
}

/**
 * The bulk clears the header menu offers.
 *
 * V1's menu holds two (`JobsApp.DataTable.cs:279-289`: Clear Completed, Clear Failed) — but its service
 * is already a *generic predicate clear* (`JobService.cs:676`, `ClearJobsByStatus`) and simply never
 * wires up the rest. So this is not a new mechanism: it is the remaining uses of V1's own primitive,
 * which is what the user asked for ("clear successful, clear timedout, clear cancelled, clear failed").
 *
 * Their wording maps onto V2's `JobStatus` names, and the **labels use V2's names** so a menu entry and
 * the Status badge it will remove read the same: "successful" is `Completed`, "cancelled" is `Stopped`
 * (V2 has no `Cancelled` — a stopped job is one that was cancelled, and its default status message says
 * so), and "timedout" is `Timeout`.
 *
 * `Running`, `Queued`, `Pending` and `Blocked` are absent and cannot be reached from here — nor from
 * anywhere else, because the daemon refuses them (`CLEARABLE_STATUSES` in `jobs/manager.rs`). A clear
 * only ever removes finished work.
 *
 * `all` is last because it is the widest, and it is `clear_all_jobs`' semantics: every terminal status,
 * which V1's service exposes as `ClearAllJobs` without ever putting it in a menu.
 */
export const JOB_CLEAR_SCOPES: readonly JobClearScope[] = [
  { scope: "Completed", label: "Clear Completed", noun: "completed", statuses: ["Completed"] },
  { scope: "Failed", label: "Clear Failed", noun: "failed", statuses: ["Failed"] },
  { scope: "Timeout", label: "Clear Timeout", noun: "timed-out", statuses: ["Timeout"] },
  { scope: "Stopped", label: "Clear Stopped", noun: "stopped", statuses: ["Stopped"] },
  {
    scope: "all",
    label: "Clear All Finished",
    noun: "finished",
    statuses: ["Completed", "Failed", "Timeout", "Stopped"],
  },
];

/** What the clear confirm says and offers, for one scope and one count. */
export interface JobClearPrompt {
  /** The question, naming both what goes and how many. */
  body: string;
  /** The destructive button's label. */
  confirmLabel: string;
  /** True while there is nothing to confirm — no count yet, or nothing to remove. */
  confirmDisabled: boolean;
}

/**
 * The clear confirm's copy.
 *
 * A function rather than JSX in the dialog because the *sentence* is the safety mechanism: "Delete 412
 * completed jobs?" and "Delete completed jobs?" are different decisions, and V1 asks neither — it fires
 * `ClearCompletedJobs()` straight off the menu item. Three states, and each has to be right:
 *
 * - **not counted yet** (`null`): says so, and arms nothing. Offering a confirm a moment before the
 *   figure lands is how someone removes four hundred rows they thought were four.
 * - **nothing to remove**: says that instead of asking, and stays disarmed. A clear that would delete
 *   nothing is not a question worth answering.
 * - **n rows**: the number, the noun, and what goes with them.
 */
export function describeClearPrompt(scope: JobClearScope, count: number | null): JobClearPrompt {
  if (count === null) {
    return {
      body: `Counting ${scope.noun} jobs…`,
      confirmLabel: "Clear",
      confirmDisabled: true,
    };
  }
  if (count === 0) {
    return {
      body: `There are no ${scope.noun} jobs to clear.`,
      confirmLabel: "Clear",
      confirmDisabled: true,
    };
  }
  return {
    body:
      `Delete ${count} ${scope.noun} job${count === 1 ? "" : "s"}? ` +
      "Their logs and output are removed with them, and this cannot be undone.",
    confirmLabel: `Clear ${count}`,
    confirmDisabled: false,
  };
}

/**
 * How many rows a clear would remove, counted **over the whole table** rather than over the loaded
 * window.
 *
 * The window is fifty rows of a job history that can run to tens of thousands, so counting the rows in
 * hand would understate a clear by any margin at all — and "Clear 12 failed jobs" is only worth putting
 * in front of someone if the 12 is true. `POST /api/jobs/query` already answers the *filtered* total for
 * any filter, which is exactly this question; `limit: 1` and one column keep the reply to a row nobody
 * reads.
 */
export async function countJobsByStatus(statuses: readonly JobStatus[]): Promise<number> {
  const page = await queryJobsPage({
    offset: 0,
    limit: 1,
    sort: [],
    filter: whereColumn("status", "inSet", [...statuses]),
    selectColumns: ["Id"],
  });
  return page.totalRows;
}

export interface JobsViewProps {
  jobs: Job[];
  /** Fetched details, for the `detached` flag the list projection omits. */
  jobDetails?: Record<string, JobDetail>;
  isLoading?: boolean;
  /** Opens the plan. See the Plan Id column for how V1's three-way routing collapses. */
  onSelectPlan?: (planId: string) => void;
  /** The two bulk sweeps' confirms, which the shell owns because they are shell-level dialogs. */
  onStopAllQueued: () => void;
  onStopAll: () => void;
}

export const JobsView: React.FC<JobsViewProps> = ({
  jobs,
  jobDetails,
  isLoading = false,
  onSelectPlan,
  onStopAllQueued,
  onStopAll,
}) => {
  /**
   * The job whose output sheet is open. V1 opens `Sheets/OutputSheet.cs` **over** the table
   * (`JobsApp.cs:39` `showOutput`), so the list stays underneath and the operator keeps their place
   * in it; navigating away to a page was the structural divergence this replaces.
   */
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  /** V1's `showDebug(id)`: the Job Debug sheet, over the table. See {@link JobDebugSheet}. */
  const [debugJobId, setDebugJobId] = useState<string | null>(null);
  /**
   * The toolbar's filter, `c.AllowFiltering = true`: the expression as typed, and the wire filter it
   * parsed to.
   *
   * Both, because they answer different questions. The text is what the editor shows and what "is a
   * filter applied" is read from; the tree is what goes to the daemon, which is where the filtering
   * happens — over the whole table rather than over the fifty rows on screen.
   */
  /** V1's responsive density: Large by default, Medium on a desktop viewport. */
  const density = useResponsiveDensity(Densities.Large, Densities.Medium);
  const [filterExpression, setFilterExpression] = useState("");
  const [filter, setFilter] = useState<RemoteTableFilter | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * The clear the operator picked from the header menu, and how many rows it would take.
   *
   * `null` count means "not counted yet". The confirm button stays disabled until it is a number,
   * because the whole point of the dialog is the figure in it: "Clear 12 failed jobs" and "Clear failed
   * jobs" are different decisions, and offering the second while the first is a moment away is how
   * someone clears four hundred rows they thought were four.
   */
  const [pendingClear, setPendingClear] = useState<JobClearScope | null>(null);
  const [clearCount, setClearCount] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  /**
   * The one thing V1's per-cell update stream buys that a re-render does not.
   *
   * `BuildDataTableUpdates` exists because Ivy pushes widget state to a browser over a wire: a
   * rebuild re-serialises the whole table, so V1 pushes six cells per interesting job every second
   * instead, and diffs against what it last sent so an unchanged cell costs nothing. None of that
   * applies here - `App.tsx` already re-reads the list on `job.status_changed` / `job.completed` /
   * `job.failed` and on a 5s poll, and React's own diff is the "only what changed" mechanism.
   * Porting a cell-update channel on top of that would be a second source of truth for six cells.
   *
   * What does not arrive on any event is the *passage of time*: Timer counts up from `startedAt` and
   * Agent Output counts up from `lastOutputAt` while nothing about the job changes. So this is V1's
   * one-second interval, narrowed to its cause - it runs only while some row is Running, and stops when
   * none is.
   *
   * It re-renders and nothing more. Both cells are read off a timestamp the daemon already served, so a
   * tick costs one `buildJobRows` over the loaded window and never a refetch - which matters, because
   * refetching would drop the accumulated windows and return the reader to the top once a second. See
   * the structural signature below for the only thing that is allowed to refetch.
   */
  const hasRunningJob = jobs.some((job) => job.status === "Running");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [hasRunningJob]);

  /**
   * The table's rows, a window at a time.
   *
   * This is V1's `c.BatchSize = 50` infinite scroll: fifty jobs arrive, fifty more when the reader
   * comes within ten rows of the end, and the table never holds history nobody has scrolled to. The
   * `jobs` prop is no longer the row source — it could not be, because `jobsStore` holds only the
   * newest fifty and every poll replaces them, so a scrolled-open window would collapse every five
   * seconds. It is still the *live* source; see the overlay below.
   *
   * `POST /api/jobs/query`, so the sort, the filter and the window all execute in SQLite and the reply
   * carries the *filtered* total. That is what makes the row count irrelevant to the client: one window
   * per view, whether the table holds fifty jobs or fifty million. The sort columns are translated to
   * the daemon's schema on the way out — see {@link JOB_SORT_COLUMNS} and `resolveRemoteSort`.
   */
  const fetchJobsPage = useMemo<RemoteTableFetcher<Job>>(
    () => (request) =>
      queryJobsPage({ ...request, sort: resolveRemoteSort(SORT_COLUMNS, request.sort) }),
    [],
  );
  const table = useRemoteDataTable<Job>({
    fetchPage: fetchJobsPage,
    pageSize: JOBS_PAGE_SIZE,
    initialSort: JOBS_INITIAL_SORT,
    filter,
    infinite: true,
    getRowKey: (job) => job.id,
  });

  /**
   * V1's `BuildDataTableUpdates` (`JobsApp.DataTable.cs:361-394`), which streams six cells a second —
   * `Timer, Cost, Tokens, AgentOutput, Status, StatusMessage` — for jobs that are moving, instead of
   * rebuilding the table.
   *
   * The `jobs` prop is exactly that stream: `jobsStore` re-reads the newest fifty on every job event
   * and on a 5s poll, which is the set that can have changed. Overlaying it by id is what keeps a
   * Running row's cost and status live without refetching the window under the reader's scroll.
   *
   * A whole replacement rather than a field merge, deliberately: a live job is a complete record, and
   * merging would let a value the fetched page happened to carry outlive the daemon's own answer. The
   * consequence is that every cell reading a moving field needs that field on `Job` — `lastOutputAt` is
   * one, and a bridge DTO that dropped it would leave Agent Output reading the fetched page's frozen
   * stamp, which counts up forever and so reports a chatty agent as a silent one.
   */
  const liveJobs = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const windowJobs = useMemo(
    () => table.rows.map((row) => liveJobs.get(row.id) ?? row),
    [table.rows, liveJobs],
  );

  /**
   * V1's `ComputeStructuralSignature` gate (`JobsApp.Hooks.cs:66-68`): `Id;Status;PlanFile;
   * ReportedPlanId;Type;Project` per job, and a rebuild only when it differs from what is rendered.
   *
   * A cell that changed (a cost, a token count, a status message) is handled by the overlay above and
   * must not refetch, because refetching drops the accumulated windows and returns the reader to the
   * top. A *structural* change — a new job, a status transition — genuinely changes which rows exist
   * and where, and is the one case V1 rebuilds for too.
   */
  const structuralSignature = useMemo(
    () =>
      jobs
        .map(
          (job) => `${job.id};${job.status};${job.planId ?? ""};${job.type};${job.project ?? ""}`,
        )
        .join("|"),
    [jobs],
  );
  const lastSignature = useRef<string | null>(null);
  const refreshTable = table.refresh;
  useEffect(() => {
    const previous = lastSignature.current;
    lastSignature.current = structuralSignature;
    // The first sighting only records a baseline: the table's own first window is already in flight.
    if (previous === null || previous === structuralSignature) return;
    refreshTable();
  }, [structuralSignature, refreshTable]);

  const rows = useMemo(
    () => buildJobRows(windowJobs, { details: jobDetails }),
    // `tick` is a dependency in substance: it is what makes a Running row's Timer advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windowJobs, jobDetails, tick],
  );

  /**
   * The values each closed-set column can hold, from `POST /api/tables/jobs/values`.
   *
   * These used to be derived from the rows in hand, which was right only for as long as the filter was
   * evaluated in the client: the two agreed about which values existed because they read the same rows.
   * With the filter running in SQLite over the whole table, a list built from the loaded window offers a
   * user the values on screen — and the value they want is usually not one of them. `SELECT DISTINCT` is
   * the only source that can answer for a table the client has not read.
   *
   * They feed the filter editor's vocabulary rather than a control per column, so an operator can see
   * what `[Status] in (…)` accepts without knowing the job schema.
   */
  const statusOptions = useColumnValues("status");
  const typeOptions = useColumnValues("type");
  // Split, because the column stores a *joined* list: `SELECT DISTINCT Project` answers "web, api" as
  // one value, and the facet has to offer "web" and "api" — which is also why the Project filter's
  // condition is `contains` rather than `equals`.
  const projectOptions = useColumnValues("project", parseProjects);

  const capabilities: JobRowActionCapabilities = {
    canDelete: jobsStore.canDeleteJob(),
    canForceStart: jobsStore.canForceStartJob(),
  };

  const runAction = async (action: () => Promise<unknown>, label: string) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      // V1 refreshes and says nothing when `StopJob`/`ForceStartJob` fail. Saying nothing here would
      // leave the operator believing a job they could not stop had stopped.
      setActionError(`${label} failed: ${describeBridgeError(err)}`);
    }
  };

  const clearPrompt = pendingClear
    ? describeClearPrompt(pendingClear, clearCount)
    : // Not rendered while `pendingClear` is null; the placeholder keeps the dialog's props unconditional.
      { body: "", confirmLabel: "Clear", confirmDisabled: true };

  /** Opens a clear's confirm and asks the daemon how many rows it covers. */
  const openClearDialog = (scope: JobClearScope) => {
    setClearError(null);
    setClearCount(null);
    setPendingClear(scope);
  };

  useEffect(() => {
    if (!pendingClear) return;
    let cancelled = false;
    void countJobsByStatus(pendingClear.statuses)
      .then((count) => {
        if (!cancelled) setClearCount(count);
      })
      .catch((err: unknown) => {
        // The dialog stays open with the reason on it rather than closing: an operator who asked to
        // clear failed jobs should be told the daemon could not be reached, not silently returned to
        // the table.
        if (!cancelled) setClearError(`Could not count jobs: ${describeBridgeError(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingClear]);

  /**
   * V1's Plan Id cell action (`JobsApp.DataTable.cs:95-141`) picks between three targets: a plan
   * sheet for a job still active (to keep the user in Jobs), `PlansApp` for a Draft or Blocked plan,
   * and `ReviewApp` for one in Review or Failed.
   *
   * V2 has one plan surface, the plan tab, which every other view already routes to regardless of
   * state, and its review nav takes no plan argument. So all three collapse onto one call here. This
   * is a real divergence rather than a shortcut, and it becomes portable the moment there is a
   * per-plan review route to send the Review/Failed case to.
   */
  const openPlan = (planId: string) => {
    if (planId && onSelectPlan) onSelectPlan(planId);
  };

  /**
   * V1's `showOutput(id)`: the job's output sheet. The detail is pulled at the same time because the
   * list projection omits `reportedFailureReason`, `permissionDenials` and `detached` - V1's sheet
   * reads the live `JobItem` from `IJobService` and needs no such call.
   */
  const openJobOutput = (jobId: string) => {
    setOpenJobId(jobId);
    jobsStore.fetchJobDetail(jobId).catch(() => {
      // Supplementary: the sheet falls back to the list row.
    });
  };

  /**
   * V1's `showDebug(id)`. The detail is not supplementary here as it is for the output sheet — it *is*
   * the sheet: `args`, `workingDirectory`, `reportedFailureReason` and `permissionDenials` are all
   * detail-only fields, and a debug panel built from the list row would show none of them.
   */
  const openJobDebug = (jobId: string) => {
    setDebugJobId(jobId);
    jobsStore.fetchJobDetail(jobId).catch(() => {
      // Reported by the sheet's own empty state rather than swallowed silently.
    });
  };

  /**
   * V1's columns, in V1's order, at V1's widths, with the headers Ivy derives from the property
   * names via `SplitPascalCase` (so `PlanId` reads "Plan Id" and `StatusMessage` "Status Message").
   * `Id` is present and hidden, as `.Hidden(t => t.Id)` leaves it: reachable from the column options
   * and absent from the DOM until then.
   */
  const columns = useMemo<DataTableColumn<JobRow>[]>(
    () => [
      // `.Filterable(t => t.Id, false)` (`:83`) as well as `.Hidden(...)`: no filter control.
      { name: "id", header: "Id", width: "90px", hidden: true },
      {
        name: "status",
        header: "Status",
        width: "100px",
        // A closed set, so the editor can offer its values: `[Status] in ("Running", "Queued")` is the
        // `inSet` condition the framework's editor cannot type but its proto has had all along.
        filter: { kind: "select", options: statusOptions, placeholder: "All" },
        accessor: (row) => row.status,
        cell: (_value, row) => (
          <div className="flex items-center gap-1">
            {/* V1's `LabelsDisplayRenderer` over `Constants.JobStatusColors` — the colour *is* the way
                this column is read at a glance, so it is V1's colour and not an approximation. */}
            <Badge color={JOB_STATUS_COLOR[row.status] ?? UNMAPPED_COLOR} density="Small">
              {row.status}
            </Badge>
            {/* Not a V1 column: V1 has no notion of a detached job. `JobSessionView` shows the same
                badge for one, and a row that a previous daemon started is worth flagging where the
                Stop action is offered. */}
            {row.detached && (
              <Badge
                color="Orange"
                density="Small"
                data-testid={`job-detached-${row.id}`}
                title={`Detached (PID ${row.processId ?? "unknown"}) — monitoring an active process started before the last daemon restart`}
              >
                Detached
              </Badge>
            )}
          </div>
        ),
      },
      {
        name: "planId",
        header: "Plan Id",
        width: "80px",
        // `contains`, not `equals`: a plan id is typed a digit at a time, and the daemon's column is
        // `PlanFile`, whose value only *starts* with the id.
        filter: { kind: "text", column: "planFile", placeholder: "Id…" },
        // V1's Plan Id cell action navigates (`JobsApp.DataTable.cs:95-141`), so this is the framework's
        // *link* cell: `cursor: pointer` on the cell and blue underlined text in it.
        clickable: Boolean(onSelectPlan),
        accessor: (row) => row.planId,
        cell: (_value, row) =>
          row.planId ? (
            onSelectPlan ? (
              <button
                type="button"
                className={`font-mono text-xs ${dataTableLinkClass}`}
                data-testid={`job-plan-${row.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openPlan(row.planId);
                }}
              >
                {row.planId}
              </button>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">{row.planId}</span>
            )
          ) : null,
      },
      {
        name: "prompt",
        header: "Prompt",
        width: "250px",
        // V1's free-text `[Prompt] contains "…"`, as a box. The daemon's column is
        // `ReportedPlanTitle`, which is where the cell's text comes from.
        filter: { kind: "text", column: "reportedPlanTitle" },
        accessor: (row) => row.prompt,
        // V1's Prompt cell action opens a `PromptSheet` with the untruncated prompt
        // (`JobsApp.cs:51`), resolved from the job's typed args or the plan's `InitialPrompt`.
        // Neither is on the DTO, so there is nothing longer to show than the cell already holds;
        // the title carries it for a truncated one.
        cell: (_value, row) => (
          <span className="text-sm text-foreground" title={row.prompt || undefined}>
            {row.prompt}
          </span>
        ),
      },
      {
        name: "type",
        header: "Type",
        width: "100px",
        filter: { kind: "select", options: typeOptions, placeholder: "All" },
        accessor: (row) => row.type,
        // `Constants.JobTypeColors`, all eleven hues (`JobsApp.DataTable.cs:68-74`). Reachable because
        // the design system publishes a token per Ivy colour and `Badge`'s `color` tints from it — so
        // this is a categorical palette the theme already owns, not a decorative ramp invented here.
        cell: (_value, row) => (
          <Badge color={JOB_TYPE_COLOR[row.type] ?? UNMAPPED_COLOR} density="Small">
            {row.type}
          </Badge>
        ),
      },
      {
        name: "project",
        header: "Project",
        width: "150px",
        // `contains`, because a job can name several projects and the cell (and the column) holds them
        // joined: "web, api" is equal to neither "web" nor "api".
        filter: {
          kind: "select",
          options: projectOptions,
          placeholder: "All",
          function: "contains",
        },
        accessor: (row) => row.project,
        cell: (_value, row) => (
          <div className="flex flex-wrap items-center gap-1">
            {/* V1 colours each project from configuration; see {@link projectColor} for why this is
                derived from the name instead. Coloured either way, because that is what makes two
                projects tellable apart in a list of a hundred rows. */}
            {parseProjects(row.project).map((project) => (
              <Badge key={project} color={projectColor(project)} density="Small">
                {project}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        name: "timer",
        header: "Timer",
        width: "80px",
        // Derived from `StartedAt` for a running job, so the database's closest total order is the
        // recorded duration. See {@link SORT_COLUMNS}.
        sortColumn: "durationSeconds",
        accessor: (row) => row.timerSeconds,
        cell: (_value, row) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.timerSeconds === null ? NO_TIME : formatTimeSpan(row.timerSeconds)}
          </span>
        ),
      },
      {
        name: "agentOutput",
        header: "Agent Output",
        width: "100px",
        // How long since the agent last wrote a line, not its status message — that has its own column.
        // `Status` is what groups the three forms this cell takes; see {@link SORT_COLUMNS}.
        sortColumn: "status",
        // V1's cell action here opens the output sheet rather than navigating, which is the framework's
        // plain clickable cell: the cursor, and no link styling.
        clickable: true,
        accessor: (row) => row.agentOutput,
        // V1's cell action is `showOutput(id)`: the output sheet, over the table.
        cell: (_value, row) => (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            data-testid={`job-output-${row.id}`}
            onClick={(event) => {
              event.stopPropagation();
              openJobOutput(row.id);
            }}
          >
            {row.agentOutput === "running" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-info" aria-hidden="true" />
                {/* Monospace so a figure that ticks every second does not reflow the cell around it. */}
                <span className="font-mono">{row.agentOutputLabel}</span>
              </>
            ) : row.agentOutput === "done" ? (
              <span className="text-success">{row.agentOutputLabel}</span>
            ) : (
              row.agentOutputLabel
            )}
          </button>
        ),
      },
      {
        name: "cost",
        header: "Cost",
        width: "80px",
        align: "Right",
        accessor: (row) => row.costValue,
        cell: (_value, row) => (
          <span
            className="font-mono text-xs text-foreground"
            data-testid={`job-cost-${row.id}`}
            title={row.cost === null ? "No cost was reported for this job" : undefined}
          >
            {row.cost ?? NO_VALUE}
          </span>
        ),
      },
      {
        name: "tokens",
        header: "Tokens",
        width: "80px",
        align: "Right",
        accessor: (row) => row.tokens,
        cell: (_value, row) => (
          <span
            className="font-mono text-xs text-foreground"
            data-testid={`job-tokens-${row.id}`}
            title={
              row.tokens === null
                ? undefined
                : [row.tokens.toLocaleString("en-US"), row.tokenBreakdown]
                    .filter(Boolean)
                    .join(" — ")
            }
          >
            {row.tokens === null ? NO_VALUE : formatTokens(row.tokens)}
          </span>
        ),
      },
      {
        name: "timestamp",
        header: "Timestamp",
        width: "110px",
        sortColumn: "completedAt",
        accessor: (row) => row.completedAtMs,
        // `FormatTimestamp`: `MM-dd HH:mm` in the viewer's local time, "-" until the job finishes.
        cell: (_value, row) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.completedAtMs === null ? NO_TIME : formatMonthDayTime(row.completedAtMs)}
          </span>
        ),
      },
      {
        name: "statusMessage",
        header: "Status Message",
        width: "auto",
        filter: { kind: "text" },
        accessor: (row) => row.statusMessage,
        cell: (_value, row) => (
          <span className="text-xs text-muted-foreground" title={row.statusMessage || undefined}>
            {row.statusMessage}
          </span>
        ),
      },
    ],
    // `onSelectPlan` and the sheet opener are the only closures the cells capture; the three option
    // lists are the only other thing a column declaration reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectPlan, statusOptions, typeOptions, projectOptions],
  );

  /**
   * A query the daemon refused, or a daemon that is not there.
   *
   * Worth a line of its own rather than an empty table: with the filter and the sort executing in
   * SQLite, "no rows" and "the daemon said `unknown column 'costt'`" look identical and mean opposite
   * things. The daemon's 400 names the column or the function that was wrong, which is the whole value
   * of the message to whoever typed the expression.
   */
  const tableError = table.error ? describeBridgeError(table.error) : null;

  const queuedCount = jobs.filter((job) => job.status === "Queued").length;
  const activeCount = jobs.filter((job) => isActiveStatus(job.status)).length;
  const segments = useMemo(() => buildStatusSegments(jobs), [jobs]);
  const canClear = jobsStore.canClearJobs();

  const jobToDelete = deleteJobId ? jobs.find((job) => job.id === deleteJobId) : undefined;

  // The sheet reads the list row, or the fetched detail for a job the list no longer carries (it is
  // capped, and Clear removes rows). `JobSessionView` merges the store's own copy over this anyway.
  const openJob = openJobId
    ? (jobs.find((job) => job.id === openJobId) ?? jobDetails?.[openJobId])
    : undefined;
  const openJobTitle = openJob
    ? openJob.planId
      ? `${openJob.type} ${openJob.planId}`
      : openJob.type
    : "Job Output";

  /**
   * The debug sheet's subject. Only the fetched detail will do — the list row is a `Job`, and every
   * field the panel exists to show is on `JobDetail`. A row whose detail has not arrived (or could not
   * be fetched) gets the sheet's own "nothing to show yet" line rather than a half-empty table.
   */
  const debugJob = debugJobId ? jobDetails?.[debugJobId] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="jobs-view">
      {tableError && (
        <div
          role="alert"
          data-testid="jobs-table-error"
          className="rounded-box border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          Could not read the jobs table: {tableError}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          data-testid="jobs-action-error"
          className="flex items-start justify-between gap-3 rounded-box border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="text-destructive hover:text-destructive/80"
          >
            ✕
          </button>
        </div>
      )}

      <DataTable<JobRow>
        data-testid="jobs-table"
        // `.Width(Size.Full()).Height(Size.Full())` on V1's table, and the same fixed layout the
        // other ported tables use so the declared column widths are binding.
        className="min-h-0 flex-1 [&_table.ivy-data-table]:table-fixed"
        // `.Density(new Responsive<Density?> { Default = Large, Desktop = Medium })`
        // (`JobsApp.DataTable.cs:40`), through the hook that gives V2's flat density a breakpoint:
        // roomier rows where a finger is the pointer, tighter where a mouse is.
        density={density}
        columns={columns}
        /* The window, unfiltered and unsorted here. Both happen in SQLite over the whole table — a
           client-side predicate would narrow the fifty rows on screen and quietly claim the other
           2.5 million matched nothing, and a client-side sort would shuffle one window inside an order
           the other windows were chosen by. */
        rows={rows}
        getRowId={(row) => row.id}
        loading={(isLoading || table.loading) && table.rows.length === 0}
        /* Infinite scroll, `c.BatchSize = 50`. `paginated={false}` because V1's table has no pager at
           all: scrolling is the pager, and `hasMore` is what says whether there is anything left to
           scroll to. `fillHeight` is `.Height(Size.Full())` — it is also what makes the header sticky
           mean anything, by giving the body its own bounded scroll viewport instead of scrolling the
           page. Windowing is left on its `"auto"` default, which engages past fifty rendered rows -
           i.e. from the second window on, which is exactly when the DOM needs bounding. */
        paginated={false}
        hasMore={table.hasMore}
        loadingMore={table.loadingMore}
        onLoadMore={table.loadMore}
        fillHeight
        /* `c.AllowSorting = true`, and every header click goes to the daemon: `manualSorting` with the
           hook's own `sort`/`onSortChange`, so a sort is an `ORDER BY` over the whole table rather than
           a reordering of the rows on screen. `JOBS_INITIAL_SORT` is V1's declared
           `.SortDirection(t => t.Id, Descending)`. */
        allowSorting
        manualSorting
        sort={table.sort}
        onSortChange={table.setSort}
        // `c.ShowIndexColumn = false` and `c.SelectionMode = SelectionModes.None`: neither the row
        // number nor a checkbox column. `selectable` defaults to false, and no index column exists.
        selectable={false}
        /* `c.AllowFiltering = true` with `c.ShowSearch = false`: one filter expression at the top-left
           of the toolbar and deliberately no search box, which is exactly what the framework's grid
           renders (`DataTableWidget.tsx`) and what V1's config asks for. The conditions are the
           daemon's — see `filter-expression.ts` — and they are evaluated in SQLite. */
        showFilter
        filterExpression={filterExpression}
        onFilterExpressionChange={(expression, next) => {
          setFilterExpression(expression);
          setFilter(next);
        }}
        // The show/hide-columns menu, which is how the hidden `Id` column is reachable at all.
        showColumnOptions
        rowActions={(row) => buildJobRowActions(row, capabilities)}
        onRowAction={({ tag, row }) => {
          if (tag === "stop-job") {
            void runAction(() => jobsStore.cancelJob(row.id), "Stop");
          } else if (tag === "force-start-job") {
            void runAction(() => jobsStore.forceStartJob(row.id), "Force start");
          } else if (tag === "debug-job") {
            openJobDebug(row.id);
          } else if (tag === "delete-job") {
            setDeleteError(null);
            setDeleteJobId(row.id);
          }
          // `rerun-job` is unreachable: the entry is disabled. See `RERUN_UNAVAILABLE_REASON`.
        }}
        // Not a V1 behaviour - V1's table selects nothing and activates nothing, it hangs four cell
        // actions off individual cells. Three of those (`showOutput`, and `showCost` from both Cost
        // and Tokens) open a sheet, and the two sheets V2 has not built (Cost & Tokens, Prompt) show
        // figures the output sheet's header already carries, so the row opens that one. The Plan Id
        // cell keeps its own, different destination.
        onRowClick={(row) => openJobOutput(row.id)}
        emptyState={
          /* Which of the two it is turns on whether a filter is narrowing anything, not on the row
             count: a filtered-to-nothing table and an empty one look identical and mean opposite
             things. V1 supplies no empty state at all - the framework's `EmptyView` slot is declared
             and never rendered - so an empty Jobs table there is a collapsed header. */
          filterExpression.length > 0 ? (
            <span className="text-muted-foreground" data-testid="jobs-empty-filtered">
              No jobs match the current filters.
            </span>
          ) : (
            <span className="text-muted-foreground" data-testid="jobs-empty">
              No jobs yet. Starting a plan, a retry or a PR creates one.
            </span>
          )
        }
        toolbar={{
          /* V1's `HeaderLeft` is empty: the filter editor is the framework's own toolbar row, and the
             per-column filters that replaced it live in the header. Nothing else belongs here. */
          // `.HeaderRight(...)`: the status progress bar, then one ghost overflow menu holding the
          // two sweeps and the two clears. These were four loose buttons in the page header before;
          // V1 puts them here, so here is where they are.
          right: (
            <div className="flex items-center gap-3">
              {segments.length > 0 && (
                <div className="hidden w-56 sm:block">
                  <StackedProgress
                    aria-label="Jobs by status"
                    segments={segments}
                    showLabels
                    density={Densities.Small}
                    data-testid="jobs-status-progress"
                  />
                </div>
              )}
              {/* V1's menu always has the two Clears in it, so it is never empty. Here it can be:
                  nothing is running, nothing is queued, and `bridge.clearJobs` does not exist. A
                  trigger that opens an empty menu is worse than no trigger. */}
              {(queuedCount > 0 || activeCount > 0 || canClear) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Job list actions"
                      data-testid="jobs-header-menu"
                    >
                      <EllipsisVertical aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* Each sweep is hidden when its count is zero, as V1's `if (queuedCount > 0)` /
                      `if (activeJobCount > 0)` do, so neither ever reads "(0)". */}
                    {queuedCount > 0 && (
                      <DropdownMenuItem
                        data-testid="jobs-stop-all-queued"
                        onClick={() => onStopAllQueued()}
                      >
                        <Pause aria-hidden="true" />
                        Stop All Queued ({queuedCount})
                      </DropdownMenuItem>
                    )}
                    {activeCount > 0 && (
                      <DropdownMenuItem data-testid="jobs-stop-all" onClick={() => onStopAll()}>
                        <Pause aria-hidden="true" />
                        Stop All ({activeCount})
                      </DropdownMenuItem>
                    )}
                    {/* V1 offers its two clears unconditionally, and so does this - the whole list of
                      them, one per terminal status plus the sweep. See {@link JOB_CLEAR_SCOPES} for why
                      that is an extension of V1's own primitive rather than a new mechanism, and for
                      why no non-terminal status is in it.

                      Still gated on the capability, because `bridge.clearJobs` does not exist yet -
                      see `jobsStore.canClearJobs`. Every item below is destructive, so none of them
                      acts on the click: each opens the confirm, which names the count. */}
                    {canClear &&
                      JOB_CLEAR_SCOPES.map((scope) => (
                        <DropdownMenuItem
                          key={scope.scope}
                          data-testid={`jobs-clear-${scope.scope.toLowerCase()}`}
                          onClick={() => openClearDialog(scope)}
                        >
                          <Trash aria-hidden="true" />
                          {scope.label}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ),
        }}
      />

      {/* V1's output sheet (`JobsApp.cs:39-49`): opened over the table, titled
          `$"{job.Type} {ExtractPlanId(job.PlanFile)}"` - and "Job Output" for a job the service no
          longer has - at `UxHelper.SheetWidth`. `inset-y-0` is repeated from the `side="right"`
          variant for the same reason the other ported sheets repeat it. */}
      <Sheet
        open={openJobId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenJobId(null);
        }}
      >
        {/* `HeaderLayout`, which is the framework's structure for a panel with fixed chrome over
            scrolling content (`widgets/layouts/HeaderLayoutWidget.tsx`): the title stays put, the body
            scrolls under it, and the header takes a shadow once it does — so a reader can see that the
            output continues above the fold. `p-0` on the sheet because the layout owns the padding, which
            is what the framework's own `remove-parent-padding` does to its container. */}
        <SheetContent
          data-testid="job-output-sheet"
          className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
        >
          <HeaderLayout
            className="min-h-0 flex-1"
            header={
              <SheetHeader className="pr-8">
                <SheetTitle>{openJobTitle}</SheetTitle>
              </SheetHeader>
            }
          >
            {openJob && (
              <React.Suspense
                fallback={
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-success" aria-hidden="true" />
                  </div>
                }
              >
                {/* Deleting from inside the sheet leaves it pointing at a job that no longer
                    exists, so the same callback that closed the tab now closes the sheet. */}
                <JobOutput job={openJob} layout="sheet" onCloseTab={() => setOpenJobId(null)} />
              </React.Suspense>
            )}
          </HeaderLayout>
        </SheetContent>
      </Sheet>

      {/* V1's Job Debug sheet (`JobsApp.cs:62-70`), opened by the Debug row action at the same
          `UxHelper.SheetWidth` as the output sheet and titled the way V1 titles it: "Job Debug". */}
      <Sheet
        open={debugJobId !== null}
        onOpenChange={(open) => {
          if (!open) setDebugJobId(null);
        }}
      >
        <SheetContent
          data-testid="job-debug-sheet"
          className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
        >
          <HeaderLayout
            className="min-h-0 flex-1"
            header={
              <SheetHeader className="pr-8">
                <SheetTitle>Job Debug</SheetTitle>
              </SheetHeader>
            }
          >
            {debugJob ? (
              <React.Suspense
                fallback={
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-success" aria-hidden="true" />
                  </div>
                }
              >
                <JobDebug job={debugJob} />
              </React.Suspense>
            ) : (
              /* The detail is the sheet, so there is nothing to render until it lands — and if the
                 daemon could not answer, this is the honest state rather than a table of blanks. */
              <span className="text-xs text-muted-foreground" data-testid="job-debug-pending">
                Loading job details…
              </span>
            )}
          </HeaderLayout>
        </SheetContent>
      </Sheet>

      {/* The bulk clears' confirm. V1 fires `ClearCompletedJobs()` straight off the menu item with no
          dialog at all; that is the one place this deliberately does not follow it, because a bulk delete
          of unbounded size is exactly what Framework's confirmation contract exists for. One dialog
          serves all five scopes - they differ only in a noun and a count. */}
      <ConfirmDialog
        isOpen={pendingClear !== null}
        onClose={() => {
          setPendingClear(null);
          setClearError(null);
        }}
        title={pendingClear?.label ?? "Clear Jobs"}
        // The copy and the arming rule both live in {@link describeClearPrompt}: the sentence *is* the
        // safety mechanism here, so it is a function with its own tests rather than a ternary in JSX.
        body={<p data-testid="jobs-clear-body">{clearPrompt.body}</p>}
        confirmLabel={clearPrompt.confirmLabel}
        confirmVariant="destructive"
        confirmDisabled={clearPrompt.confirmDisabled}
        isBusy={isClearing}
        error={clearError}
        testId="jobs-clear-dialog"
        onConfirm={async () => {
          if (!pendingClear) return;
          setIsClearing(true);
          setClearError(null);
          try {
            await jobsStore.clearJobs(pendingClear.scope);
            // A clear changes *which rows exist*, which is precisely the case the structural-signature
            // gate refetches for (V1's `ComputeStructuralSignature`). It is asked for directly rather
            // than left to that gate: the gate watches the newest fifty, and a clear can empty a window
            // the reader has scrolled to without touching any of them.
            refreshTable();
            setPendingClear(null);
          } catch (err) {
            setClearError(`Clear failed: ${describeBridgeError(err)}`);
          } finally {
            setIsClearing(false);
          }
        }}
      />

      {/* `JobsApp.DataTable.cs:296-317`, copy included. The handler is `jobsStore.deleteJob`, which
          carries V1's "stop a Running or Queued job first, then delete, then re-read" sequence. */}
      <ConfirmDialog
        isOpen={deleteJobId !== null}
        onClose={() => {
          setDeleteJobId(null);
          setDeleteError(null);
        }}
        title="Delete Job"
        body={<p>Are you sure you want to delete this job? This cannot be undone.</p>}
        confirmLabel="Delete"
        confirmVariant="destructive"
        isBusy={isDeleting}
        error={deleteError}
        testId="jobs-delete-dialog"
        onConfirm={async () => {
          if (!jobToDelete) return;
          setIsDeleting(true);
          setDeleteError(null);
          try {
            await jobsStore.deleteJob(jobToDelete.id);
            setDeleteJobId(null);
          } catch (err) {
            setDeleteError(`Delete failed: ${describeBridgeError(err)}`);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </div>
  );
};

/**
 * One column's distinct values, from `POST /api/tables/jobs/values`.
 *
 * `SELECT DISTINCT` over the whole `Jobs` table, not over the rows the client happens to hold — which is
 * the only way a filter vocabulary can be right once the table is paged. The daemon caps and can search
 * the list server-side, so it stays one small response on a column with a million distinct values.
 *
 * A failure leaves the list empty rather than surfacing: this is the filter editor's *help*, and a
 * daemon that cannot answer it has already failed the table's own query, which is where the operator is
 * told (see `jobs-table-error`). Fetched once per mount: a job list's statuses, types and projects do
 * not turn over inside a session, and re-reading them on every poll would be three requests a second
 * for a list that never changes.
 *
 * @param split For a column that stores a joined list, how one stored value becomes several offered
 *   ones. `Project` holds "web, api".
 */
function useColumnValues(
  column: string,
  split?: (value: string) => string[],
): DataTableFilterOption[] {
  const [options, setOptions] = useState<DataTableFilterOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchTableColumnValues("jobs", column)
      .then((page) => {
        if (cancelled) return;
        const values = page.values.map(String).flatMap((value) => split?.(value) ?? [value]);
        setOptions(
          Array.from(new Set(values.filter((value) => value.length > 0)))
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value })),
        );
      })
      .catch(() => {
        /* See above: the table's own error is the one worth showing. */
      });
    return () => {
      cancelled = true;
    };
    // `split` is a module-level function at every call site, so it is stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column]);

  return options;
}

/** `JobsApp.Helpers.cs` `TimestampFormat`: `"MM-dd HH:mm"`, local time. */
function formatMonthDayTime(epochMs: number): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return NO_TIME;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}
