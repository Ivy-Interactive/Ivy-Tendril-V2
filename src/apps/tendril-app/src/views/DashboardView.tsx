import React from "react";
import {
  TendrilDashboard,
  TendrilProcessViewer,
  type DashboardKpiDto,
  type DashboardJobDto,
  type DashboardTrendDto,
} from "@ivy-interactive/components/tendril";
import { BladeContainer } from "@ivy-interactive/components/ui";
import { X } from "lucide-react";
import type { DashboardActivity, PlanSummary, Job, JobStatus } from "../types/api";
import { firstStringArg } from "../utils/eventArgs";
import { useDashboardAnalytics } from "../hooks/useDashboardAnalytics";
import {
  NO_VALUE,
  buildActivityMonths,
  buildKpis,
  buildPullRequests,
} from "../utils/dashboardMetrics";
import { rollingAverage, toIsoDate, todayDayNumber } from "../utils/rollingAverage";
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

/**
 * A job in one of these statuses has not finished, so its plan is still mid-flight. The set is
 * `TendrilProcessStatusService.Compute`'s `activeJobs` filter, which is also what
 * `DashboardApp.BuildActiveJobs` lists and what the status strip's In Progress count reports.
 */
const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["Pending", "Queued", "Running", "Blocked"];

/** Rows the Active Jobs card shows, from `DashboardApp.ActiveJobsShown`. */
const ACTIVE_JOBS_SHOWN = 8;

/** Days the trend card plots, from `DashboardApp.TrendDailyWindowDays`. */
const TREND_DAILY_WINDOW_DAYS = 28;

/** Distinct plans with an unfinished job of the given promptware type.
 *  Jobs without a planId are counted individually by job id. */
const activePlanCountForJobType = (jobs: Job[], type: string): number =>
  new Set(
    jobs
      .filter((j) => j.type === type && ACTIVE_JOB_STATUSES.includes(j.status))
      .map((j) => j.planId || j.id),
  ).size;

/** "1st", "2nd", "3rd", "4th"... as `DashboardApp.Ordinal` writes them. */
const ordinal = (day: number): string => {
  const suffix =
    day === 11 || day === 12 || day === 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  return `${day}${suffix}`;
};

/** "Monday, 15th September", the header's date line (`DashboardApp.Build`). */
const formatDateText = (now: Date): string =>
  `${now.toLocaleDateString("en-US", { weekday: "long" })}, ${ordinal(now.getDate())} ` +
  now.toLocaleDateString("en-US", { month: "long" });

/**
 * `DashboardApp.BuildGreeting`, minus the name. V1 personalises it from `Environment.UserName`;
 * a browser has no such thing, so this takes the same method's no-name branch rather than
 * inventing an identity for whoever is looking at the page.
 */
const buildGreeting = (now: Date): string => {
  const hour = now.getHours();
  const word =
    hour >= 5 && hour < 12 ? "Morning" : hour >= 12 && hour < 17 ? "Afternoon" : "Evening";
  return `Good ${word}!`;
};

/**
 * The trend card's series: four weeks of contiguous days ending today, with the 7-day trailing mean
 * beside them. This is `DashboardApp.BuildDailyTrend`, and it lives in the view for the same reason
 * V1 keeps it in `DashboardApp` rather than in the widget: the window is the page's decision.
 *
 * Zero-filled, so a day with no rows is a plotted 0 rather than a missing point; the *rolling*
 * series is the one that carries nulls, for the days its window would reach back past the earliest
 * record. Returns null when there is no daily series at all, because bucketed months cannot carry a
 * true 7-day average and plotting them under that label would be the misleading result the parity
 * contract exists to avoid.
 */
function buildDailyTrend(
  activity: DashboardActivity | null,
  today: number = todayDayNumber(),
): DashboardTrendDto | null {
  if (activity == null) return null;
  if (activity.dailyCosts.length === 0 && activity.dailyPlans.length === 0) return null;

  const costByDay = new Map(activity.dailyCosts.map((day) => [day.date, day.cost]));
  const plansByDay = new Map(activity.dailyPlans.map((day) => [day.date, day.count]));
  const dates = Array.from({ length: TREND_DAILY_WINDOW_DAYS }, (_, index) =>
    toIsoDate(today - TREND_DAILY_WINDOW_DAYS + 1 + index),
  );
  const costAt = (isoDate: string): number => costByDay.get(isoDate) ?? 0;
  const plansAt = (isoDate: string): number => plansByDay.get(isoDate) ?? 0;

  return {
    dates,
    cost: dates.map(costAt),
    plans: dates.map(plansAt),
    rollingCost: rollingAverage(dates, costAt, activity.dailyDataStart),
    rollingPlans: rollingAverage(dates, plansAt, activity.dailyDataStart),
  };
}

