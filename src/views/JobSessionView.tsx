import React, { useState } from "react";
import { AgentViewer } from "components-storybook/tendril";
import { describeBridgeError, type Job, type JobDetail } from "../types/api";
import { jobsStore, type StreamEventItem } from "../state/jobsStore";

interface JobSessionViewProps {
  job: Job | JobDetail;
  events: StreamEventItem[];
  onCancel?: (jobId: string) => void | Promise<void>;
  onCloseTab?: () => void;
}

export const JobSessionView: React.FC<JobSessionViewProps> = ({
  job,
  events,
  onCancel,
  onCloseTab,
}) => {
  const [autoScroll, setAutoScroll] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Convert event items into jsonStream lines
  const jsonStream = events
    .map((e) => JSON.stringify(e.payload))
    .join("\n");

  const handleCancel = async () => {
    setIsCancelling(true);
    setCancelError(null);
    try {
      if (onCancel) {
        await onCancel(job.id);
      } else {
        await jobsStore.cancelJob(job.id);
      }
    } catch (err) {
      // A failed cancel means the job is still running; saying nothing would
      // leave the operator thinking they had stopped it.
      setCancelError(`Cancel failed: ${describeBridgeError(err)}`);
    } finally {
      setIsCancelling(false);
    }
  };

  const isRunning = job.status === "Running" || job.status === "Queued";
  const failureReason = (job as JobDetail).reportedFailureReason;
  const hasFailed =
    job.status === "Failed" ||
    job.status === "Timeout" ||
    job.status === "Blocked";
  const noop = () => {};

  return (
    <div className="flex h-full flex-col space-y-4" data-testid="job-session-view">
      {/* Session Header */}
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center space-x-3">
          <span className="font-mono text-xs font-bold text-slate-400">
            {job.id}
          </span>
          <span className="text-sm font-semibold text-slate-100">
            {job.type}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isRunning
                ? "bg-blue-950 text-blue-300 border border-blue-800 animate-pulse"
                : job.status === "Completed"
                ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                : "bg-red-950 text-red-300 border border-red-800"
            }`}
          >
            {job.status}
          </span>
          {job.planTitle && (
            <span className="text-xs text-slate-400">
              Plan: {job.planTitle}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`rounded px-2 py-1 text-xs transition ${
              autoScroll
                ? "bg-slate-800 text-emerald-400"
                : "bg-slate-900 text-slate-400"
            }`}
          >
            Auto-scroll: {autoScroll ? "ON" : "OFF"}
          </button>

          {isRunning && (
            <button
              type="button"
              disabled={isCancelling}
              onClick={handleCancel}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {isCancelling ? "Cancelling..." : "Cancel Job"}
            </button>
          )}

          {onCloseTab && (
            <button
              type="button"
              onClick={onCloseTab}
              aria-label="Close session tab"
              className="rounded p-1 text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {cancelError && (
        <div
          role="alert"
          data-testid="job-cancel-error"
          className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
        >
          {cancelError}
        </div>
      )}

      {/* The promptware's own account of why it stopped. Without this the
          operator only sees a red status pill and has to read the raw stream. */}
      {hasFailed && (failureReason || job.statusMessage) && (
        <div
          data-testid="job-failure-reason"
          className="rounded-xl border border-red-800 bg-red-950/40 p-4"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider text-red-300">
            Reported failure reason
          </h3>
          <p className="mt-1 text-sm whitespace-pre-wrap text-red-200">
            {failureReason || job.statusMessage}
          </p>
        </div>
      )}

      {/* Stream Viewer */}
      <div className="flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        <AgentViewer
          id={`agent-viewer-${job.id}`}
          jsonStream={jsonStream || JSON.stringify({ type: "status", message: "Waiting for agent output..." })}
          autoScroll={autoScroll}
          showThinking={true}
          groupToolCalls={true}
          eventHandler={noop}
        />
      </div>
    </div>
  );
};
