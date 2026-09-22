import React from "react";
import { AgentViewer } from "@ivy-interactive/components/tendril";
import { isActiveStatus, jobsStore } from "../../state/jobsStore";
import type { JobDetail, JobStatus } from "../../types/api";
import { useTranslation, type TFunction } from "../../i18n";

/**
 * The live `AddProject` run - V1's `ProjectAgentStepView` body, which is an `AgentViewer` over the
 * promptware's stream. Used by the Add Project blade's second step and by the onboarding wizard's,
 * which is V1's sub-step 1.
 *
 * Split out of `AddProjectView` and loaded lazily because `AgentViewer` is the heaviest thing the
 * settings area can reach, and only a project that is actually being created needs it.
 *
 * The stream plumbing is `JobSessionView`'s, reduced to what one step needs: `subscribeToJob` picks
 * the native Tauri bridge (the HTTP route is bearer-authenticated and the webview holds no secret),
 * and the fold cache keeps a line's encode from being repeated - `AgentViewer` reads `jsonLines` by
 * length, so growing the array in place is what makes a long run linear rather than quadratic.
 */

/**
 * V1's `Text.Danger(session.Error)`, reduced to what a job row can answer.
 *
 * V1 derives the reason in the step itself - `LogJob.ReportedFailureReason`, else the last
 * `{"kind":"error"}` line, else the provider's `FailureAnalyzer` over stderr, else the exit code.
 * The daemon has already done all of that by the time the job row lands, and put the answer in
 * `reportedFailureReason`, so the only thing left is the last fallback.
 *
 * A cancel is not a failure: `Stopped` is what Skip and Back produce, and V1 sets no error for a run
 * it cancelled itself (`session.Cancelled`).
 *
 * The daemon's reason is shown as it is; only the fallbacks are this app's words.
 */
function failureMessage(
  t: TFunction<"onboarding">,
  detail: JobDetail | undefined,
  status: JobStatus | undefined,
): string | null {
  if (!status || status === "Completed" || status === "Stopped" || isActiveStatus(status)) {
    return null;
  }
  if (detail?.reportedFailureReason) return detail.reportedFailureReason;
  return status === "Timeout" ? t("agentRun.timedOut") : t("agentRun.failed");
}

export interface AddProjectAgentRunProps {
  jobId: string;
  /** Called once the run reaches a terminal status, which is what ungates the step's Next. */
  onFinished: () => void;
}

const noop = () => {};

export const AddProjectAgentRun: React.FC<AddProjectAgentRunProps> = ({ jobId, onFinished }) => {
  const { t } = useTranslation("onboarding");
  const [events, setEvents] = React.useState(() => jobsStore.getSessionEvents(jobId));
  const [status, setStatus] = React.useState<JobStatus | undefined>(
    () => jobsStore.getJobDetail(jobId)?.status,
  );
  const [detail, setDetail] = React.useState(() => jobsStore.getJobDetail(jobId));

  // Held in a ref so the effect below does not resubscribe every time the callback identity changes.
  const onFinishedRef = React.useRef(onFinished);
  onFinishedRef.current = onFinished;

  React.useEffect(() => {
    const unsubStore = jobsStore.subscribe(() => {
      setEvents(jobsStore.getSessionEvents(jobId));
      const current = jobsStore.getJobDetail(jobId);
      const summary = jobsStore.getState().jobs.find((job) => job.id === jobId);
      setDetail(current);
      setStatus((current ?? summary)?.status);
    });
    const unsubscribe = jobsStore.subscribeToJob(jobId, undefined, undefined, undefined, {
      onEnd: () => onFinishedRef.current(),
    });
    return () => {
      unsubStore();
      unsubscribe();
    };
  }, [jobId]);

  // A run that was already terminal when this mounted gets no `end` frame, so the step would wait
  // for one that is never coming.
  React.useEffect(() => {
    if (status && !isActiveStatus(status)) onFinishedRef.current();
  }, [status]);

  // `JobSessionView`'s line cache: append what the session has grown by rather than re-encoding the
  // whole run per frame. The generation counter rides on the viewer's `id` because `AgentViewer`
  // tracks this array by length and would not notice a session cleared and refilled to the same one.
  const lineCache = React.useRef<{
    source: typeof events | null;
    lines: string[];
    generation: number;
  }>({ source: null, lines: [], generation: 0 });
  if (lineCache.current.source !== events) {
    lineCache.current = {
      source: events,
      lines: [],
      generation: lineCache.current.generation + 1,
    };
  }
  const lines = lineCache.current.lines;
  for (let i = lines.length; i < events.length; i++) {
    const item = events[i];
    lines.push(item.rawText ?? JSON.stringify(item.payload));
  }

  const isRunning = status === undefined || isActiveStatus(status);
  const failure = failureMessage(t, detail, status);

  return (
    <div className="space-y-2">
      {/* V1 puts its danger line above the stream, so the reason is read before the output that
          produced it. Without one, a failed run ungated Next and looked exactly like a success. */}
      {failure && (
        <p className="text-xs text-destructive" data-testid="add-project-agent-error">
          {failure}
        </p>
      )}
      <div
        className="h-96 min-h-0 overflow-hidden rounded-box border border-border"
        data-testid="add-project-agent-viewer"
      >
        {/* Rendered even with no lines yet: the viewer's own status label reads "Starting...", and
            `ProjectAgentStepView.cs` says why it does not put a separate spinner above it - the
            bordered box swapping in on the first line is a layout shift for nothing. */}
        <AgentViewer
          id={`add-project-${jobId}#${lineCache.current.generation}`}
          jsonLines={lines.length > 0 ? lines : undefined}
          height="full"
          autoScroll={isRunning}
          showStatusLabel={isRunning}
          live={isRunning}
          eventHandler={noop}
        />
      </div>
    </div>
  );
};
