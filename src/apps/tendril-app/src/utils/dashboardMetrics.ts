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
} from "@ivy-interactive/components/tendril";
import type {
  DashboardActivity,
  DashboardMonthStats,
  RecentPlanCost,
  ShippedFeatureDay,
} from "../types/api";
import { toDayNumber, todayDayNumber } from "./rollingAverage";
import { NO_VALUE, formatTokensCompact } from "./format";

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

// --- formatting ---------------------------------------------------------------

/**
 * The dash an unknown value renders as. Never "$0.00", which would be a claim.
 *
 * Re-exported rather than re-homed: `DashboardView` and `KpiBreakdown` take the whole dashboard
 * vocabulary from this module, and the em dash being the same one the Jobs table draws is a fact
 * about the app, not something either caller should have to know.
 */
export { NO_VALUE };

export const formatCurrency = (value: number): string =>
  value >= 1000 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;

/** `"1.0"` to `"1"`, so a round figure does not spend a character saying so. */
const trimDotZero = (mantissa: string): string =>
  mantissa.endsWith(".0") ? mantissa.slice(0, -2) : mantissa;

/** Units the compact currency ladder climbs, in order. */
const COMPACT_UNITS = ["k", "M", "B", "T"];

/**
 * A cost at two or three significant figures, never wider than five characters: `$0.00`, `$9.99`,
 * `$99.9`, `$999`, `$1.2k`, `$47k`, `$999k`, `$1.2M`.
 *
 * For the *forecast* only, and only because the forecast is rendered as a range. Two
 * {@link formatCurrency} figures joined by a separator run to `$1,234,567 – $2,345,678` — nineteen
 * characters, and at the KPI value's 30px semibold roughly 300px. A KPI card's content box narrows to
 * about 137px: four cards across, 24px gutters, 24px card padding, in a main column that is the full
 * dashboard width at a ~870px container (`dashboard.css`, `.tdb-kpis`, and the same figure recurs
 * just above the 1260px fold). `.tdb-root` sets `overflow-x: hidden`, so the overflow never spilled
 * visibly — it *cut a number in half*, and half a currency figure still reads as a currency figure,
 * which is worse than an ugly card.
 *
 * Rounding the digits away is the honest half of the fix rather than a concession. Both bounds are a
 * daily rate multiplied by the days in a month, and the width of the band between them is itself an
 * admission that the next digit means nothing; cents on a month-end projection are noise. Every
 * unrounded figure is in the drill-down (`KpiBreakdown`, `roundedCost`) one click away, so nothing is
 * lost. The other cards keep {@link formatCurrency}: an *observed* average cost per feature is a
 * measurement, and its cents are real.
 *
 * Five characters is what makes the range fit rather than merely fit better. `$999k` is about 89px at
 * this size, so `$999k –` is about 112px and clears the 137px floor with room; the seven-character
 * `$999.9k` variant this replaced came to about 138px with its dash, i.e. one pixel over, and would
 * have had `overflow-wrap` break the number instead. The extra digit bought nothing: relative
 * precision is worst just above a unit boundary (`$1.2k` resolves to $100, 8%) and that is identical
 * under either format.
 *
 * Each threshold is the input that would *round up* into the next format, not the format's own bound,
 * so no input can produce a sixth character: 99.95 is `$100` rather than `$100.0`, 999.5 is `$1k`
 * rather than `$1000`, and 999_500 is `$1M` rather than `$1000k`. A trailing `.0` is always dropped,
 * so a round thousand is `$1k` and ten thousand is `$10k`. The guarantee holds up to `$999T`,
 * comfortably past any month a coding agent can bill for.
 */
