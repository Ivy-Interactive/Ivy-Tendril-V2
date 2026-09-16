import React from "react";
import {
  TendrilDashboard,
  TendrilProcessViewer,
  type DashboardKpiDto,
  type DashboardJobDto,
  type DashboardMonthValueDto,
  type DashboardTrendDto,
} from "@ivy-interactive/components/tendril";
import { BladeContainer } from "@ivy-interactive/components/ui";
import { X } from "lucide-react";
import type { DashboardActivity, PlanSummary, Job, JobStatus, RecentMergedPr } from "../types/api";
import { firstStringArg } from "../utils/eventArgs";
import { useDashboardAnalytics } from "../hooks/useDashboardAnalytics";
import {
  NO_VALUE,
  buildActivityMonths,
  buildKpis,
  buildPullRequests,
} from "../utils/dashboardMetrics";
import { rollingAverage, toDayNumber, toIsoDate, todayDayNumber } from "../utils/rollingAverage";
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

/** Weeks the Pull Requests card's Week tab plots, from `DashboardApp.BuildWeeklyPullRequests`. */
const PR_WEEKS_SHOWN = 6;

/**
 * The three promptware types `TendrilProcessStatusService.Compute` folds into one Updating counter.
 * A plan being expanded or split is being rewritten just as much as one being updated, and the
 * process viewer has one loop arrow for all three.
 */
const UPDATING_JOB_TYPES = ["UpdatePlan", "ExpandPlan", "SplitPlan"];

/**
 * Unfinished jobs of the given promptware type.
 *
 * Counted per *job*, not per distinct plan: that is what `TendrilProcessStatusService.Compute` does
 * (`activeJobs.Count(j => j.Type == ...)`), and it is the honest number for a strip that reads
 * "how much work is in flight". Two retries queued against one plan are two runs to wait for, and
 * collapsing them to 1 understates the queue.
 */
const activeJobCountForType = (jobs: Job[], types: readonly string[]): number =>
  jobs.filter((j) => types.includes(j.type) && ACTIVE_JOB_STATUSES.includes(j.status)).length;

/**
 * Plan states the Plans box counts, and the states the Review box counts
 * (`TendrilProcessStatusService.Compute`). Blocked plans sit with the drafts because a plan waiting
 * on a dependency is still a plan nobody has run; Failed plans sit with Review because a failure is
 * what the Review app exists to triage. This is also what the shell's own nav badges count
 * (`TendrilAppShell.BuildMenuItems`), so the strip and the badge beside it cannot disagree.
 */
const DRAFT_PLAN_STATES = ["Draft", "Blocked"];
const REVIEW_PLAN_STATES = ["Review", "Failed"];

/**
 * The two counts the status strip and the process viewer share, with V1's premature-state
 * correction applied (`TendrilProcessStatusService.Compute`).
 *
 * A plan whose job is still running has not necessarily had its `plan.yaml` state advanced yet, so
 * for a moment it reads as a Draft nobody has run or a Review nobody has looked at. V1 subtracts
 * those from both boxes rather than inviting the operator to act on a plan an agent is holding.
 *
 * V1 matches plan to job on the job's plan folder (and, for CreatePlan, on its allocated id). V2's
 * job DTO carries neither: `Job.planId` is the daemon's `reportedPlanId`, which only exists once an
 * agent has reported it. So this matches on what there is, and a job that has not reported its plan
 * simply corrects nothing — the pre-correction count, which is what V2 showed before.
 */
