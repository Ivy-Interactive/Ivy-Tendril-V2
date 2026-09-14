import React, { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@ivy-interactive/components/ui";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Cpu,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { Job } from "../types/api";
import { isCompletedJob, isFailedJob, isRunningJob } from "../utils/jobStatus";

const jobsLabel = (count: number) => `${count} job${count === 1 ? "" : "s"}`;

export interface JobsMenuProps {
  jobs: Job[];
  /** The jobs were spawned by this conversation rather than merely running somewhere. */
  spawned?: boolean;
  /** A job that reported a plan becomes a button that opens it. */
  onOpenPlan?: (planId: string) => void;
  /** Offered once every listed job has finished. */
  onReviewJobs?: () => void;
}

/**
 * The header's jobs pill: a live count that opens a list of the conversation's jobs, each one a
 * shortcut to its plan. Once they have all finished it also offers to ask the agent to review the
 * outcomes, which is the point of tracking them in the conversation at all.
 */
export const JobsMenu: React.FC<JobsMenuProps> = ({
  jobs,
  spawned = false,
  onOpenPlan,
  onReviewJobs,
}) => {
  const [open, setOpen] = useState(false);

  const runningCount = jobs.filter(isRunningJob).length;
  const completedCount = jobs.filter(isCompletedJob).length;
  const failedCount = jobs.filter(isFailedJob).length;
  const allFinished = runningCount === 0 && jobs.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="chat-jobs-badge"
          aria-label="View running jobs"
          aria-expanded={open}
          title={runningCount > 0 ? `${runningCount} job(s) running` : "View jobs"}
          className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            runningCount > 0
              ? "border-emerald-800/60 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60"
              : failedCount > 0
                ? "border-rose-800/60 bg-rose-950/50 text-rose-300 hover:bg-rose-900/50"
                : "border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-700"
          }`}
        >
          {runningCount > 0 ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <span>{runningCount} running</span>
            </>
          ) : failedCount > 0 ? (
            <>
              <XCircle className="size-3.5" aria-hidden="true" />
              <span>
                {jobsLabel(jobs.length)} ({failedCount} failed)
              </span>
            </>
          ) : (
            <>
              <Activity className="size-3.5" aria-hidden="true" />
              <span>{jobsLabel(jobs.length)}</span>
            </>
          )}
          <ChevronDown className="size-3 opacity-70" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" aria-label="Jobs" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Cpu className="size-3.5" aria-hidden="true" />
            <span>
              {spawned ? "Spawned jobs" : "Jobs"} ({jobs.length})
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {runningCount > 0 && <span>{runningCount} running</span>}
            {completedCount > 0 && <span>{completedCount} completed</span>}
            {failedCount > 0 && <span>{failedCount} failed</span>}
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto py-1">
          {jobs.map((job) => {
            const planId = job.planId;
            const isClickable = Boolean(onOpenPlan && planId);
            const body = (
              <>
                <span className="mt-0.5 shrink-0">
                  {isRunningJob(job) ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : isCompletedJob(job) ? (
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  ) : isFailedJob(job) ? (
                    <XCircle className="size-3.5" aria-hidden="true" />
                  ) : (
                    <span className="inline-block size-2 rounded-full bg-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="font-medium">{job.type}</span>
                    <span className="text-muted-foreground">{job.id}</span>
                    {job.planTitle && (
                      <span className="truncate text-muted-foreground" title={job.planTitle}>
                        {job.planTitle}
                      </span>
                    )}
                  </span>
                  {job.statusMessage && (
                    <span
                      className="block truncate text-[11px] text-muted-foreground"
                      title={job.statusMessage}
                    >
                      {job.statusMessage}
                    </span>
                  )}
                </span>
                {isClickable && (
                  <ChevronRight className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                )}
              </>
            );

            if (isClickable && planId) {
              return (
                <button
                  key={job.id}
                  type="button"
                  title="Open plan"
                  onClick={() => {
                    setOpen(false);
                    onOpenPlan?.(planId);
                  }}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {body}
                </button>
              );
            }
            return (
              <div key={job.id} className="flex items-start gap-2 px-3 py-1.5">
                {body}
              </div>
            );
          })}
        </div>

        {allFinished && onReviewJobs && (
          <div className="border-t border-border p-2">
            <button
              type="button"
              data-testid="chat-jobs-review"
              onClick={() => {
                setOpen(false);
                onReviewJobs();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-selector px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              <span>Ask agent to review outcomes</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export interface ChatHeaderProps {
  title: string;
  /** Omitted while no session is selected, so the count does not read as "0 messages". */
  messageCount?: number;
  isGenerating: boolean;
  autoScrollEnabled: boolean;
  onToggleAutoScroll: () => void;
  /** The jobs this conversation spawned, resolved against the live job list. */
  jobs?: Job[];
  onOpenPlan?: (planId: string) => void;
  onReviewJobs?: () => void;
  /** The compact agent picker; a slot so the header stays free of store wiring. */
  agentPicker?: React.ReactNode;
}

/**
 * The chat thread's header: title, message count, the streaming indicator, the jobs pill, the
 * compact agent picker and the auto-scroll toggle.
 */
export const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  messageCount,
  isGenerating,
  autoScrollEnabled,
  onToggleAutoScroll,
  jobs = [],
  onOpenPlan,
  onReviewJobs,
  agentPicker,
}) => (
  <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/40 px-4 py-2.5">
    <div className="flex min-w-0 items-center gap-3">
      <h2 className="truncate text-sm font-medium text-slate-200">{title}</h2>
      {messageCount !== undefined && (
        <span className="text-xs text-slate-500">
          {messageCount} message{messageCount === 1 ? "" : "s"}
        </span>
      )}
      {isGenerating && (
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-800/60 bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          <span>Streaming...</span>
        </div>
      )}
    </div>

    <div className="flex items-center gap-2">
      {jobs.length > 0 && (
        <JobsMenu jobs={jobs} spawned onOpenPlan={onOpenPlan} onReviewJobs={onReviewJobs} />
      )}
      {agentPicker}
      <button
        type="button"
        data-testid="chat-autoscroll-toggle"
        onClick={onToggleAutoScroll}
        className={`rounded px-2 py-1 text-xs font-medium transition ${
          autoScrollEnabled
            ? "border border-slate-700 bg-slate-800 text-emerald-400"
            : "border border-slate-800 bg-slate-900 text-slate-400"
        }`}
        title="Toggle auto-scrolling to streaming deltas"
      >
        Auto-scroll: {autoScrollEnabled ? "ON" : "OFF"}
      </button>
    </div>
  </div>
);

export default ChatHeader;
