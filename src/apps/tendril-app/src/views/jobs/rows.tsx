import { Bug, EllipsisVertical, Pause, RotateCcw, RotateCw, Trash, Zap } from "lucide-react";
import type { DataTableRowAction, StackedProgressSegment } from "@ivy-interactive/components/ui";
import type { Job, JobDetail, JobStatus } from "../../types/api";
import { isActiveStatus } from "../../state/jobsStore";
import { JOB_STATUS_SEGMENT_COLOR } from "../../utils/jobStatus";
import { parseProjects } from "../PlansView";
import {
  agentOutputLabel,
  formatJobCost,
  jobStatusMessage,
  truncatePrompt,
  type AgentOutputState,
} from "./format";

/**
 * `JobsApp.Data.cs`: the row the table renders, how one is built from a `Job`, the per-row menu
 * (`JobsApp.DataTable.cs`' `RowActions`) and the status progress bar over the same statuses. What a
 * row *is*, as against how its cells are drawn - see `./columns.tsx` for the latter.
 */

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

/**
 * The Prompt cell's text: `JobsApp.Helpers.cs` `GetPromptDisplay`.
 *
 * V1 walks the plan's own title, then `ReportedPlanTitle`, then the job's typed args, and only then
 * gives up to the plan file. The daemon has already collapsed V1's first two steps into `planTitle`
 * — it resolves the plan and reports the title onto the row — so the chain here is `planTitle`, then
 * `prompt` (the operator's own words, from the typed args), then the plan id.
 *
 * The `prompt` step is the one that was missing. A `CreatePlan` has no plan until its agent has
 * reported one, so `planTitle` and `planId` are both empty for its whole run — which for a batch
 * imported from the Inbox is every row in the table, each showing a blank Prompt beside a filled
 * Type and Project. The description those jobs were launched with was on the record the entire time.
 *
 * Empty strings are skipped rather than accepted: the daemon omits an absent field, but a row that
 * arrived through a different path can carry `""`, and taking it would stop the chain one step early
 * and render the same blank cell.
 */
export function promptSource(job: Job): string | undefined {
  return [job.planTitle, job.prompt, job.planId].find(
    (candidate) => candidate !== undefined && candidate !== null && candidate.trim() !== "",
  );
}

export function promptDisplay(job: Job): string {
  return truncatePrompt(promptSource(job));
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
 * job's typed args, and the DTO now carries all three — see {@link promptDisplay}.
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
      prompt: promptDisplay(job),
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
  canRelaunch?: boolean;
  canRetry?: boolean;
}

/**
 * `JobsApp.DataTable.cs` `RowActions`, in V1's order and with V1's labels, icons and tooltips:
 * Stop, Relaunch, Retry Last Step, Force Start, Debug, Delete.
 *
 * - **Stop** covers every state a job can still be taken out of, not just the two already moving
 *   (`:183`, and `isActiveStatus` is the same set).
 * - **Relaunch Job** and **Retry Last Step**: available for Stopped, Failed, and Timeout jobs,
 *   opening a feedback dialog before re-dispatching.
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
    if (capabilities.canRelaunch !== false) {
      items.push({
        tag: "relaunch-job",
        label: "Relaunch Job",
        icon: <RotateCw aria-hidden="true" />,
        tooltip: "Relaunch this job entirely with optional feedback",
      });
    }
    if (capabilities.canRetry !== false) {
      items.push({
        tag: "retry-step",
        label: "Retry Last Step",
        icon: <RotateCcw aria-hidden="true" />,
        tooltip: "Retry the last step of this job with optional feedback",
      });
    }
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
