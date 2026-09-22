import React from "react";
import {
  TendrilDashboard,
  TendrilProcessViewer,
  type DashboardKpiDto,
  type DashboardJobDto,
  type DashboardMonthValueDto,
  type DashboardTrendDto,
} from "@ivy-interactive/components/tendril";
import { formatDate, useFormatters, type Formatters } from "@ivy-interactive/components/i18n";
import { useTranslation, type TFunction } from "../i18n";
import { useEnumLabels } from "../i18n/enumLabels";
import type { DashboardActivity, PlanSummary, Job, RecentMergedPr } from "../types/api";
import { firstStringArg } from "../utils/eventArgs";
import { useDashboardAnalytics } from "../hooks/useDashboardAnalytics";
import {
  NO_VALUE,
  buildActivityMonths,
  buildKpis,
  buildPullRequests,
} from "../utils/dashboardMetrics";
import { rollingAverage, toDayNumber, toIsoDate, todayDayNumber } from "../utils/rollingAverage";
/* The pipeline counts moved out of this view when the Plans and Review wallpapers started rendering
   the same widget: V1 computes them once in `TendrilProcessStatusService` for exactly that reason. */
import { ACTIVE_JOB_STATUSES, computeProcessStatus } from "../utils/processStatus";
import { buildKpiBlade, isKpiBreakdownId } from "./KpiBreakdown";
import { DashboardKpiSheet } from "./DashboardKpiSheet";

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

/** Rows the Active Jobs card shows, from `DashboardApp.ActiveJobsShown`. */
const ACTIVE_JOBS_SHOWN = 8;

/** Days the trend card plots, from `DashboardApp.TrendDailyWindowDays`. */
const TREND_DAILY_WINDOW_DAYS = 28;

/** Weeks the Pull Requests card's Week tab plots, from `DashboardApp.BuildWeeklyPullRequests`. */
const PR_WEEKS_SHOWN = 6;

/**
 * The header's date line (`DashboardApp.Build`): weekday, day and month, in the current language's
 * own order - "Monday, September 15" in English, "Montag, 15. September" in German.
 *
 * V1 writes "Monday, 15th September", composed by hand with an English ordinal suffix
 * (`DashboardApp.Ordinal`). No `Intl` option produces English ordinals, and a hand-built
 * `weekday, ordinal month` cannot be reordered for any other language, so this is `Intl`'s form.
 */
const formatDateText = (now: Date, format: Formatters): string =>
  format.date(now, { weekday: "long", day: "numeric", month: "long" });

/**
 * `DashboardApp.BuildGreeting`, minus the name. V1 personalises it from `Environment.UserName`;
 * a browser has no such thing, so this takes the same method's no-name branch rather than
 * inventing an identity for whoever is looking at the page.
 */
const buildGreeting = (now: Date, t: TFunction<"dashboard">): string => {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return t("header.greeting.morning");
  if (hour >= 12 && hour < 17) return t("header.greeting.afternoon");
  return t("header.greeting.evening");
};

/**
 * The trend card's series: four weeks of contiguous days ending today, with the 7-day trailing mean
 * beside them. This is `DashboardApp.BuildDailyTrend`, and it lives in the view for the same reason
 * V1 keeps it in `DashboardApp` rather than in the widget: the window is the page's decision.
 *
 * Zero-filled, so a day with no rows is a plotted 0 rather than a missing point; the *rolling*
 * series is the one that carries nulls, for the days its window would reach back past the earliest
 * record. Returns null only when there is no activity payload at all - V1's
 * `DailyCosts == null && DailyPlans == null`, which in C# means the daemon never supplied the
 * fields.
 *
 * An *empty* pair of arrays is not that. V1's models declare them nullable and its repository
 * always assigns a list, so null there means "absent"; V2's DTO types them `T[]`, and the daemon
 * always sends them, so the only value a fresh install ever produces is `[]`. Porting the null
 * check as `.length === 0` therefore turned "no payload" into "no rows yet" and withheld the card
 * from exactly the installs that have nothing else on the page - a 28-day axis of zeroes is the
 * honest answer there, and the same one V1 gives.
 *
 * Suppressing it also broke the layout: `.tdb-col:not(.tdb-col-side) > :last-child` stretches the
 * main column's final child so the trend card absorbs the leftover height. With the card gone that
 * fell to the KPI grid, which rendered 527px tall instead of 134px.
 */