function planStateCounts(
  plans: PlanSummary[],
  jobs: Job[],
): { draftCount: number; reviewCount: number } {
  const activePlanIds = new Set(
    jobs
      .filter((j) => ACTIVE_JOB_STATUSES.includes(j.status))
      .map((j) => j.planId)
      .filter((id): id is string => id != null && id !== ""),
  );

  let draftCount = 0;
  let reviewCount = 0;
  for (const plan of plans) {
    const isDraft = DRAFT_PLAN_STATES.includes(plan.state);
    const isReview = REVIEW_PLAN_STATES.includes(plan.state);
    if (!isDraft && !isReview) continue;
    if (activePlanIds.has(plan.id)) continue;
    if (isDraft) draftCount += 1;
    else reviewCount += 1;
  }

  return { draftCount, reviewCount };
}

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
 * Merged PRs per week for the Pull Requests card's Week tab, which is
 * `DashboardApp.BuildWeeklyPullRequests`: six Monday-to-Sunday weeks ending with the week containing
 * today, labelled by the week's start date.
 *
 * The tab exists in the widget and is clickable, so leaving `pullRequestsWeekly` unsupplied is not a
 * missing feature — it is a control that renders an empty chart. V1 feeds it from
 * `GetCompletedPrsByDay`; V2's daemon exposes no per-day PR series, so this buckets the merged-PR
 * rows themselves, which count the same thing (a `PullRequests` row on a Completed plan, dated by
 * the plan's `Updated`).
 *
 * The one caveat is the list's server-side `LIMIT`: it is the *most recent* rows, so the newest
 * weeks are always complete and only the oldest can be truncated. See the report note on raising
 * `useDashboardAnalytics`'s limit.
 */
export function buildWeeklyPullRequests(
  mergedPrs: readonly RecentMergedPr[],
  today: number = todayDayNumber(),
): DashboardMonthValueDto[] {
  // Epoch day 0 is a Thursday, whose distance from the preceding Monday is 3.
  const currentWeekMonday = today - ((today + 3) % 7);

  const countByDay = new Map<number, number>();
  for (const pr of mergedPrs) {
    const day = toDayNumber(pr.updated.slice(0, 10));
    if (day == null) continue;
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
  }

  return Array.from({ length: PR_WEEKS_SHOWN }, (_unused, index) => {
    const weekStart = currentWeekMonday - (PR_WEEKS_SHOWN - 1 - index) * 7;
    let value = 0;
    for (let offset = 0; offset < 7; offset++) value += countByDay.get(weekStart + offset) ?? 0;

    const startDate = new Date(toIsoDate(weekStart) + "T00:00:00Z");
    return {
      label: `${startDate.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${startDate.getUTCDate()}`,
      value,
      year: startDate.getUTCFullYear(),
      month: startDate.getUTCMonth() + 1,
      day: startDate.getUTCDate(),
      date: toIsoDate(weekStart),
    };
  });
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

  // Status strip counts come from the same sources as the apps they navigate to: plan counts as the
  // Plans and Review views show them, job counts as the Jobs view does (`DashboardApp.Build`).
  const activeJobs = jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  const completedJobCount = jobs.filter((j) => j.status === "Completed").length;
  const failedJobCount = jobs.filter((j) => j.status === "Failed").length;

  // Plan-state counts, which the Plans and Review boxes carry.
  const { draftCount, reviewCount } = planStateCounts(plans, jobs);

  // The arrows between the boxes are *jobs in flight*, not plans in a state: V1 derives all five
  // from the active job list by promptware type (`TendrilProcessStatusService.Compute`). Reading a
  // plan's state instead misses the whole transient window this widget exists to show — a plan is
  // only ever `Creating` for the moments between the job starting and the write landing, and a
  // CreatePlan job has no plan to be in a state at all until it produces one.
  const creatingCount = activeJobCountForType(jobs, ["CreatePlan"]);
  const updatingCount = activeJobCountForType(jobs, UPDATING_JOB_TYPES);
  const executingCount = activeJobCountForType(jobs, ["ExecutePlan"]);
  const retryingPlansCount = activeJobCountForType(jobs, ["RetryPlan"]);
  const creatingPrCount = activeJobCountForType(jobs, ["CreatePr"]);

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
  //
  // The title follows `JobsApp.GetPromptDisplay`'s order as far as V2's DTO reaches: the plan title
  // first, then the promptware type. The project is *not* a title — every job in a single-project
  // install would read the same — and neither is the literal "Task Execution", which is wrong for
  // every job that is not an ExecutePlan.
  const dashboardJobs: DashboardJobDto[] = activeJobs.slice(0, ACTIVE_JOBS_SHOWN).map((j) => ({
    id: j.id,
    planId: j.planId || "",
    title: j.planTitle || j.type || j.project,
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
        // The 28-day series goes in as `trendWeekly`, which is the slot V1 puts its own 28-day
        // window in (`DashboardApp.BuildWeeklyTrend`); `trend` is V1's 365-day range, which V2's
        // daemon does not return. The widget prefers `trendWeekly` either way, so naming the slot
        // correctly is what keeps a future long-range series from silently replacing this one.
        trendWeekly={buildDailyTrend(activity)}
        pullRequests={buildPullRequests(activity)}
        pullRequestsWeekly={buildWeeklyPullRequests(analytics.mergedPrs)}
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
