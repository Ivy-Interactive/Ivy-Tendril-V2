import React, { useState, useEffect } from "react";
import { AgentViewer } from "@ivy-interactive/components/tendril";
import { Callout } from "@ivy-interactive/components/ui";
import { describeBridgeError, type Job, type JobDetail, type JobStatus } from "../types/api";
import { jobsStore, type StreamEventItem } from "../state/jobsStore";
import { parseProjects } from "./PlansView";

interface JobSessionViewProps {
  job: Job | JobDetail;
  events?: StreamEventItem[];
  onCancel?: (jobId: string) => void | Promise<void>;
  onCloseTab?: () => void;
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

/** `FormatHelper.FormatTokens`: millions to one decimal, thousands to none. */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

/** `JobsApp.Data.cs` `FormatJobCost` via `FormatHelper.FormatCost`: two decimals, dollars. */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
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
    default:
      return "";
  }
}

/**
 * V1's job output sheet, as a tab.
 *
 * The layout mirrors `JobsApp.cs`'s output sheet: its title is `$"{job.Type} {ExtractPlanId(...)}"`,
 * and its body is `Sheets/OutputSheet.cs` - an `AgentViewer` for a job with output, and a callout
 * explaining itself for one without. Everything V1 puts in the Jobs table's cells for the same job
 * (status, timer, timestamp, cost, tokens, project) sits in the header, because a tab has no row
 * above it to carry them.
 */
export const JobSessionView: React.FC<JobSessionViewProps> = ({
  job,
  events = [],
  onCancel,
  onCloseTab,
}) => {
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

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

  const isRunning = currentJob.status === "Running" || currentJob.status === "Queued";
  // V1's Stop row action covers every state a job can still be taken out of, not just the two that
  // are already moving: `JobsApp.DataTable.cs` gates it on Running/Queued/Pending/Blocked.
  const canStop =
    currentJob.status === "Running" ||
    currentJob.status === "Queued" ||
    currentJob.status === "Pending" ||
    currentJob.status === "Blocked";

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

  return (
    <div className="flex h-full flex-col space-y-4" data-testid="job-session-view">
      {/* Header: the output sheet's title, plus the row the tab replaced. */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-muted-foreground">
              {currentJob.id}
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
          </div>
          {/* The output sheet's title: `$"{job.Type} {ExtractPlanId(job.PlanFile)}"`. */}
          <h1 className="mt-2 truncate text-2xl font-bold text-foreground">
            {planId ? `${currentJob.type} ${planId}` : currentJob.type}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {currentJob.planTitle && <span className="truncate">{currentJob.planTitle}</span>}
            {timer !== "-" && <span data-testid="job-timer">{timer}</span>}
            {timestamp !== "-" && <span>{timestamp}</span>}
            {currentJob.cost !== undefined && <span>{formatCost(currentJob.cost)}</span>}
            {currentJob.tokens !== undefined && <span>{formatTokens(currentJob.tokens)}</span>}
          </div>
        </div>

        {/* V1's row actions, in their order (`JobsApp.DataTable.cs` `RowActions`): Stop first.
            Rerun, Force Start, Debug and Delete have no bridge call to reach yet. */}
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

          {onCloseTab && (
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
      <div className="min-h-0 flex-1 overflow-hidden">
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
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="job-no-output">
            No output available.
          </p>
        )}
      </div>
    </div>
  );
};
