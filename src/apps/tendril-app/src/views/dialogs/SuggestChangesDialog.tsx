import * as React from "react";
import {
  SuggestChangesDialog as SuggestChangesDialogView,
  type AppComment,
} from "@ivy-interactive/components/tendril";
import { PlanActionsController } from "../../controllers/planActions";
import { bridge } from "../../api/bridge";
import {
  describeBridgeError,
  type Job,
  type PlanDetail,
  type PlanLifecycleState,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";

/** Statuses that have not finished, so a queued request has to wait behind them. */
const UNFINISHED: ReadonlyArray<Job["status"]> = ["Running", "Queued", "Pending", "Blocked"];

function jobsToWaitFor(planJobs: Job[]): string[] {
  return planJobs.filter((job) => UNFINISHED.includes(job.status)).map((job) => job.id);
}

/**
 * Port of `AppPreview.CanRequestChanges`. Review is where a plan sits while it is being looked at,
 * and where a finished RetryPlan puts it back. The second case is allowed on purpose: the moment a
 * retry starts the plan moves to Executing, and a reviewer who keeps walking the app and finds three
 * more things should be able to queue them rather than be locked out until the agent finishes.
 */
function canRequestChanges(state: PlanLifecycleState, planJobs: Job[]): boolean {
  return (
    state === "Review" ||
    planJobs.some((job) => job.type === "RetryPlan" && UNFINISHED.includes(job.status))
  );
}

export interface SuggestChangesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  onJobStarted?: (response: StartJobResponse) => void;
  /** Text the request opens with, for a caller that has already assembled one. */
  initialChangeRequest?: string;
  /** Unresolved inline comments on the file diffs. */
  inlineCommentCount?: number;
  /** The comments the reviewer left on the running app. Present means the update-from-comments mode. */
  appComments?: AppComment[];
  /** The app's entry URL - the page a comment that carries no `url` of its own belongs to. */
  appUrl?: string;
  /**
   * The plan's jobs, for the two `AppPreview` gates. Only read in app-comment mode, where V1
   * re-reads plan and jobs from the services on both render and click.
   */
  planJobs?: Job[];
}

/**
 * The connected half of `SuggestChangesDialog`.
 *
 * Two gates and two dispatch paths live here, because all four need things the library cannot see.
 *
 * The gates are `canRequestChanges` and the wait-for list, both of which read the plan's jobs. The
 * view is handed their answers as `allowed` and `inFlightCount`.
 *
 * The dispatch differs by mode. App comments go through `bridge.startJob` directly, bypassing
 * `PlanActionsController.retryPlan`, because that controller's gate is `canRetry` (Review or
 * Failed) while this dialog answers to `CanRequestChanges`, which deliberately also allows a plan
 * already applying a retry. Diff comments go through the controller, and then clear the plan's
 * drafts - V1's `ClearDraftCommentsAsync` - which is deliberately not awaited into the failure
 * path: the job has already started, and a plan whose comments outlived their dispatch is a smaller
 * problem than a dialog reporting failure for a job that ran.
 */
export function SuggestChangesDialog({
  isOpen,
  onClose,
  plan,
  onJobStarted,
  initialChangeRequest,
  inlineCommentCount,
  appComments,
  appUrl,
  planJobs,
}: SuggestChangesDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const jobs = planJobs ?? [];
  const fromApp = appComments !== undefined && appComments.length > 0;
  const waitFor = fromApp ? jobsToWaitFor(jobs) : [];
  const allowed = !fromApp || canRequestChanges(plan.state, jobs);

  const handleSubmit = async (changeRequest: string) => {
    setIsBusy(true);
    setError(null);
    try {
      if (fromApp) {
        const response = await bridge.startJob({
          type: "RetryPlan",
          folderPath: plan.id,
          changeRequest,
          // `AppPreview.JobsToWaitFor` -> `RetryPlanArgs.WaitForJobs`, which parks the job as
          // `Blocked` until they finish.
          ...(waitFor.length > 0 ? { waitForJobs: waitFor } : {}),
        });
        onJobStarted?.(response);
      } else {
        const response = await PlanActionsController.retryPlan(plan, changeRequest);
        if ((inlineCommentCount ?? 0) > 0) {
          void bridge.clearDiffComments(plan.id).catch(() => undefined);
        }
        onJobStarted?.(response);
      }
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <SuggestChangesDialogView
      isOpen={isOpen}
      onClose={onClose}
      planId={plan.id}
      planState={plan.state}
      initialChangeRequest={initialChangeRequest}
      inlineCommentCount={inlineCommentCount}
      appComments={appComments}
      appUrl={appUrl}
      allowed={allowed}
      inFlightCount={waitFor.length}
      onSubmit={handleSubmit}
      isBusy={isBusy}
      error={error}
    />
  );
}
