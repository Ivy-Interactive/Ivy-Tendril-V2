import React from "react";
import { TendrilProcessViewer } from "@ivy-interactive/components/tendril";
import type { Job, PlanSummary } from "../types/api";
import { computeProcessStatus } from "../utils/processStatus";

/** Nav ids the pipeline's boxes and arrows navigate to, as `ShellLayout`'s nav items name them. */
const NAV_BY_EVENT: Record<string, string> = {
  OnDrafts: "plans",
  OnReview: "review",
  OnJobs: "jobs",
};

interface TendrilProcessWallpaperProps {
  plans: PlanSummary[];
  /** Absent means no job list to consult, so the in-flight arrows read zero rather than guessing. */
  jobs?: Job[];
  /** V1's `CreatePlanDialogLauncher`: `OnCreate` opens the Create Plan dialog, not a page. */
  onNewPlan?: () => void;
  /** `OnDrafts`/`OnReview`/`OnJobs`, which V1 sends through `UseNavigation()`. */
  onNavigate?: (navId: string) => void;
}

/**
 * The process pipeline V1 hangs off an empty page, ported from `Hooks/UseTendrilProcess.cs`:
 *
 * ```csharp
 * return new CreatePlanDialogLauncher(open =>
 *     new TendrilProcessViewer()
 *         .DraftCount(status.DraftCount) ... .CreatingPrCount(status.CreatingPrCount)
 *         .OnCreate(open)
 *         .OnDrafts(() => navigator.Navigate<PlansApp>())
 *         .OnReview(() => navigator.Navigate<ReviewApp>())
 *         .OnJobs(() => navigator.Navigate<JobsApp>()));
 * ```
 *
 * `Apps/Plans/ContentView.cs` and `Apps/Review/ContentView.cs` both call it once per build
 * (`var processView = Context.UseTendrilProcess();`) and pass the result as the `cta` of their
 * `NoContentView`, which is what makes an empty Plans or Review page a wallpaper rather than a line
 * of text. `DashboardApp` renders the same widget from the same counts, hence the shared
 * {@link computeProcessStatus}.
 *
 * It is a component rather than a hook because V2 has no service to subscribe to: the counts are
 * derived from the plan and job lists the host already holds, so there is no state to own.
 */
export const TendrilProcessWallpaper: React.FC<TendrilProcessWallpaperProps> = ({
  plans,
  jobs,
  onNewPlan,
  onNavigate,
}) => {
  const status = React.useMemo(() => computeProcessStatus(plans, jobs ?? []), [plans, jobs]);

  return (
    /* The widget takes no test id of its own, and its own container is what carries V1's layout, so
       the hook goes on a wrapper that passes the full width through rather than on the flow itself. */
    <div data-testid="process-wallpaper" className="w-full">
      <TendrilProcessViewer
        id="process-wallpaper"
        draftCount={status.draftCount}
        reviewCount={status.reviewCount}
        creatingPlansCount={status.creatingPlansCount}
        updatingPlansCount={status.updatingPlansCount}
        executingPlansCount={status.executingPlansCount}
        retryingPlansCount={status.retryingPlansCount}
        creatingPrCount={status.creatingPrCount}
        events={["OnCreate", "OnDrafts", "OnReview", "OnJobs"]}
        eventHandler={(evt: string) => {
          if (evt === "OnCreate") {
            onNewPlan?.();
            return;
          }
          const nav = NAV_BY_EVENT[evt];
          if (nav) onNavigate?.(nav);
        }}
      />
    </div>
  );
};
