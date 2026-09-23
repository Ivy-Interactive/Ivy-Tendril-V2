import React from "react";
import { Callout } from "../ui/callout";
import { HeaderLayout } from "../ui/panel-layout";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { Spinner } from "../ui/spinner";
import { useTranslation } from "@/i18n/uiJobs";

/**
 * Where a job is, for the callout that explains a job with no output of its own.
 *
 * Only the fields the callout reads, so the app's `Job` passes straight through. Declared here on
 * the rule `PlanGitView` states: the component that renders a shape owns its declaration.
 */
export interface JobOutputStatus {
  /** The daemon's raw status (`Failed`, `Blocked`, …). Decides the tone and the title. */
  status: string;
  /** The status as the UI names it, for a status this build has no title of its own for. */
  statusLabel?: string;
  /**
   * The job's own account: its failure reason or status message. Without one, Blocked and Pending
   * fall back to V1's sentences and every other status renders no callout at all.
   */
  message?: string;
}

export interface JobStatusCalloutProps extends JobOutputStatus {
  className?: string;
  "data-testid"?: string;
}

/** Failed and Timeout are V1's two red statuses; the rest explain themselves without claiming a fault. */
function isFailure(status: string): boolean {
  return status === "Failed" || status === "Timeout";
}

/**
 * The callout title's context, V1's `$"Job {job.Status}"`: the status with its first letter
 * lower-cased, as the catalog keys it. Each status has a title of its own rather than its label
 * dropped into one shared sentence, so a language can phrase "Job Failed" the way it phrases it; a
 * status this build has no title for falls back to the shared "Job {{status}}".
 */
function titleContext(status: string): string {
  return `${status.charAt(0).toLowerCase()}${status.slice(1)}`;
}

/**
 * `OutputSheet.cs:26-49`: the callout V1 returns for a job that has produced no output — the job's
 * own message under `$"Job {job.Status}"`, or for a Blocked or Pending job with none, V1's fixed
 * sentence. Renders nothing when there is nothing to say.
 */
export const JobStatusCallout: React.FC<JobStatusCalloutProps> = ({
  status,
  statusLabel,
  message,
  className,
  "data-testid": testId = "job-status-callout",
}) => {
  const { t } = useTranslation("uiJobs");
  const text =
    message ||
    (status === "Blocked"
      ? t("outputSheet.statusCallout.blocked")
      : status === "Pending"
        ? t("outputSheet.statusCallout.pending")
        : undefined);
  if (!text) return null;
  return (
    <Callout
      variant={isFailure(status) ? "error" : "info"}
      title={t("outputSheet.statusCallout.title", {
        context: titleContext(status),
        status: statusLabel ?? status,
      })}
      className={className}
      data-testid={testId}
    >
      <p className="whitespace-pre-wrap">{text}</p>
    </Callout>
  );
};

export interface JobOutputSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** V1's `$"{job.Type} {ExtractPlanId(job.PlanFile)}"`, or "Job Output" for a job it no longer has. */
  title: string;
  /**
   * The output itself. The app's is connected - it streams the agent's events - which is why the
   * sheet takes it as a child rather than rendering it: the library owns the chrome, the app owns
   * the stream. Absent, the sheet shows `status`'s callout, or V1's "No output available.".
   */
  children?: React.ReactNode;
  /** V1's callout for a job with no output: Blocked, Pending, or its own status message. */
  status?: JobOutputStatus;
  /** The body's chunk is still loading. */
  loading?: boolean;
}

/**
 * V1's output sheet (`Apps/Jobs/Sheets/OutputSheet.cs`, opened over the Jobs table by
 * `JobsApp.cs:39-49` `showOutput`), as chrome: the panel at `UxHelper.SheetWidth`, the title, and
 * the box the output fills.
 *
 * `HeaderLayout` with `scrollContent={false}` hands the scrolling to the log, which is what keeps an
 * `AgentViewer`'s metrics footer in the footer: the scrolling branch wraps its children in Radix's
 * viewport, whose `display: table` div kills a definite height, so a `height="full"` viewer sized to
 * its content and the footer floated mid-sheet. `contentClassName` re-establishes the flex column.
 * `showDivider={false}` because the title already reads as chrome against the body, and the rule
 * under it was the first of three stacked down this sheet. That is also why this does not use
 * `SheetPanel`: its body is a padded scroller, and this one must not scroll at all.
 */
export const JobOutputSheet: React.FC<JobOutputSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
  status,
  loading = false,
}) => {
  const { t } = useTranslation("uiJobs");
  const hasBody = children !== undefined && children !== null && children !== false;
  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        data-testid="job-output-sheet"
        className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
      >
        <HeaderLayout
          className="min-h-0 flex-1"
          showDivider={false}
          scrollContent={false}
          contentClassName="flex h-full min-h-0 flex-col"
          header={
            <SheetHeader className="pl-2 pr-8">
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>
          }
        >
          {status && (
            <div className="px-4 pt-4">
              <JobStatusCallout {...status} />
            </div>
          )}
          {loading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Spinner size="lg" className="text-success" aria-hidden="true" />
            </div>
          ) : hasBody ? (
            children
          ) : status ? null : (
            <p className="px-4 pt-4 text-sm text-muted-foreground" data-testid="job-output-empty">
              {t("outputSheet.noOutput")}
            </p>
          )}
        </HeaderLayout>
      </SheetContent>
    </Sheet>
  );
};
