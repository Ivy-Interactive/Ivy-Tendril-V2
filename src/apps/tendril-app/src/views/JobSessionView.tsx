import React, { useState, useEffect } from "react";
import { AgentViewer } from "@ivy-interactive/components/tendril";
import { Callout } from "@ivy-interactive/components/ui";
import { describeBridgeError, type Job, type JobDetail, type JobStatus } from "../types/api";
import { isActiveStatus, jobsStore, type StreamEventItem } from "../state/jobsStore";
import { ConfirmDialog } from "./dialogs";
import { parseProjects } from "./PlansView";

interface JobSessionViewProps {
  job: Job | JobDetail;
  events?: StreamEventItem[];
  onCancel?: (jobId: string) => void | Promise<void>;
  onCloseTab?: () => void;
  /**
   * How this is framed. V1's job output is a **sheet over the Jobs table**
   * (`Apps/Jobs/Sheets/OutputSheet.cs`, opened from the table's Agent Output cell), so `"sheet"` is
   * what `JobsView` renders: the sheet's own header carries V1's title
   * (`$"{job.Type} {ExtractPlanId(job.PlanFile)}"`) and its own close control, so neither is drawn
   * again here, and the body scrolls with the sheet rather than filling a page.
   *
   * `"page"` is the older full-view framing, kept for any caller that still mounts this as a view.
   */
  layout?: "page" | "sheet";
}

/**
 * Job status to badge classes, from `Constants.JobStatusColors` (V1 `src/Ivy.Tendril/Constants.cs`):
 * Running is Blue, Completed is Green, Failed and Timeout are Red, Queued and Pending are Amber,
 * Blocked is Orange, Stopped is Gray.
 *
 * Semantic tokens only, which collapses V1's Amber and Orange onto the one `warning` token the design
 * system has. That keeps Blocked reading the same as it does on a plan (`PLAN_STATE_BADGE_CLASS` maps
 * Blocked to warning too) at the cost of the amber/orange distinction, which carried no meaning V1
 * relied on. `--primary` is Ivy green and is never reached for here: a status badge that borrowed it
 * would read as "succeeded" on a job that has not run.
 */
const JOB_STATUS_BADGE_CLASS: Record<JobStatus, string> = {
  Running: "border-info/40 bg-info/10 text-info",
  Completed: "border-success/40 bg-success/10 text-success",
  Failed: "border-destructive/40 bg-destructive/10 text-destructive",
  Timeout: "border-destructive/40 bg-destructive/10 text-destructive",
  Queued: "border-warning/40 bg-warning/10 text-warning",
  Pending: "border-warning/40 bg-warning/10 text-warning",
  Blocked: "border-warning/40 bg-warning/10 text-warning",
  Stopped: "border-border bg-transparent text-muted-foreground",
};

/** `JobsApp.Helpers.cs` `FormatTimeSpan`: hours drop the seconds, a sub-minute span is seconds only. */
function formatTimeSpan(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours >= 1) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes === 0) return `${secs}s`;
  return `${minutes}m ${String(secs).padStart(2, "0")}s`;
}

/**
 * The Timer cell (`JobsApp.Helpers.cs` `FormatTimer`): a running job counts up from when it started,
 * a finished one shows how long it took, and anything else gets "-" rather than a misleading zero.
 */
function formatTimer(job: Job): string {
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  if (job.status === "Running" && !Number.isNaN(started)) {
    return formatTimeSpan((Date.now() - started) / 1000);
  }
  const finished = job.completedAt ? Date.parse(job.completedAt) : NaN;
  const isTerminal =
    job.status === "Completed" ||
    job.status === "Failed" ||
    job.status === "Timeout" ||
    job.status === "Stopped";
  if (isTerminal && !Number.isNaN(started) && !Number.isNaN(finished)) {
    return formatTimeSpan((finished - started) / 1000);
  }
  return "-";
}

/**
 * The Timestamp cell (`JobsApp.Helpers.cs` `FormatTimestamp`): when the job finished, as a clock in
 * the viewer's local time, in V1's `MM-dd HH:mm` shape. A job that has not finished gets "-", the
 * same placeholder the Timer uses.
 */
