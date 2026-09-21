import React, { useState, useEffect, useRef } from "react";
import { NO_VALUE, formatCost, formatTimeSpan, formatTokens } from "@ivy-interactive/components";
import { AgentViewer } from "@ivy-interactive/components/tendril";
import { Badge, Button, Callout, IconButton } from "@ivy-interactive/components/ui";
import { X } from "lucide-react";
import { describeBridgeError, type Job, type JobDetail } from "../types/api";
import { isActiveStatus, jobsStore, type StreamEventItem } from "../state/jobsStore";
import { JOB_STATUS_COLOR, UNMAPPED_COLOR, projectColor } from "../utils/jobStatus";
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
 * The default for `events`, hoisted so it is the *same* empty array on every render.
 *
 * `events = []` in the signature mints a new one each time, which the line cache below would read as
 * "different session" and rebuild against on every render.
 */
const NO_EVENTS: StreamEventItem[] = [];

/** `FormatHelper.FormatCount`: the exact figure, grouped, for the tooltip behind the short form. */
function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString("en-US");
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
  events = NO_EVENTS,
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

  // The eventwire lines the viewer folds, grown in step with the session rather than rebuilt from it.
  //
  // This used to be `currentEvents.map((e) => JSON.stringify(e.payload)).join("\n")`, evaluated on
  // every store notification — and the store notifies once per streamed frame. So frame *n* re-encoded
  // and re-joined all *n* lines the session held, and the viewer then re-parsed the result: quadratic
  // in the length of the run, in a component that renders while a job is producing output. At 3k frames
  // that measured 1.4 seconds of pure JS; at 100k it does not finish.
  //
  // `rawText` is what the store already recorded for the frame (`JSON.stringify(payload)` for the
  // objects `parseJobFrame` produces, and the line itself for one that was not JSON), so the encode
  // is not repeated either. The generation counter goes on the viewer's `id`: `AgentViewer` reads this
  // array by length and would not otherwise notice a session that was cleared and refilled to the same
  // length.
  const lineCache = useRef<{
    source: StreamEventItem[] | null;
    lines: string[];
    generation: number;
  }>({ source: null, lines: [], generation: 0 });
  if (lineCache.current.source !== currentEvents) {
    lineCache.current = {
      source: currentEvents,
      lines: [],
      generation: lineCache.current.generation + 1,
    };
  }
  const eventLines = lineCache.current.lines;
  for (let i = eventLines.length; i < currentEvents.length; i++) {
    const item = currentEvents[i];
    // `rawText` is optional on the type, and a caller passing `events` in by hand may omit it, so the
    // encode this used to do for every frame is still the fallback for a frame that has no text.
    eventLines.push(item.rawText ?? JSON.stringify(item.payload));
  }
  const viewerId = `agent-viewer-${currentJob.id}#${lineCache.current.generation}`;

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
    // `h-full min-h-0` in both framings now. The sheet used to omit it because its `HeaderLayout`
    // scrolled the content, and a height against a scrolling parent is a height against nothing; the
    // sheet hands the log its own definite box instead (see `JobsView`'s `scrollContent={false}`), and
    // this is the link in that chain — without it the height dies here and the metrics footer goes
    // back to floating at the end of the log.
    <div className="flex h-full min-h-0 flex-col space-y-4" data-testid="job-session-view">
      {/* Header: the output sheet's title, plus the row the table showed.

          The rule under it is drawn for the page only. In the sheet this block is one of three
          full-width rules stacked within ~50px of each other — under the sheet title, under here, and
          over the metrics footer — and three parallel lines read as a form, not as a hierarchy. The
          page has no sheet title above it, so there its rule is the only one and still separates the
          job's identity from its output. `pb-4` goes with the border: it is the padding that held the
          meta text off the rule, so left behind it would stack on the root's `space-y-4` for ~35px of
          gap where the line used to be — a removal that reads as a hole rather than as tightening. */}
      <div
        className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${
          isSheet ? "" : "border-b border-border pb-4"
        }`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-muted-foreground">
              {normalizeJobId(currentJob.id)}
            </span>
            {/* Same badge the Jobs table draws, on the same `Constants.JobStatusColors` mapping, so
                the sheet header and the row behind it read identically. */}
            <Badge
              data-testid="job-status-badge"
              color={JOB_STATUS_COLOR[currentJob.status] ?? UNMAPPED_COLOR}
              density="Small"
            >
              {currentJob.status}
            </Badge>
            {/* `ProjectHelper.ParseProjects`: a job's project field can name several. */}
            {parseProjects(currentJob.project).map((project) => (
              <Badge key={project} color={projectColor(project)} density="Small">
                {project}
              </Badge>
            ))}
            {/* From 751bed8: a job supervised across a daemon restart, as opposed to one this
                session started end to end. */}
            {currentJob.detached && (
              <Badge data-testid="job-detached-badge" color="Orange" density="Small">
                Detached (PID {currentJob.processId}) — Monitoring active process
              </Badge>
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
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isStopping}
              onClick={handleStop}
              title="Stop this job"
              className="h-auto rounded-selector px-3 py-1.5 text-xs"
            >
              {isStopping ? "Stopping..." : "Stop"}
            </Button>
          )}

          {canForceStart && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="job-force-start"
              disabled={isForceStarting}
              onClick={handleForceStart}
              title="Force start this blocked job"
              className="h-auto rounded-selector px-3 py-1.5 text-xs"
            >
              {isForceStarting ? "Starting..." : "Force Start"}
            </Button>
          )}

          {/* Delete is `outline` with the destructive tint it already had rather than the solid
              `destructive` fill: Stop is the loud one in this row, and two filled reds side by
              side stop reading as a hierarchy. */}
          {canDelete && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="job-delete"
              onClick={() => {
                setDeleteError(null);
                setIsConfirmDeleteOpen(true);
              }}
              title="Delete this job"
              className="h-auto rounded-selector border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Delete
            </Button>
          )}

          {/* A sheet has its own close control; a second one beside Delete is noise. An X icon
              rather than the "✕" glyph this used to draw: every other close in the app is
              `lucide-react`'s, and a text glyph does not line up with one. */}
          {onCloseTab && !isSheet && (
            <IconButton label="Close session tab" size="md" tone="muted" onClick={onCloseTab}>
              <X className="size-4" />
            </IconButton>
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
      {/* One box for both framings now. The sheet used to take a `min-h-96` floor instead, because a
          `flex-1` inside `HeaderLayout`'s scroller resolved to the content's own height and an empty
          log collapsed the viewer to nothing. That reasoning ended when the sheet stopped scrolling
          its content: `flex-1` against a definite parent is the remaining space, so an empty log is
          given the rest of the sheet rather than zero. The floor was also the bug the user reported —
          a `min-height` is not a height, so `AgentViewer`'s `height: 100%` had nothing to resolve
          against, the shell sized to its content, and the metrics footer pinned to the bottom of a box
          that stopped short of the sheet. 414.72px of reserved space (`--spacing` is 0.27rem here, not
          Tailwind's 0.25) sat under it whenever the log was shorter than the floor. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {eventLines.length > 0 ? (
          <AgentViewer
            id={viewerId}
            jsonLines={eventLines}
            height="full"
            // The third of the sheet's stacked rules. The viewer now fills the sheet, so the strip
            // sits on the sheet's own bottom edge and has nothing left to divide it from.
            showMetricsDivider={!isSheet}
            // `.AutoScroll(false).ShowStatusLabel(false)` once the job is no longer running: nothing
            // more is coming, so following the bottom would only fight the reader, and an animated
            // "Working..." under a finished log is a lie.
            autoScroll={isRunning}
            showStatusLabel={isRunning}
            // Stops the metrics footer's elapsed timer for a job that stopped without saying so. A
            // killed or timed-out run reports no terminal result, so the stream alone cannot tell that
            // it is over, and the timer would tick on against a start that may be days old.
            live={isRunning}
            eventHandler={noop}
          />
        ) : isRunning ? (
          // A running job with no output yet gets the viewer anyway: its own status label reads
          // "Starting..." (`ProjectAgentStepView.cs` makes the same choice, and says why - a separate
          // loading indicator only shifts the layout when the first line arrives).
          <AgentViewer
            id={viewerId}
            height="full"
            showMetricsDivider={!isSheet}
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