export function formatCurrencyCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude)) return NO_VALUE;

  // Single dollars: the cents are the figure, and two of them cost no extra characters.
  if (magnitude < 9.995) return `${sign}$${magnitude.toFixed(2)}`;
  // Tens: one decimal. Hundreds: none — the tenth of a dollar is not a fact about next month.
  if (magnitude < 99.95) return `${sign}$${trimDotZero(magnitude.toFixed(1))}`;
  if (magnitude < 999.5) return `${sign}$${Math.round(magnitude)}`;

  let scaled = magnitude / 1000;
  let unit = 0;
  // Climb until the mantissa is under a thousand, so 999_500 is `$1M` and never `$1000k`.
  while (scaled >= 999.5 && unit < COMPACT_UNITS.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  // Same shape one unit up: a decimal below ten, whole numbers above it.
  const mantissa = scaled < 9.995 ? trimDotZero(scaled.toFixed(1)) : String(Math.round(scaled));
  return `${sign}$${mantissa}${COMPACT_UNITS[unit]}`;
}

/**
 * The widest string {@link formatCurrencyCompact} can return for a non-negative cost. Exported so the
 * layout test can pin the budget the card was designed against, rather than restating it.
 */
export const COMPACT_CURRENCY_MAX_CHARS = 5;

/**
 * What sits between the two projection bases: a non-breaking space, an en dash, an ordinary space.
 *
 * The asymmetry is the *other* half of the fix, and the part an innocent tidy-up removes. With two
 * ordinary spaces the line breaker is free to put `– $3.4k` on the second line, and a leading en
 * dash on a currency figure reads as a minus sign. Gluing the dash to the lower bound leaves exactly
 * one break opportunity, so the range either sits on one line or wraps as `$1.2k –` / `$3.4k`.
 * `.tdb-kpi-value` supplies the wrapping half (`white-space: normal`, `min-width: 0`).
 */
export const RANGE_SEPARATOR = "\u00a0\u2013 ";

const formatRange = (lower: string, upper: string): string => `${lower}${RANGE_SEPARATOR}${upper}`;

/**
 * The Tokens Consumed KPI's figure. Shared with the Pull Requests table, which had copied this
 * ladder and then lost its millions branch; see {@link formatTokensCompact}.
 */
export { formatTokensCompact };

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
 * Merged PRs per month, which is what `PillBars` plots on the Pull Requests card's Month tab.
 *
 * Six months, which is `DashboardApp.BuildMonthlyPullRequests`'s own `count = 6`. This used to plot
 * {@link TREND_MONTHS} of them, and twelve does not fit: the card lives in a 280-360px side column
 * (`dashboard.css`, `.tdb-grid`), and twelve bars with 8px gutters leave each one about 11px wide
 * while its month label needs roughly 20px — so the labels ran past the card and
 * `.tdb-side-block { overflow: hidden }` cut them off. Six bars are ~27px each and fit at the narrow
 * end. The activity grid keeps twelve because its columns shrink to a 9px floor inside a scroller;
 * these bars carry a label each and cannot.
 */
export const PR_MONTHS = 6;

export function buildPullRequests(activity: DashboardActivity | null): DashboardMonthValueDto[] {
  if (activity == null) return [];
  return activity.months
    .slice(-PR_MONTHS)
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
    buckets.set(
      monthKey(month.year, month.month),
      Array.from({ length: ACTIVITY_WEEKS }, () => 0),
    );
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
  // Compact on *both* branches, not only the range: one basis is the same projection as two, and a
  // card whose precision changes with the shape of the month is worse than one that always rounds.
  const lowerText = lower == null ? null : formatCurrencyCompact(lower);
  const upperText = upper == null ? null : formatCurrencyCompact(upper);
  const forecastMonth: DashboardKpiDto = {
    id: "forecastMonth",
    label: "Forecast This Month",
    // Collapsed on the rendered *text*, not on the raw floats. The bases coincide whenever every day
    // in the window had spend, and rounding brings them together whenever they are within a
    // significant figure of each other — and `$1.2k – $1.2k` states a band the card cannot show.
    value:
      lowerText == null || upperText == null
        ? NO_VALUE
        : lowerText === upperText
          ? lowerText
          : formatRange(lowerText, upperText),
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
      value: formatTokensCompact(tokens),
      hint:
        forecast.subsidizedTokenPercent > 0
          ? `${forecast.subsidizedTokenPercent.toFixed(0)}% subsidized`
          : `last ${KPI_WINDOW_DAYS} days`,
      delta: formatDelta(tokenChange),
      direction: deltaDirection(tokenChange),
    },
  ];
}
