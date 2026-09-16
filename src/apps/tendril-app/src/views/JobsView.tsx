import React, { useEffect, useMemo, useState } from "react";
import { EllipsisVertical, Loader2, Pause, RotateCw, Trash, Zap } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  StackedProgress,
  type DataTableColumn,
  type DataTableRowAction,
  type StackedProgressColor,
  type StackedProgressSegment,
  Densities,
} from "@ivy-interactive/components/ui";
import { BadgeSelect, type BadgeSelectOption } from "@ivy-interactive/components/tendril";
import { describeBridgeError, type Job, type JobDetail, type JobStatus } from "../types/api";
import { isActiveStatus, jobsStore } from "../state/jobsStore";
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
 * Rerun (V1's `RerunJobDialog` needs `JobItem.TypedArgs`, which the Tauri DTO drops), the Debug
 * entry (`JobDebugSheet`), the full-prompt sheet and the Cost & Tokens sheet.
 */

/**
 * The output sheet's body. Lazy for the reason every view in this app is: it is the only thing here
 * that pulls in `AgentViewer`, and it is fetched when a row is opened rather than with the table.
 */
const JobOutput = React.lazy(() =>
  import("./JobSessionView").then((m) => ({ default: m.JobSessionView })),
);

/** Ceiling on the Prompt cell, from `JobsApp.Helpers.cs` `PromptDisplayMaxLength`. */
const PROMPT_DISPLAY_MAX_LENGTH = 500;

/** `JobsApp.DataTable.cs:93`: `c.BatchSize = 50`. A job list is long and mostly history. */
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

/**
 * `Constants.JobStatusColors`: Running Blue, Completed Green, Failed and Timeout Red, Queued and
 * Pending Amber, Blocked Orange, Stopped Gray - mapped onto the semantic tokens the design system
 * actually has, exactly as `JobSessionView` maps the same table. Amber and Orange collapse onto
 * `warning`; `--primary` (Ivy green) is never borrowed for a status, since it would read as
 * "succeeded" on a job that has not run.
 */
const JOB_STATUS_BADGE_VARIANT: Record<
  JobStatus,
  "info" | "success" | "destructive" | "warning" | "secondary"
> = {
  Running: "info",
  Completed: "success",
  Failed: "destructive",
  Timeout: "destructive",
  Queued: "warning",
  Pending: "warning",
  Blocked: "warning",
  Stopped: "secondary",
};

/** The same mapping for the header's `StackedProgress` segments (`JobsApp.Data.cs` `GetStatusColor`). */
const JOB_STATUS_SEGMENT_COLOR: Record<JobStatus, StackedProgressColor> = {
  Running: "info",
  Completed: "success",
  Failed: "destructive",
  Timeout: "destructive",
  Queued: "warning",
  Pending: "warning",
  Blocked: "warning",
  Stopped: "muted",
};

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
 * `JobsApp.Helpers.cs` `ExtractJobNumber`, which is what `BuildJobRows` orders by
 * (`OrderByDescending(r => ExtractJobNumber(r.Id))`). Numeric, not lexicographic: `00009` sorts
 * below `00010`, and a suffixed id like `00458-ExecutePlan` still sorts as 458.
 *
 * The whole-string parse mirrors `int.TryParse`, which accepts surrounding whitespace and a leading
 * sign and nothing else - notably not `"12abc"`, which must fall through to the dash split.
 */
export function extractJobNumber(jobId: string): number {
  if (!jobId) return 0;
  const whole = parseWholeInt(jobId);
  if (whole !== null) return whole;
  for (const part of jobId.split("-")) {
    const parsed = parseWholeInt(part);
    if (parsed !== null) return parsed;
  }
  return 0;
}

function parseWholeInt(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
 * V1's running label is the time since the agent last wrote a line, and falls back to `"Starting..."`
 * when there is no such timestamp yet. `lastOutputAt` exists on the daemon's `JobItem`
 * (`models/job.rs:345`) but not on `JobDto`, so every running row takes V1's own fallback until the
 * DTO carries it.
 */
export type AgentOutputState = "running" | "done" | "idle";

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
 * `JobsApp.Data.cs` `BuildJobRows`, including its ordering:
 * `.OrderByDescending(r => ExtractJobNumber(r.Id))`, newest job number first.
 *
 * V1's Prompt cell (`GetPromptDisplay`) walks the plan's title, then `ReportedPlanTitle`, then the
 * job's typed args. V2's DTO carries `planTitle` and nothing else of that chain, so the fallback
 * stops at the plan id.
 */
export function buildJobRows(jobs: readonly Job[], options: BuildJobRowsOptions = {}): JobRow[] {
  const now = options.now ?? Date.now();
  const details = options.details ?? {};

  return jobs
    .map((job) => {
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
        cost: formatJobCost(job),
        costValue: job.cost ?? null,
        tokens: job.tokens ?? null,
        tokenBreakdown: tokenBreakdown(job),
        completedAtMs: Number.isNaN(completed) ? null : completed,
        statusMessage: jobStatusMessage(job),
        detached: Boolean(job.detached ?? details[job.id]?.detached),
        processId: job.processId ?? details[job.id]?.processId,
      };
    })
    .sort((a, b) => extractJobNumber(b.id) - extractJobNumber(a.id));
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
 * - **Debug** (`:201`, gated on V1 passing a `showDebug`) is absent: it opens `JobDebugSheet`, which
 *   has no V2 counterpart. V1's own gate makes its absence a supported state rather than a hole.
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

  if (capabilities.canDelete) {
    items.push({
      tag: "delete-job",
      label: "Delete",
      icon: <Trash aria-hidden="true" />,
      tooltip: "Delete this job",
      variant: "destructive",
    });
  }

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
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
   * What does not arrive on any event is the *passage of time*: Timer counts up and Agent Output
   * animates while nothing about the job changes. So this is V1's one-second interval, narrowed to
   * its cause - it runs only while some row is Running, and stops when none is.
   */
  const hasRunningJob = jobs.some((job) => job.status === "Running");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [hasRunningJob]);

  const rows = useMemo(
    () => buildJobRows(jobs, { details: jobDetails }),
    // `tick` is a dependency in substance: it is what makes a Running row's Timer advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, jobDetails, tick],
  );

  const statusOptions = useMemo<BadgeSelectOption[]>(
    () => distinctOptions(rows.map((row) => row.status)),
    [rows],
  );
  const typeOptions = useMemo<BadgeSelectOption[]>(
    () => distinctOptions(rows.map((row) => row.type)),
    [rows],
  );
  const projectOptions = useMemo<BadgeSelectOption[]>(
    () => distinctOptions(rows.flatMap((row) => parseProjects(row.project))),
    [rows],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (statusFilter.length > 0 && !statusFilter.includes(row.status)) return false;
        if (typeFilter.length > 0 && !typeFilter.includes(row.type)) return false;
        if (projectFilter.length > 0) {
          const projects = parseProjects(row.project);
          if (!projects.some((project) => projectFilter.includes(project))) return false;
        }
        return true;
      }),
    [rows, statusFilter, typeFilter, projectFilter],
  );

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
   * V1's columns, in V1's order, at V1's widths, with the headers Ivy derives from the property
   * names via `SplitPascalCase` (so `PlanId` reads "Plan Id" and `StatusMessage` "Status Message").
   * `Id` is present and hidden, as `.Hidden(t => t.Id)` leaves it: reachable from the column options
   * and absent from the DOM until then.
   */
  const columns = useMemo<DataTableColumn<JobRow>[]>(
    () => [
      { name: "id", header: "Id", width: "90px", hidden: true },
      {
        name: "status",
        header: "Status",
        width: "100px",
        accessor: (row) => row.status,
        cell: (_value, row) => (
          <div className="flex items-center gap-1">
            <Badge variant={JOB_STATUS_BADGE_VARIANT[row.status] ?? "secondary"} density="Small">
              {row.status}
            </Badge>
            {/* Not a V1 column: V1 has no notion of a detached job. `JobSessionView` shows the same
                badge for one, and a row that a previous daemon started is worth flagging where the
                Stop action is offered. */}
            {row.detached && (
              <Badge
                variant="warning"
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
        accessor: (row) => row.planId,
        cell: (_value, row) =>
          row.planId ? (
            onSelectPlan ? (
              <button
                type="button"
                className="font-mono text-xs text-foreground hover:underline"
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
        accessor: (row) => row.type,
        // V1 colours this from `Constants.JobTypeColors` (eleven hues) and Project from the project
        // palette. The design system has six semantic colours and no decorative ramp, and the
        // contract forbids adding one, so both render as one neutral chip: mapping eleven job types
        // onto `success`/`warning`/`destructive` would assert something about each that V1 does not.
        cell: (_value, row) => (
          <Badge variant="outline" density="Small">
            {row.type}
          </Badge>
        ),
      },
      {
        name: "project",
        header: "Project",
        width: "150px",
        accessor: (row) => row.project,
        cell: (_value, row) => (
          <div className="flex flex-wrap items-center gap-1">
            {parseProjects(row.project).map((project) => (
              <Badge key={project} variant="secondary" density="Small">
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
                Starting...
              </>
            ) : row.agentOutput === "done" ? (
              <span className="text-success">Done</span>
            ) : (
              NO_TIME
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
        accessor: (row) => row.statusMessage,
        cell: (_value, row) => (
          <span className="text-xs text-muted-foreground" title={row.statusMessage || undefined}>
            {row.statusMessage}
          </span>
        ),
      },
    ],
    // `onSelectPlan` and the sheet opener are the only closures the cells capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectPlan],
  );

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="jobs-view">
      {actionError && (
        <div
          role="alert"
          data-testid="jobs-action-error"
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
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
        // `.Density(Default: Large, Desktop: Medium)`. V2's DataTable takes one density rather than a
        // responsive pair, so this is the desktop value - the app is a desktop shell.
        density={Densities.Medium}
        columns={columns}
        rows={filteredRows}
        getRowId={(row) => row.id}
        loading={isLoading && jobs.length === 0}
        // `c.AllowSorting = true`, and `.SortDirection(t => t.Id, Descending)` with rows already
        // ordered by `ExtractJobNumber` descending: no initial sort override is needed, because that
        // *is* the order `buildJobRows` returns, and a header click takes over from there.
        allowSorting
        defaultSort={null}
        // `c.ShowIndexColumn = false` and `c.SelectionMode = SelectionModes.None`: neither the row
        // number nor a checkbox column. `selectable` defaults to false, and no index column exists.
        selectable={false}
        defaultPageSize={JOBS_PAGE_SIZE}
        showColumnOptions
        rowActions={(row) => buildJobRowActions(row, capabilities)}
        onRowAction={({ tag, row }) => {
          if (tag === "stop-job") {
            void runAction(() => jobsStore.cancelJob(row.id), "Stop");
          } else if (tag === "force-start-job") {
            void runAction(() => jobsStore.forceStartJob(row.id), "Force start");
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
          jobs.length === 0 ? (
            <span className="text-muted-foreground" data-testid="jobs-empty">
              No jobs yet. Starting a plan, a retry or a PR creates one.
            </span>
          ) : (
            <span className="text-muted-foreground" data-testid="jobs-empty-filtered">
              No jobs match the current filters.
            </span>
          )
        }
        toolbar={{
          // `c.AllowFiltering = true` with `c.ShowSearch = false`: Ivy gives every filterable column
          // a filter and deliberately no search box. V2's DataTable has no per-column filter, so the
          // three columns whose values form a closed set get the `BadgeSelect` filter `InboxView`
          // and `PullRequestsView` already use for the same `AllowFiltering` flag. The free-text
          // columns (Prompt, Status Message) have none, and no search box is added.
          left: (
            <div className="flex flex-wrap items-center gap-2">
              {statusOptions.length > 0 && (
                <div className="min-w-[160px]">
                  <BadgeSelect
                    id="jobs-status-filter"
                    options={statusOptions}
                    value={statusFilter}
                    placeholder="Filter by status..."
                    multiple
                    events={["OnChange"]}
                    eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                      if (args && Array.isArray(args[0])) setStatusFilter(args[0] as string[]);
                    }}
                  />
                </div>
              )}
              {typeOptions.length > 0 && (
                <div className="min-w-[160px]">
                  <BadgeSelect
                    id="jobs-type-filter"
                    options={typeOptions}
                    value={typeFilter}
                    placeholder="Filter by type..."
                    multiple
                    events={["OnChange"]}
                    eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                      if (args && Array.isArray(args[0])) setTypeFilter(args[0] as string[]);
                    }}
                  />
                </div>
              )}
              {projectOptions.length > 0 && (
                <div className="min-w-[160px]">
                  <BadgeSelect
                    id="jobs-project-filter"
                    options={projectOptions}
                    value={projectFilter}
                    placeholder="Filter by project..."
                    multiple
                    events={["OnChange"]}
                    eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                      if (args && Array.isArray(args[0])) setProjectFilter(args[0] as string[]);
                    }}
                  />
                </div>
              )}
            </div>
          ),
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
                    {/* V1 offers both unconditionally. They are gated on the capability here because
                      `bridge.clearJobs` does not exist yet - see `jobsStore.canClearJobs`. */}
                    {canClear && (
                      <DropdownMenuItem
                        data-testid="jobs-clear-completed"
                        onClick={() =>
                          void runAction(() => jobsStore.clearJobs("completed"), "Clear")
                        }
                      >
                        <Trash aria-hidden="true" />
                        Clear Completed
                      </DropdownMenuItem>
                    )}
                    {canClear && (
                      <DropdownMenuItem
                        data-testid="jobs-clear-failed"
                        onClick={() => void runAction(() => jobsStore.clearJobs("failed"), "Clear")}
                      >
                        <Trash aria-hidden="true" />
                        Clear Failed
                      </DropdownMenuItem>
                    )}
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
        <SheetContent
          data-testid="job-output-sheet"
          className="inset-y-0 w-full overflow-y-auto sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
        >
          <SheetHeader>
            <SheetTitle>{openJobTitle}</SheetTitle>
          </SheetHeader>
          {openJob && (
            <div className="mt-4">
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
            </div>
          )}
        </SheetContent>
      </Sheet>

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

/** Sorted, de-duplicated filter options for one column. */
function distinctOptions(values: readonly string[]): BadgeSelectOption[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)))
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
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
