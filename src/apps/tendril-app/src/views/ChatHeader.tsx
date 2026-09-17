import React, { useCallback, useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@ivy-interactive/components/ui";
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Cpu,
  Ellipsis,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { Job } from "../types/api";
import { isCompletedJob, isFailedJob, isRunningJob } from "../utils/jobStatus";

const jobsLabel = (count: number) => `${count} job${count === 1 ? "" : "s"}`;

/** The header's icon buttons: one square, ghost-filled control, sized as V1's 32px IconButton. */
const HeaderIconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
> = ({ label, className = "", children, ...props }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    {...props}
  >
    {children}
  </button>
);

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
 *
 * The pill is a neutral surface, not a coloured status chip: only a failure tints it, so a running
 * job reads as activity rather than as an alarm.
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
          className={`inline-flex h-8 select-none items-center gap-1.5 whitespace-nowrap rounded-lg bg-muted px-3 transition-colors hover:bg-accent ${
            failedCount > 0 && runningCount === 0 ? "text-destructive" : "text-foreground"
          }`}
        >
          {runningCount > 0 ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>{runningCount} running</span>
              <span
                className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-current"
                aria-hidden="true"
              />
            </>
          ) : failedCount > 0 ? (
            <>
              <XCircle className="size-4" aria-hidden="true" />
              <span>
                {jobsLabel(jobs.length)} ({failedCount} failed)
              </span>
            </>
          ) : (
            <>
              <Activity className="size-4" aria-hidden="true" />
              <span>{jobsLabel(jobs.length)}</span>
            </>
          )}
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" aria-label="Jobs" className="w-[360px] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Cpu className="size-3.5" aria-hidden="true" />
            <span>
              {spawned ? "Spawned Jobs" : "Running Jobs"} ({jobs.length})
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-selector bg-muted px-1.5 py-0.5 text-2xs text-foreground">
                <Loader2 className="size-2.5 animate-spin" aria-hidden="true" />
                {runningCount} running
              </span>
            )}
            {completedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-selector bg-success/15 px-1.5 py-0.5 text-2xs text-success">
                <Check className="size-2.5" aria-hidden="true" />
                {completedCount} completed
              </span>
            )}
            {failedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-selector bg-destructive/15 px-1.5 py-0.5 text-2xs text-destructive">
                <X className="size-2.5" aria-hidden="true" />
                {failedCount} failed
              </span>
            )}
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto py-1">
          {jobs.map((job) => {
            const planId = job.planId;
            const isClickable = Boolean(onOpenPlan && planId);
            const body = (
              <>
                <span
                  className={`mt-0.5 shrink-0 ${
                    isCompletedJob(job)
                      ? "text-success"
                      : isFailedJob(job)
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {isRunningJob(job) ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : isCompletedJob(job) ? (
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  ) : isFailedJob(job) ? (
                    <XCircle className="size-3.5" aria-hidden="true" />
                  ) : (
                    <span className="inline-block size-1.5 rounded-full bg-current" />
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
                      className="block truncate text-xs-tight text-muted-foreground"
                      title={job.statusMessage}
                    >
                      {job.statusMessage}
                    </span>
                  )}
                </span>
                {isClickable && (
                  <ChevronRight
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
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
  /** Shows the options menu (rename/delete). False while no session is selected. */
  editable?: boolean;
  autoScrollEnabled: boolean;
  onToggleAutoScroll: () => void;
  /** The jobs this conversation spawned, resolved against the live job list. */
  jobs?: Job[];
  onOpenPlan?: (planId: string) => void;
  onReviewJobs?: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
  onNewChat?: () => void;
  /** Rendered after the title when supplied; the app keeps its agent picker in the composer. */
  agentPicker?: React.ReactNode;
}

/**
 * The chat thread's header: the conversation's name with an inline rename, a new-chat button and
 * an options menu (rename/delete), with the jobs pill to their left so the buttons keep the same
 * place whether or not a job is running. Nothing else lives here — the agent selection belongs to
 * the composer that uses it, and streaming state is reported by the turn itself in the thread.
 */
export const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  editable = false,
  autoScrollEnabled,
  onToggleAutoScroll,
  jobs = [],
  onOpenPlan,
  onReviewJobs,
  onRename,
  onDelete,
  onNewChat,
  agentPicker,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleText, setEditingTitleText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu is a plain popup rather than a Radix one: it holds two items and must not trap focus
  // away from the inline rename it opens.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const startTitleEdit = useCallback(() => {
    setEditingTitleText(title);
    setIsEditingTitle(true);
  }, [title]);

  const saveTitleEdit = () => {
    const trimmed = editingTitleText.trim();
    if (trimmed && trimmed !== title) onRename?.(trimmed);
    setIsEditingTitle(false);
  };

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border pl-5 pr-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {isEditingTitle ? (
          <input
            type="text"
            aria-label="Chat name"
            data-testid="chat-title-input"
            value={editingTitleText}
            onChange={(e) => setEditingTitleText(e.target.value)}
            onBlur={saveTitleEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitleEdit();
              if (e.key === "Escape") setIsEditingTitle(false);
            }}
            autoFocus
            className="w-full max-w-[360px] rounded-lg border border-border bg-background px-2 py-1 text-base font-semibold text-foreground outline-none focus:border-foreground"
          />
        ) : (
          <h1 className="truncate text-base font-semibold text-foreground" title={title}>
            {title}
          </h1>
        )}
        {agentPicker}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {jobs.length > 0 && (
          <JobsMenu jobs={jobs} spawned onOpenPlan={onOpenPlan} onReviewJobs={onReviewJobs} />
        )}
        <div className="flex items-center">
          {onNewChat && (
            <HeaderIconButton label="New chat" onClick={onNewChat}>
              <MessageSquarePlus className="size-4" aria-hidden="true" />
            </HeaderIconButton>
          )}
          {/* V2-only: V1 detaches from the tail on a scroll up and has no control for it. The
              desktop app keeps an explicit lock, as an icon button so the header stays as V1's. */}
          <HeaderIconButton
            data-testid="chat-autoscroll-toggle"
            label="Toggle auto-scrolling to streaming deltas"
            aria-pressed={autoScrollEnabled}
            onClick={onToggleAutoScroll}
            className={autoScrollEnabled ? "text-foreground" : "text-muted-foreground"}
          >
            <ArrowDownToLine className="size-4" aria-hidden="true" />
            <span className="sr-only">Auto-scroll: {autoScrollEnabled ? "ON" : "OFF"}</span>
          </HeaderIconButton>
          {editable && (
            <div className="relative" ref={menuRef}>
              <HeaderIconButton
                label="Chat options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </HeaderIconButton>
              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Chat options"
                  className="absolute right-0 top-[calc(100%+4px)] z-100 flex min-w-[168px] flex-col rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      startTitleEdit();
                    }}
                    className="flex items-center gap-2 whitespace-nowrap rounded-selector px-2.5 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit name
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete?.();
                    }}
                    className="flex items-center gap-2 whitespace-nowrap rounded-selector px-2.5 py-2 text-left text-destructive hover:bg-accent"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete chat
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatHeader;
