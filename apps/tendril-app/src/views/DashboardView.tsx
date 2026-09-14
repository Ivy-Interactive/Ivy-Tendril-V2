import React from "react";
import {
  TendrilDashboard,
  TendrilProcessViewer,
  type DashboardKpiDto,
  type DashboardJobDto,
} from "@spacecorps/components-storybook/tendril";
import type { PlanSummary, Job, JobStatus } from "../types/api";
import { firstStringArg } from "../utils/eventArgs";

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

  const kpis: DashboardKpiDto[] = [
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
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Tendril Dashboard</h1>
          <p className="text-xs text-slate-400">Autonomous Pipeline Health and Execution Metrics</p>
        </div>
      </div>

      <TendrilDashboard
        id="tendril-dashboard"
        draftCount={draftCount}
        inProgressCount={executingCount + creatingCount + updatingCount}
        reviewCount={reviewCount}
        completedCount={completedCount}
        failedCount={0}
        events={["OnJob", "OnDrafts", "OnReview", "OnJobs"]}
        eventHandler={(evt: string, _id: string, args?: unknown[]) => {
          if (evt === "OnJob") {
            const jobId = firstStringArg(args);
            if (jobId) onSelectJob?.(jobId);
            return;
          }
          const nav = NAV_BY_EVENT[evt];
          if (nav) onNavigate?.(nav);
        }}
        kpis={kpis}
        jobs={dashboardJobs}
        slots={{
          ProcessViewer: (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
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
    </div>
  );
};