function formatTimestamp(job: Job): string {
  if (!job.completedAt) return "-";
  const completed = new Date(job.completedAt);
  if (Number.isNaN(completed.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(completed.getMonth() + 1)}-${pad(completed.getDate())} ${pad(
    completed.getHours(),
  )}:${pad(completed.getMinutes())}`;
}

/**
 * `JobsApp.Data.cs` and `JobCostSheet.cs` both use this for "nothing recorded here". Keeping V1's
 * em-dash rather than an empty string is what stops a job that reported no cost from reading as one
 * that cost nothing: `Cost —` and `Cost $0.00` are different claims.
 */
const NO_VALUE = "—";

/**
 * `FormatHelper.FormatTokens`: millions to one decimal, thousands to none.
 *
 * A million-plus count keeps scaling rather than saturating, so a 1.4-billion-token run reads
 * "1400.0M" exactly as V1's `(tokens / 1_000_000.0).ToString("F1")` does. A non-finite or negative
 * count is not a token count at all and is reported as absent rather than as "NaN".
 */
function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return NO_VALUE;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

/** `FormatHelper.FormatCount`: the exact figure, grouped, for the tooltip behind the short form. */
function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

/** `JobsApp.Data.cs` `FormatJobCost` via `FormatHelper.FormatCost`: two decimals, dollars. */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/**
 * The Cost cell, `JobsApp.Data.cs` `FormatJobCost`.
 *
 * Returns `null` where V1 returns `""` - the job has no cost figure at all, which is the normal
 * state of a subscription-plan run: the agent reports tokens and no charge. The caller renders
 * {@link NO_VALUE} for that, so it cannot be mistaken for a charge of zero.
 *
 * An estimate derived from tokens times the price list carries V1's `"~"` prefix
 * (`JobCostSources.Estimated`), so a figure nobody was actually billed never presents itself as one.
 *
 * The comparison is case-insensitive because the value on the wire is lower case: V1 writes
 * `"estimated"` (`Services/Jobs/JobUsageSnapshot.cs:22`) and so does the daemon
 * (`jobs/manager.rs:2909`). This matched `"Estimated"` exactly, dating from when `costSource` was not
 * on the DTO at all and its casing was a guess, so the tilde never actually appeared on an estimate.
 */
function formatJobCost(job: Job): string | null {
  if (job.cost === undefined || job.cost === null || !Number.isFinite(job.cost)) return null;
  const formatted = formatCost(job.cost);
  return job.costSource?.toLowerCase() === "estimated" ? `~${formatted}` : formatted;
}

/**
 * `JobsApp.Helpers.cs` `GetStatusMessage`: the job's own message where it has one, and otherwise
 * V1's per-status default. A status with no default (Running, Completed) says nothing.
 */
function statusMessage(job: Job): string {
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
    // `GetStatusMessage` has no Pending default because V1's Pending rows are transient in the
    // table, but `OutputSheet.cs:42-47` - the sheet this view replaces - does:
    // `Callout.Info("Job is queued and waiting to start.", "Job Pending")`. Without it a Pending
    // job showed a warning badge and nothing else.
    case "Pending":
      return "Job is queued and waiting to start.";
    default:
      return "";
  }
}

/**
 * `Helpers/JobId.cs` `Normalize`: ids are allocated as zero-padded five-digit numbers
 * (`JobIdAllocator`), and every V1 surface that receives one pads it, because a bare `458` and
 * `00458` are the same job. V2 reaches this view with whatever the caller had - `activeNav` strips a
 * `job-` prefix off a nav id, and `acceptInboxProposal` returns a raw `jobId` - so the display is
 * normalised here rather than trusting it.
 */
export function normalizeJobId(id: string): string {
  const trimmed = id.trim();
  return /^\d+$/.test(trimmed) ? trimmed.padStart(5, "0") : trimmed;
}

/**
 * V1's job output sheet.
 *
 * The layout mirrors `JobsApp.cs`'s output sheet: its title is `$"{job.Type} {ExtractPlanId(...)}"`,
 * and its body is `Sheets/OutputSheet.cs` - an `AgentViewer` for a job with output, and a callout
 * explaining itself for one without. Everything V1 puts in the Jobs table's cells for the same job
 * (status, timer, timestamp, cost, tokens, project) sits in the header, so a reader who opened the
 * sheet from the table does not have to close it again to see them.
 *
 * See {@link JobSessionViewProps.layout}: this was a full page tab, which was a structural
 * divergence - V1 opens it over the table and the operator keeps their place in the list.
 */
export const JobSessionView: React.FC<JobSessionViewProps> = ({
  job,
  events = [],
  onCancel,
  onCloseTab,
  layout = "page",
}) => {
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [isForceStarting, setIsForceStarting] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [storeState, setStoreState] = useState(() => ({
    job:
      jobsStore.getJobDetail(job.id) ||
      jobsStore.getState().jobs.find((j) => j.id === job.id) ||
      job,
    events: jobsStore.getSessionEvents(job.id),
  }));

  useEffect(() => {
    setStoreState({
      job:
        jobsStore.getJobDetail(job.id) ||
        jobsStore.getState().jobs.find((j) => j.id === job.id) ||
        job,
      events: jobsStore.getSessionEvents(job.id),
    });
  }, [job]);

  useEffect(() => {
    const unsubStore = jobsStore.subscribe(() => {
      const detail = jobsStore.getJobDetail(job.id);
      const summary = jobsStore.getState().jobs.find((j) => j.id === job.id);
      const currentEvents = jobsStore.getSessionEvents(job.id);
      setStoreState({
        job: detail || summary || job,
        events: currentEvents,
      });
    });

    // No base URL and no token on purpose: the store picks the transport that can authenticate. Under
    // Tauri that is the native bridge, because `/api/jobs/:id/events` is bearer-authenticated and the
    // webview never sees the secret - handing this call an origin would put it back on the
    // unauthenticated `fetch` that made every job subscription a 401 and left this view with no output.
    const unsubscribe = jobsStore.subscribeToJob(job.id);

    return () => {
      unsubStore();
      unsubscribe();
    };
  }, [job.id]);

  const currentJob =
    storeState.job.id === job.id
      ? {
          ...job,
          ...storeState.job,
        }
      : job;

  const currentEvents = storeState.events.length > 0 ? storeState.events : events;

  // Convert event items into jsonStream lines
  const jsonStream = currentEvents.map((e) => JSON.stringify(e.payload)).join("\n");

  // `OutputSheet.cs:52` keys the live viewer on `Status == Running` and nothing else. Queued was
  // included here, which meant a job still waiting for a slot got an animated "Working..." label and
  // an autoscrolling viewer over an empty log - the sheet says the opposite about a job that has not
  // started.
  const isRunning = currentJob.status === "Running";

  // V1's Stop row action covers every state a job can still be taken out of, not just the two that
  // are already moving: `JobsApp.DataTable.cs:183` gates it on Running/Queued/Pending/Blocked.
  const canStop = isActiveStatus(currentJob.status);

  // `Force Start` (`JobsApp.DataTable.cs:195`) is Blocked-only: the point of it is to skip the
  // dependency gate that is holding the job, and there is no gate to skip in any other state.
  const canForceStart = currentJob.status === "Blocked" && jobsStore.canForceStartJob();

  // `Delete` (`JobsApp.DataTable.cs:207`) is offered in every state, terminal ones included: V1 adds
  // it unconditionally, and the confirm's handler stops a live job first.
  const canDelete = jobsStore.canDeleteJob();

  // A running job's timer counts up. V1 gets this from the Jobs table's one-second cell update
  // stream (`BuildDataTableUpdates`); here it is a tick on the same interval, and only while running.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (currentJob.status !== "Running") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [currentJob.status]);

  const handleStop = async () => {
    setIsStopping(true);
    setStopError(null);
    try {
      if (onCancel) {
        await onCancel(currentJob.id);
      } else {
        await jobsStore.cancelJob(currentJob.id);
      }
    } catch (err) {
      // A failed stop means the job is still running; saying nothing would
      // leave the operator thinking they had stopped it.
      setStopError(`Stop failed: ${describeBridgeError(err)}`);
    } finally {
      setIsStopping(false);
    }
  };

  const handleForceStart = async () => {
    setIsForceStarting(true);
    setStopError(null);
    try {
      await jobsStore.forceStartJob(currentJob.id);
    } catch (err) {
      setStopError(`Force start failed: ${describeBridgeError(err)}`);
    } finally {
      setIsForceStarting(false);
    }
  };

  // `JobsApp.DataTable.cs:302-315`: the confirm's own handler stops a live job and then deletes,
  // and only then closes. A rejection keeps the dialog open with the reason on it rather than
  // dismissing as though it had worked.
  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await jobsStore.deleteJob(currentJob.id);
      setIsConfirmDeleteOpen(false);
      // `jobsStore.deleteJob` already re-reads the list, so the host needs nothing but the close:
      // the tab is pointing at a job that no longer exists.
      onCloseTab?.();
    } catch (err) {
      setDeleteError(`Delete failed: ${describeBridgeError(err)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const failureReason = (currentJob as JobDetail).reportedFailureReason;
  const message = failureReason || statusMessage(currentJob);
  // Failed and Timeout are V1's two red statuses; Blocked, Queued, Pending and Stopped explain
  // themselves without claiming something went wrong.
  const isFailure = currentJob.status === "Failed" || currentJob.status === "Timeout";
  const explainsItself =
    isFailure ||
    currentJob.status === "Blocked" ||
    currentJob.status === "Queued" ||
    currentJob.status === "Pending" ||
    currentJob.status === "Stopped";

  const timer = formatTimer(currentJob);
  const timestamp = formatTimestamp(currentJob);
  const planId = currentJob.planId;
  const noop = () => {};

  // The Cost and Tokens cells. V1 has two labelled columns, so an empty Cost beside a populated
  // Tokens is already legible; a tab has no column headers, so the labels come inline. Both are
  // rendered together whenever either has a figure: a subscription-plan run - tokens spent, nothing
  // billed - then reads "Tokens 450,000 · Cost —" rather than dropping the cost silently and looking
  // like a run whose cost simply has not landed yet.
  const cost = formatJobCost(currentJob);
  const tokens = currentJob.tokens;
  const hasUsage = cost !== null || tokens !== undefined;

  const isSheet = layout === "sheet";

  return (
    <div
      className={`flex flex-col space-y-4 ${isSheet ? "" : "h-full"}`}
      data-testid="job-session-view"
    >
      {/* Header: the output sheet's title, plus the row the table showed. */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-muted-foreground">
              {normalizeJobId(currentJob.id)}
            </span>
            <span
              data-testid="job-status-badge"
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                JOB_STATUS_BADGE_CLASS[currentJob.status] ??
                "border-border bg-transparent text-muted-foreground"
              }`}
            >
              {currentJob.status}
            </span>
            {/* `ProjectHelper.ParseProjects`: a job's project field can name several. */}
            {parseProjects(currentJob.project).map((project) => (
              <span
                key={project}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {project}
              </span>
            ))}
            {/* From 751bed8: a job supervised across a daemon restart, as opposed to one this
                session started end to end. */}
            {currentJob.detached && (
              <span
                data-testid="job-detached-badge"
                className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning"
              >
                Detached (PID {currentJob.processId}) — Monitoring active process
              </span>
            )}
          </div>
          {/* The output sheet's title: `$"{job.Type} {ExtractPlanId(job.PlanFile)}"`. Drawn here
              only for the page framing - in a sheet it is the `SheetTitle`, as it is in V1. */}
          {!isSheet && (
            <h1 className="mt-2 truncate text-2xl font-bold text-foreground">
              {planId ? `${currentJob.type} ${planId}` : currentJob.type}
            </h1>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {currentJob.planTitle && <span className="truncate">{currentJob.planTitle}</span>}
            {timer !== "-" && <span data-testid="job-timer">{timer}</span>}
            {timestamp !== "-" && <span>{timestamp}</span>}
            {hasUsage && (
              <span
                data-testid="job-tokens"
                title={tokens !== undefined ? formatTokenCount(tokens) : undefined}
              >
                Tokens {tokens !== undefined ? formatTokens(tokens) : NO_VALUE}
              </span>
            )}
            {hasUsage && (
              <span
                data-testid="job-cost"
                title={cost === null ? "No cost was reported for this job" : undefined}
              >
                Cost {cost ?? NO_VALUE}
              </span>
            )}
          </div>
        </div>

        {/* V1's row actions, in their order (`JobsApp.DataTable.cs` `RowActions`): Stop, Rerun,
            Force Start, Debug, Delete. Rerun and Debug are still absent - Rerun needs V1's
            `RerunJobDialog` and the job's original `TypedArgs`, which the DTO layer does not carry,
            and Debug needs `JobDebugSheet`. Both are reported rather than stubbed. */}
        <div className="flex flex-wrap items-center gap-2">
          {canStop && (
            <button
              type="button"
              disabled={isStopping}
              onClick={handleStop}
              title="Stop this job"
              className="rounded-selector bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition hover:bg-destructive/90 disabled:opacity-50"
            >
              {isStopping ? "Stopping..." : "Stop"}
            </button>
          )}

          {canForceStart && (
            <button
              type="button"
              data-testid="job-force-start"
              disabled={isForceStarting}
              onClick={handleForceStart}
              title="Force start this blocked job"
              className="rounded-selector border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              {isForceStarting ? "Starting..." : "Force Start"}
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              data-testid="job-delete"
              onClick={() => {
                setDeleteError(null);
                setIsConfirmDeleteOpen(true);
              }}
              title="Delete this job"
              className="rounded-selector border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/10"
            >
              Delete
            </button>
          )}

          {/* A sheet has its own close control; a second one beside Delete is noise. */}
          {onCloseTab && !isSheet && (
            <button
              type="button"
              onClick={onCloseTab}
              aria-label="Close session tab"
              className="rounded-selector p-1 text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {stopError && <Callout.Error data-testid="job-cancel-error">{stopError}</Callout.Error>}

      {/* `OutputSheet.cs`: `Callout.Info(job.StatusMessage, $"Job {job.Status}")` - the job's own
          account of where it is, which for a failure is the promptware's reported reason. Without
          this a failed job is a red badge and a raw stream. */}
      {explainsItself && message && (
        <Callout
          variant={isFailure ? "error" : "info"}
          title={`Job ${currentJob.status}`}
          data-testid="job-failure-reason"
        >
          <p className="whitespace-pre-wrap">{message}</p>
        </Callout>
      )}

      {/* Output. `OutputSheet.cs` decides between three things: a viewer following a live stream, a
          viewer showing a finished one, and a job that produced nothing at all. */}
      {/* A sheet scrolls, so the viewer gets a floor rather than the remaining height of a page:
          `flex-1` inside a scrolling container resolves to the content's own height, which for an
          empty log is zero and hides the viewer entirely. */}
      <div className={isSheet ? "min-h-96" : "min-h-0 flex-1 overflow-hidden"}>
        {jsonStream ? (
          <AgentViewer
            id={`agent-viewer-${currentJob.id}`}
            jsonStream={jsonStream}
            height="full"
            // `.AutoScroll(false).ShowStatusLabel(false)` once the job is no longer running: nothing
            // more is coming, so following the bottom would only fight the reader, and an animated
            // "Working..." under a finished log is a lie.
            autoScroll={isRunning}
            showStatusLabel={isRunning}
            eventHandler={noop}
          />
        ) : isRunning ? (
          // A running job with no output yet gets the viewer anyway: its own status label reads
          // "Starting..." (`ProjectAgentStepView.cs` makes the same choice, and says why - a separate
          // loading indicator only shifts the layout when the first line arrives).
          <AgentViewer
            id={`agent-viewer-${currentJob.id}`}
            height="full"
            autoScroll
            showStatusLabel
            eventHandler={noop}
          />
        ) : explainsItself && message ? null : ( // a contradiction. // available." directly under "Waiting for a job slot to become available", which reads as // text is only reached when there is nothing to say. Rendering both put "No output // `OutputSheet.cs:26-49` **returns** its callout for a job with no output; the fallback
          <p className="text-sm text-muted-foreground" data-testid="job-no-output">
            No output available.
          </p>
        )}
      </div>

      {/* `JobsApp.DataTable.cs:296-317`, copy included: header "Delete Job", body "Are you sure you
          want to delete this job? This cannot be undone.", a destructive "Delete". `ConfirmDialog`
          deliberately focuses Cancel rather than V1's `.AutoFocus()` on the confirm; that departure
          is documented there. */}
      {canDelete && (
        <ConfirmDialog
          isOpen={isConfirmDeleteOpen}
          onClose={() => setIsConfirmDeleteOpen(false)}
          title="Delete Job"
          body={<p>Are you sure you want to delete this job? This cannot be undone.</p>}
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={handleDelete}
          isBusy={isDeleting}
          error={deleteError}
          testId="job-delete-dialog"
        />
      )}
    </div>
  );
};
