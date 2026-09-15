/**
 * Turns the daemon's dashboard analytics into the props `TendrilDashboard` takes.
 *
 * Pure and separate from the view so the arithmetic can be tested at fixed data, the same reason
 * `tendril_core::analytics` takes `today` as an argument instead of reading a clock.
 *
 * The recurring rule here: an unknown figure is `null` or an em dash, never zero. A month with no
 * records, a projection with no spend behind it and a plan whose rows were never priced are all
 * things we do not know, and rendering them as $0.00 states something the data does not.
 */

import type {
  DashboardActivityMonthDto,
  DashboardKpiDto,
  DashboardMonthValueDto,
  DashboardTrendDto,
} from "@ivy-interactive/components/tendril";
import type {
  DashboardActivity,
  DashboardMonthStats,
  RecentPlanCost,
  ShippedFeatureDay,
} from "../types/api";
import { toDayNumber, todayDayNumber } from "./rollingAverage";

/** Months plotted on the trend chart. The other 12 the daemon returns are the comparison year. */
export const TREND_MONTHS = 12;

/** The reporting period every "recent" KPI uses, and the period its delta compares against. */
export const KPI_WINDOW_DAYS = 30;

/**
 * Weekly buckets per month in the activity grid. Fixed at four rather than a true ISO week count:
 * months run 28 to 31 days, and a fifth column holding one to three days reads as a collapse in
 * throughput that never happened.
 */
export const ACTIVITY_WEEKS = 4;

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const monthLabel = (month: DashboardMonthStats): string =>
  MONTH_LABELS[month.month - 1] ?? String(month.month);