function buildDailyTrend(
  activity: DashboardActivity | null,
  today: number = todayDayNumber(),
): DashboardTrendDto | null {
  if (activity == null) return null;

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
      // "Sep 14" in English: the week's start, in the current language's short month-and-day form.
      label: formatDate(startDate, { month: "short", day: "numeric", timeZone: "UTC" }),
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
 * The same four cards once the daemon has answered and had nothing to say, carrying V1's own no-data
 * vocabulary (`DashboardApp.BuildKpis`, `BuildForecastKpi`): an unknown figure is a dash or "n/a" with
 * a hint saying why, never a zero. None carries an `id`, so nothing is clickable while there is no
 * data behind the drill-down. An offline daemon must degrade the page, never blank it or change which
 * cards it has.
 *
 * This is the *settled* no-data state only. It used to double as the loading state, because the view
 * read `activity == null` — which is equally true of a fetch still in flight — and that conflation is
 * where the flash of dashes and "n/a" on every visit to the Dashboard came from. A figure nobody has
 * fetched yet is not an unknown figure; it gets a skeleton.
 *
 * Built per render rather than once, so its wording follows the language.
 */
const fallbackKpis = (t: TFunction<"dashboard">): DashboardKpiDto[] => [
  {
    label: t("fallbackKpis.featuresShipped.label"),
    value: NO_VALUE,
    hint: t("fallbackKpis.featuresShipped.hint"),
  },
  {
    label: t("fallbackKpis.costPerFeature.label"),
    value: t("fallbackKpis.costPerFeature.value"),
    hint: t("fallbackKpis.costPerFeature.hint"),
  },
  {
    label: t("fallbackKpis.forecastMonth.label"),
    value: NO_VALUE,
    hint: t("fallbackKpis.forecastMonth.hint"),
  },
  {
    label: t("fallbackKpis.avgCostPlan.label"),
    value: NO_VALUE,
    hint: t("fallbackKpis.avgCostPlan.hint"),
  },
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  plans,
  jobs,
  onSelectJob,
  onNavigate,
  onNewPlan,
}) => {
  const { t } = useTranslation("dashboard");
  const format = useFormatters();
  const enumLabels = useEnumLabels();
  const analytics = useDashboardAnalytics();
  const [selectedKpi, setSelectedKpi] = React.useState<string | null>(null);

  // Status strip counts come from the same sources as the apps they navigate to: plan counts as the
  // Plans and Review views show them, job counts as the Jobs view does (`DashboardApp.Build`).
  const activeJobs = jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  const completedJobCount = jobs.filter((j) => j.status === "Completed").length;
  const failedJobCount = jobs.filter((j) => j.status === "Failed").length;

  // The plan-state counts the Plans and Review boxes carry, and the in-flight job counts its arrows
  // carry: one `TendrilProcessStatusService.Compute` snapshot, shared with the Plans and Review
  // wallpapers so the two surfaces cannot disagree.
  const {
    draftCount,
    reviewCount,
    creatingPlansCount: creatingCount,
    updatingPlansCount: updatingCount,
    executingPlansCount: executingCount,
    retryingPlansCount,
    creatingPrCount,
  } = computeProcessStatus(plans, jobs);

  const { activity } = analytics;

  /**
   * No analytics have ever arrived — neither from this mount's fetch nor from a cached earlier one.
   *
   * The three states this splits apart, which the view used to collapse into two:
   *  - pending: nothing to state yet, so the cards, the trend and the two side charts render
   *    skeletons and the operator sees the dashboard's shape rather than a row of dashes;
   *  - settled with data: the real figures;
   *  - settled without data: {@link fallbackKpis}, V1's honest "we looked and there is nothing".
   *
   * A *refresh* is none of these: `useDashboardAnalytics` keeps the last snapshot across a poll, a
   * failed poll and a remount, so `activity` stays non-null and the numbers on screen never blink.
   */
  const analyticsPending = analytics.loading && activity == null;

  const kpis =
    activity != null
      ? buildKpis({
          activity,
          shippedFeatures: analytics.shippedFeatures,
          planCosts: analytics.planCosts,
        }).filter((kpi) => kpi.id != null && KPI_IDS.includes(kpi.id))
      : analyticsPending
        ? []
        : fallbackKpis(t);

  const blade =
    selectedKpi == null
      ? null
      : buildKpiBlade(
          selectedKpi,
          {
            activity,
            shippedFeatures: analytics.shippedFeatures,
            mergedPrs: analytics.mergedPrs,
            planCosts: analytics.planCosts,
            agentCosts: analytics.agentCosts,
          },
          t,
        );

  // Active Jobs lists the unfinished jobs only, capped (`DashboardApp.BuildActiveJobs`). A finished
  // job in a card headed "Active Jobs" is the one thing this card must never show.
  //
  // The title follows `JobsApp.GetPromptDisplay`'s order as far as V2's DTO reaches: the plan title
  // first, then the promptware type. The project is *not* a title — every job in a single-project
  // install would read the same — and neither is the literal "Task Execution", which is wrong for
  // every job that is not an ExecutePlan. The type is shown by its label; `status` below is the
  // widget's styling key, not text.
  const dashboardJobs: DashboardJobDto[] = activeJobs.slice(0, ACTIVE_JOBS_SHOWN).map((j) => ({
    id: j.id,
    planId: j.planId || "",
    title: j.planTitle || (j.type && enumLabels.jobType(j.type)) || j.project,
    status: j.status.toLowerCase(),
  }));

  const now = new Date();

  return (
    // `TendrilDashboard` is full-bleed and sizes itself to `height: 100%` with its own `overflow-y`,
    // so this wrapper has to pass the frame's height through rather than collapsing to its content -
    // otherwise `.tdb-root`'s 100% has nothing to resolve against and the dashboard never scrolls.
    <div className="flex min-h-0 flex-1 flex-col" data-testid="dashboard-view">
      <TendrilDashboard
        id="tendril-dashboard"
        dateText={formatDateText(now, format)}
        greeting={buildGreeting(now, t)}
        headline={t("header.headline")}
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
        loading={analyticsPending}
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

      <DashboardKpiSheet blade={blade} onClose={() => setSelectedKpi(null)} />
    </div>
  );
};
