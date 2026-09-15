import React from "react";
import {
  TendrilDashboard,
  TendrilProcessViewer,
  type DashboardKpiDto,
  type DashboardJobDto,
} from "@ivy-interactive/components/tendril";
import { BladeContainer } from "@ivy-interactive/components/ui";
import { X } from "lucide-react";
import type { PlanSummary, Job, JobStatus } from "../types/api";
import { firstStringArg } from "../utils/eventArgs";
import { useDashboardAnalytics } from "../hooks/useDashboardAnalytics";
import {
  buildActivityMonths,
  buildKpis,
  buildPullRequests,
  buildTrend,
} from "../utils/dashboardMetrics";
import { buildKpiBlade, isKpiBreakdownId } from "./KpiBreakdown";

interface DashboardViewProps {
  plans: PlanSummary[];
  jobs: Job[];
  onSelectJob?: (jobId: string) => void;
  /** Nav id from ShellLayout's nav items: "plans" | "review" | "jobs". */
  onNavigate?: (navId: string) => void;
  onNewPlan?: () => void;
}

const NAV_BY_EVENT: Record<string, string> = {
  OnDrafts: "plans",
  OnReview: "review",
  OnJobs: "jobs",
};

/** A job in one of these statuses has not finished, so its plan is still mid-flight. */
const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["Pending", "Queued", "Running"];

/** Distinct plans with an unfinished job of the given promptware type.
 *  Jobs without a planId are counted individually by job id. */
const activePlanCountForJobType = (jobs: Job[], type: string): number =>
  new Set(
    jobs
      .filter((j) => j.type === type && ACTIVE_JOB_STATUSES.includes(j.status))
      .map((j) => j.planId || j.id),
  ).size;

export const DashboardView: React.FC<DashboardViewProps> = ({
  plans,
  jobs,
  onSelectJob,
  onNavigate,
  onNewPlan,
}) => {
  const analytics = useDashboardAnalytics();
  const [selectedKpi, setSelectedKpi] = React.useState<string | null>(null);

  // Compute counts for process viewer
  const draftCount = plans.filter((p) => p.state === "Draft").length;
  const reviewCount = plans.filter((p) => p.state === "Review").length;
  const executingCount = plans.filter((p) => p.state === "Executing").length;
  const creatingCount = plans.filter((p) => p.state === "Creating").length;
  const updatingCount = plans.filter((p) => p.state === "Updating").length;
  const completedCount = plans.filter((p) => p.state === "Completed").length;
  const retryingPlansCount = activePlanCountForJobType(jobs, "RetryPlan");
  const creatingPrCount = activePlanCountForJobType(jobs, "CreatePr");

  // Compute KPIs
  const totalCost = jobs.reduce((acc, j) => acc + (j.cost || 0), 0);
  const totalTokens = jobs.reduce((acc, j) => acc + (j.tokens || 0), 0);

  /**
   * What the dashboard showed before the analytics existed, kept as the fallback for a daemon that
   * has not answered yet or at all. None of these carries an `id`, so nothing is clickable while
   * the drill-down has no data behind it — a card that opens an empty panel is worse than an inert
   * one. An offline daemon must degrade the page, never blank it.
   */
  const fallbackKpis: DashboardKpiDto[] = [
    {
      label: "Active Plans",
      value: String(draftCount + reviewCount + executingCount),
      delta: `${executingCount} executing`,
      direction: "up",
    },
    {
      label: "Completed Plans",
      value: String(completedCount),
      delta: "All time",
      direction: null,
    },
    {
      label: "Total Job Cost",
      value: `$${totalCost.toFixed(2)}`,
      delta: "USD",
      direction: null,
    },
    {
      label: "Tokens Consumed",
      value: totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : String(totalTokens),
      delta: "Tokens",
      direction: "up",
    },
  ];

  const { activity } = analytics;
  const kpis =
    activity == null
      ? fallbackKpis
      : buildKpis({
          activity,
          shippedFeatures: analytics.shippedFeatures,
          planCosts: analytics.planCosts,
        });

  const blade =
    selectedKpi == null
      ? null
      : buildKpiBlade(selectedKpi, {
          activity,
          mergedPrs: analytics.mergedPrs,
          planCosts: analytics.planCosts,
          agentCosts: analytics.agentCosts,
        });

  // Escape closes the drill-down: the container leaves it alone at depth 1 because the root blade
  // is not closable, so the host owns dismissal.
  React.useEffect(() => {
    if (blade == null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedKpi(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blade]);

  const dashboardJobs: DashboardJobDto[] = jobs.slice(0, 5).map((j) => ({
    id: j.id,
    planId: j.planId || "",
    title: j.planTitle || j.project || "Task Execution",
    status: j.status.toLowerCase(),
  }));

  return (
    <div className="space-y-6" data-testid="dashboard-view">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tendril Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Autonomous Pipeline Health and Execution Metrics
          </p>
        </div>
      </div>

      <TendrilDashboard
        id="tendril-dashboard"
        draftCount={draftCount}
        inProgressCount={executingCount + creatingCount + updatingCount}
        reviewCount={reviewCount}
        completedCount={completedCount}
        failedCount={0}
        events={["OnJob", "OnDrafts", "OnReview", "OnJobs", "OnSelectKpi"]}
        eventHandler={(evt: string, _id: string, args?: unknown[]) => {
          if (evt === "OnJob") {
            const jobId = firstStringArg(args);
            if (jobId) onSelectJob?.(jobId);
            return;
          }
          if (evt === "OnSelectKpi") {
            const kpiId = firstStringArg(args);
            if (kpiId && isKpiBreakdownId(kpiId)) setSelectedKpi(kpiId);
            return;
          }
          const nav = NAV_BY_EVENT[evt];
          if (nav) onNavigate?.(nav);
        }}
        kpis={kpis}
        trend={buildTrend(activity)}
        pullRequests={buildPullRequests(activity)}
        activity={buildActivityMonths(activity)}
        jobs={dashboardJobs}
        slots={{
          ProcessViewer: (
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <TendrilProcessViewer
                id="process-viewer"
                draftCount={draftCount}
                reviewCount={reviewCount}
                executingPlansCount={executingCount}
                creatingPlansCount={creatingCount}
                updatingPlansCount={updatingCount}
                retryingPlansCount={retryingPlansCount}
                creatingPrCount={creatingPrCount}
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
          ),
        }}
      />

      {blade && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          data-testid="kpi-breakdown"
          role="presentation"
          onClick={(event) => {
            // Only the backdrop itself dismisses; a click inside a blade must not.
            if (event.target === event.currentTarget) setSelectedKpi(null);
          }}
        >
          <div className="h-full w-full max-w-[72rem] shadow-2xl">
            {/* The selected KPI is the stack's root, so a breakdown row can push a further blade
                (agent → that agent's plans) without the dashboard itself becoming a blade. */}
            <BladeContainer
              root={{
                ...blade,
                // The descriptor's own width hint is what it gets when something pushes it deeper in
                // a stack; as the root of this overlay it fills the panel instead.
                width: "flex",
                headerAction: (
                  <button
                    type="button"
                    aria-label="Close breakdown"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => setSelectedKpi(null)}
                  >
                    <X className="size-4" />
                  </button>
                ),
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