/** `YYYY-MM`, matching the prefix of every date string the daemon returns. */
const monthKey = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}`;

/**
 * Whether any record could exist in this month. A month that ended before the first record is
 * unknown, not empty, and the comparison line must break there rather than trace the axis.
 */
const hasRecords = (month: DashboardMonthStats, dataStart: string | null): boolean =>
  dataStart != null && monthKey(month.year, month.month) >= dataStart.slice(0, 7);

// --- formatting ---------------------------------------------------------------

/** The dash an unknown value renders as. Never "$0.00", which would be a claim. */
export const NO_VALUE = "—";

export const formatCurrency = (value: number): string =>
  value >= 1000 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;

export const formatTokens = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
};

/** `null` when there is no baseline: a percentage change from zero is not a number. */
const percentChange = (current: number, previous: number): number | null =>
  previous > 0 ? ((current - previous) / previous) * 100 : null;

const formatDelta = (change: number | null): string | undefined =>
  change == null ? undefined : `${change >= 0 ? "+" : ""}${change.toFixed(0)}%`;

const deltaDirection = (change: number | null): "up" | "down" | null => {
  if (change == null) return null;
  return change < 0 ? "down" : "up";
};

// --- component props ---------------------------------------------------------

/**
 * The last 12 months plotted, with the same months a year earlier as the comparison series.
 * `TrendChart` already renders a `null` in `previous` as a break, which is what the 736-day window
 * exists to make possible: before the comparison year has data there is nothing to compare to.
 */
export function buildTrend(activity: DashboardActivity | null): DashboardTrendDto | null {
  if (activity == null || activity.months.length === 0) return null;

  const { months, dailyDataStart } = activity;
  const plotted = months.slice(-TREND_MONTHS);
  const offset = months.length - plotted.length;

  const prevCost: (number | null)[] = [];
  const prevPlans: (number | null)[] = [];
  plotted.forEach((_, index) => {
    const prior = months[offset + index - TREND_MONTHS];
    if (prior == null || !hasRecords(prior, dailyDataStart)) {
      prevCost.push(null);
      prevPlans.push(null);
      return;
    }
    prevCost.push(prior.cost);
    prevPlans.push(prior.plansCreated);
  });

  return {
    months: plotted.map(monthLabel),
    cost: plotted.map((m) => m.cost),
    plans: plotted.map((m) => m.plansCreated),
    prevCost,
    prevPlans,
  };
}

/** Merged PRs per month, which is what `PillBars` plots. */
export function buildPullRequests(activity: DashboardActivity | null): DashboardMonthValueDto[] {
  if (activity == null) return [];
  return activity.months
    .slice(-TREND_MONTHS)
    .map((month) => ({ label: monthLabel(month), value: month.prsMerged }));
}

/**
 * Plans created, bucketed into weeks within each month. `ActivityGrid` takes weekly buckets rather
 * than a monthly total, so this has to go back to `dailyPlans` — the monthly rollup cannot be
 * un-summed.
 */
export function buildActivityMonths(
  activity: DashboardActivity | null,
): DashboardActivityMonthDto[] {
  if (activity == null) return [];

  const plotted = activity.months.slice(-TREND_MONTHS);
  const buckets = new Map<string, number[]>();
  for (const month of plotted) {
    buckets.set(monthKey(month.year, month.month), new Array<number>(ACTIVITY_WEEKS).fill(0));
  }

  for (const day of activity.dailyPlans) {
    const monthBuckets = buckets.get(day.date.slice(0, 7));
    if (monthBuckets == null) continue;
    const dayOfMonth = Number(day.date.slice(8, 10));
    if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1) continue;
    // Day 22 onward all land in the last bucket, so it covers 7 to 10 days.
    const week = Math.min(Math.floor((dayOfMonth - 1) / 7), ACTIVITY_WEEKS - 1);
    monthBuckets[week] += day.count;
  }

  return plotted.map((month) => ({
    label: monthLabel(month),
    weeks: buckets.get(monthKey(month.year, month.month)) ?? [],
  }));
}

// --- KPIs --------------------------------------------------------------------

/** Inclusive sum of `value` over the dates in `[fromDay, toDay]`. */
function sumInWindow<T extends { date: string }>(
  rows: readonly T[],
  value: (row: T) => number,
  fromDay: number,
  toDay: number,
): number {
  let total = 0;
  for (const row of rows) {
    const day = toDayNumber(row.date);
    if (day == null || day < fromDay || day > toDay) continue;
    total += value(row);
  }
  return total;
}

export interface KpiInputs {
  activity: DashboardActivity;
  shippedFeatures: readonly ShippedFeatureDay[];
  planCosts: readonly RecentPlanCost[];
  /** Injected so the arithmetic can be tested at a fixed date. */
  today?: number;
}

/**
 * The five drill-down KPIs, in the order the original showed them.
 *
 * The original's fifth card is a rate-limit usage window backed by `AgentUsageService`, which V2 has
 * no counterpart for. The original already falls back to the average-cost card when no usage
 * snapshot is available, so taking that branch permanently is faithful degradation.
 */
export function buildKpis({
  activity,
  shippedFeatures,
  planCosts,
  today = todayDayNumber(),
}: KpiInputs): DashboardKpiDto[] {
  const windowStart = today - (KPI_WINDOW_DAYS - 1);
  const priorEnd = windowStart - 1;
  const priorStart = priorEnd - (KPI_WINDOW_DAYS - 1);

  const features = sumInWindow(shippedFeatures, (f) => f.count, windowStart, today);
  const priorFeatures = sumInWindow(shippedFeatures, (f) => f.count, priorStart, priorEnd);
  const featureChange = percentChange(features, priorFeatures);

  const spend = sumInWindow(activity.dailyCosts, (d) => d.cost, windowStart, today);
  const priorSpend = sumInWindow(activity.dailyCosts, (d) => d.cost, priorStart, priorEnd);

  const tokens = sumInWindow(activity.dailyCosts, (d) => d.tokens, windowStart, today);
  const tokenChange = percentChange(
    tokens,
    sumInWindow(activity.dailyCosts, (d) => d.tokens, priorStart, priorEnd),
  );

  // Cost per feature needs both halves: no features means no denominator, and no spend means the
  // features that shipped were free to us, which is a different unknown from "cheap".
  const costPerFeature: DashboardKpiDto = {
    id: "costPerFeature",
    label: "Avg Cost / Feature",
    value: features > 0 && spend > 0 ? formatCurrency(spend / features) : "n/a",
    hint:
      features === 0
        ? `no features shipped in ${KPI_WINDOW_DAYS} days`
        : spend === 0
          ? `no priced spend in ${KPI_WINDOW_DAYS} days`
          : `${formatCurrency(spend)} over ${features} features`,
    delta: formatDelta(percentChange(spend, priorSpend)),
    direction: deltaDirection(percentChange(spend, priorSpend)),
  };

  const { forecast } = activity;
  const lower = forecast.calendarProjection;
  const upper = forecast.activityProjection;
  const forecastMonth: DashboardKpiDto = {
    id: "forecastMonth",
    label: "Forecast This Month",
    value:
      lower == null || upper == null
        ? NO_VALUE
        : lower === upper
          ? formatCurrency(lower)
          : `${formatCurrency(lower)} – ${formatCurrency(upper)}`,
    hint:
      lower == null || upper == null
        ? "no spend recorded to project from"
        : `${forecast.calendarDays}d calendar to ${forecast.activityDays}d activity basis`,
  };

  // The daemon supplies only the prior week's average, so the current one is computed here from the
  // plan rows — over the priced plans alone, matching the query's own divisor.
  const weekStart = today - 6;
  const pricedThisWeek = planCosts.filter((plan) => {
    if (plan.cost == null) return false;
    const day = toDayNumber(plan.created.slice(0, 10));
    return day != null && day >= weekStart && day <= today;
  });
  const currentAvg =
    pricedThisWeek.length > 0
      ? pricedThisWeek.reduce((acc, plan) => acc + (plan.cost ?? 0), 0) / pricedThisWeek.length
      : null;
  const avgChange = currentAvg == null ? null : percentChange(currentAvg, activity.prevWeekAvgCost);

  const avgCostPlan: DashboardKpiDto = {
    id: "avgCostPlan",
    label: "Avg Cost / Plan",
    value: currentAvg == null ? NO_VALUE : formatCurrency(currentAvg),
    hint:
      activity.prevWeekAvgCost > 0
        ? `vs ${formatCurrency(activity.prevWeekAvgCost)} prior week`
        : "no priced plans in the prior week",
    delta: formatDelta(avgChange),
    direction: deltaDirection(avgChange),
  };

  return [
    {
      id: "featuresShipped",
      label: "Features Shipped",
      value: String(features),
      hint: `last ${KPI_WINDOW_DAYS} days`,
      delta: formatDelta(featureChange),
      direction: deltaDirection(featureChange),
    },
    costPerFeature,
    forecastMonth,
    avgCostPlan,
    {
      id: "tokensConsumed",
      label: "Tokens Consumed",
      value: formatTokens(tokens),
      hint:
        forecast.subsidizedTokenPercent > 0
          ? `${forecast.subsidizedTokenPercent.toFixed(0)}% subsidized`
          : `last ${KPI_WINDOW_DAYS} days`,
      delta: formatDelta(tokenChange),
      direction: deltaDirection(tokenChange),
    },
  ];
}