/**
 * The KPI cards V1 shows, in V1's order (`DashboardApp.BuildKpis`). Its fourth card is the agent
 * rate-limit window, which falls back to Avg Cost/Plan when no usage snapshot exists — and V2 has
 * no usage service, so that branch is permanent. Anything the metrics helper computes beyond these
 * four is not a card V1 has.
 */
const KPI_IDS = ["featuresShipped", "costPerFeature", "forecastMonth", "avgCostPlan"];

/**
 * The same four cards while the daemon has told us nothing, carrying V1's own no-data vocabulary
 * (`DashboardApp.BuildKpis`, `BuildForecastKpi`): an unknown figure is a dash or "n/a" with a hint
 * saying why, never a zero. None carries an `id`, so nothing is clickable while there is no data
 * behind the drill-down. An offline daemon must degrade the page, never blank it or change which
 * cards it has.
 */
const FALLBACK_KPIS: DashboardKpiDto[] = [
  {
    label: "Features shipped",
    value: NO_VALUE,
    hint: "merged PRs and solved issues, last 30 days",
  },
  { label: "Avg cost per Feature", value: "n/a", hint: "No cost data available" },
  { label: "Forecast This Month", value: NO_VALUE, hint: "No cost data in the last 30 days" },
  { label: "Avg Cost/Plan", value: NO_VALUE, hint: "No cost data available" },
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  plans,
  jobs,
  onSelectJob,
  onNavigate,
  onNewPlan,
}) => {
  const analytics = useDashboardAnalytics();
  const [selectedKpi, setSelectedKpi] = React.useState<string | null>(null);

  // Plan-state counts, which the process viewer breaks down box by box.
  const draftCount = plans.filter((p) => p.state === "Draft").length;
  const reviewCount = plans.filter((p) => p.state === "Review").length;
  const executingCount = plans.filter((p) => p.state === "Executing").length;
  const creatingCount = plans.filter((p) => p.state === "Creating").length;
  const updatingCount = plans.filter((p) => p.state === "Updating").length;
  const retryingPlansCount = activePlanCountForJobType(jobs, "RetryPlan");
  const creatingPrCount = activePlanCountForJobType(jobs, "CreatePr");

  // Status strip counts come from the same sources as the apps they navigate to: plan counts as the
  // Plans and Review views show them, job counts as the Jobs view does (`DashboardApp.Build`).
  const activeJobs = jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  const completedJobCount = jobs.filter((j) => j.status === "Completed").length;
  const failedJobCount = jobs.filter((j) => j.status === "Failed").length;

  const { activity } = analytics;
  const kpis =
    activity == null
      ? FALLBACK_KPIS
      : buildKpis({
          activity,
          shippedFeatures: analytics.shippedFeatures,
          planCosts: analytics.planCosts,
        }).filter((kpi) => kpi.id != null && KPI_IDS.includes(kpi.id));

  const blade =
    selectedKpi == null
      ? null
      : buildKpiBlade(selectedKpi, {
          activity,
          shippedFeatures: analytics.shippedFeatures,
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

  // Active Jobs lists the unfinished jobs only, capped (`DashboardApp.BuildActiveJobs`). A finished
  // job in a card headed "Active Jobs" is the one thing this card must never show.
  const dashboardJobs: DashboardJobDto[] = activeJobs.slice(0, ACTIVE_JOBS_SHOWN).map((j) => ({
    id: j.id,
    planId: j.planId || "",
    title: j.planTitle || j.project || "Task Execution",
    status: j.status.toLowerCase(),
  }));

  const now = new Date();

  return (
    <div data-testid="dashboard-view">
      <TendrilDashboard
        id="tendril-dashboard"
        dateText={formatDateText(now)}
        greeting={buildGreeting(now)}
        headline="What Are We Producing Today?"
        draftCount={draftCount}
        inProgressCount={activeJobs.length}
        reviewCount={reviewCount}
        completedCount={completedJobCount}
        failedCount={failedJobCount}
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
        trend={buildDailyTrend(activity)}
        pullRequests={buildPullRequests(activity)}
        activity={buildActivityMonths(activity)}
        jobs={dashboardJobs}
        slots={{
          ProcessViewer: (
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
