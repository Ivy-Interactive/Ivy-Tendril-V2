/**
 * The Dashboard's KPI drill-down: one panel per clickable KPI card. Port of V1
 * `Apps/Views/Sheets/KpiBreakdownSheet.cs`.
 *
 * V1 opens a right-hand sheet whose body `KpiBreakdownSheet.Build` composes: an explanatory callout,
 * a details list of the figures the card was computed from, the rows behind it, and - on the three
 * money cards - the per-agent split (`BuildAgentBreakdownSection`). Here that body is a blade (plan
 * 00548's master -> detail idiom) at the root of the sheet, so a later drill-in has somewhere to go.
 *
 * **Presentational.** It takes the analytics the Dashboard already holds ({@link KpiBreakdownData})
 * and reaches nothing itself. The window arithmetic lives here rather than being handed in, which is
 * what V1 does too: the sheet takes the raw series and derives its own last-30 and prior-30 sums
 * instead of being given the card's.
 *
 * The one rule every panel obeys: an unpriced cost renders as an em dash, never `$0.00`. The
 * `Option<f64>` the query returns means "these rows carried tokens without a charge", and if that
 * distinction dies at the last render then the whole `PricedRows` guard behind it was pointless.
 *
 * Every string is the `uiPanels` catalog's `kpiBreakdown` section, and every figure goes through the
 * current language's formatters, so a language change re-renders the panel in the new language.
 */

import type * as React from "react";
import { BladeContainer, type BladeDescriptor } from "../ui/blades";
import { Callout } from "../ui/callout";
import { DataTable, type DataTableColumn } from "../ui/data-table";
import { DetailItem, Details } from "../ui/detail";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { NO_VALUE } from "../../lib/formatters";
import {
  formatCurrency as formatMoney,
  formatList,
  formatNumber,
  useTranslation,
  type TFunction,
} from "@/i18n/uiPanels";

type PanelsT = TFunction;

// --- the data this sheet renders ----------------------------------------------
//
// Declared here rather than borrowed from the app's DTOs: the component that renders a shape owns
// it, and the library cannot import from the app. The app's `DashboardActivity`, `ShippedFeatureDay`,
// `RecentMergedPr`, `RecentPlanCost` and `AgentCostBreakdown` are structurally these.
//
// `null` is meaningful throughout: it means "unknown", never "zero".

/** One day of spend. `cost` may exceed `apiCost + subsidizedCost`: see {@link unclassifiedCost}. */
export interface KpiDailyCost {
  date: string;
  cost: number;
  tokens: number;
  apiCost: number;
  apiTokens: number;
  subsidizedCost: number;
  subsidizedTokens: number;
}

/** The month's projection, both bases side by side. */
export interface KpiForecast {
  calendarProjection: number | null;
  calendarDays: number;
  activityProjection: number | null;
  activityDays: number;
  daysInMonth: number;
  apiCalendarProjection: number | null;
  apiActivityProjection: number | null;
  totalApiSpend: number;
  totalSubsidizedSpend: number;
  subsidizedTokenPercent: number;
  subsidizedCostPercent: number;
}

export interface KpiActivity {
  prevWeekAvgCost: number;
  dailyCosts: readonly KpiDailyCost[];
  forecast: KpiForecast;
}

export interface KpiShippedFeatureDay {
  date: string;
  count: number;
}

export interface KpiMergedPr {
  prUrl: string;
  planId: number;
  title: string;
  repo: string | null;
  updated: string;
}

export interface KpiPlanCost {
  planId: number;
  title: string;
  /** The raw plan state; shown by its label. */
  state: string;
  created: string;
  /** `null` when no row was priced. Renders as a dash, never $0.00. */
  cost: number | null;
  tokens: number;
}

export interface KpiAgentCost {
  agent: string;
  cost: number;
  tokens: number;
  planCount: number;
}

export interface KpiBreakdownData {
  activity: KpiActivity | null;
  shippedFeatures: readonly KpiShippedFeatureDay[];
  mergedPrs: readonly KpiMergedPr[];
  planCosts: readonly KpiPlanCost[];
  agentCosts: readonly KpiAgentCost[];
  /** Days since the epoch (UTC). Injected so the windows can be pinned in tests and stories. */
  today?: number;
}

// --- dates and figures ----------------------------------------------------------

/**
 * The reporting period every "recent" KPI uses. The same 30 the app's `dashboardMetrics`
 * (`KPI_WINDOW_DAYS`) computes the cards with, so a card and its panel agree.
 */
export const KPI_WINDOW_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** Days since the epoch for a `YYYY-MM-DD` date, parsed as UTC like the daemon's dates. */
const toDayNumber = (isoDate: string): number | null => {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / MS_PER_DAY);
};

const toIsoDate = (dayNumber: number): string =>
  new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);

/** Today as a day number, in UTC to match the daemon's `Utc::now().date_naive()`. */
const todayDayNumber = (now: Date = new Date()): number => Math.floor(now.getTime() / MS_PER_DAY);

/**
 * `value` rounded the way `toFixed` rounds it: on the binary value, so `0.145` is `0.14`. `Intl`
 * rounds the shortest decimal instead, which would move a figure by a cent at every such tie. The
 * arithmetic decides the digits and the formatter only writes them, as the app's `dashboardMetrics`
 * does for the cards.
 */
const roundAsToFixed = (value: number, digits: number): number => Number(value.toFixed(digits));

const CENTS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
};
const WHOLE: Intl.NumberFormatOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

/** Whole dollars with the language's grouping: `$1,235` in English. */
const formatWholeDollars = (value: number): string => formatMoney(Math.round(value), "USD", WHOLE);

/** Cents below a thousand dollars, whole dollars above: `$6.67`, `$1,235` in English. */
const formatCurrency = (value: number): string =>
  value >= 1000 ? formatWholeDollars(value) : formatMoney(roundAsToFixed(value, 2), "USD", CENTS);

/** A percentage that is already one (`38` for 38%), in the language's own shape. */
function formatPercentValue(
  value: number,
  maximumFractionDigits = 0,
  signDisplay?: "always",
): string {
  return formatNumber(value, {
    style: "unit",
    unit: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits,
    useGrouping: false,
    ...(signDisplay ? { signDisplay } : {}),
  });
}

/** The plan states this sheet names, by label. Anything else is shown as it came. */
const PLAN_STATE_KEYS = {
  Completed: "kpiBreakdown.planStates.completed",
  Failed: "kpiBreakdown.planStates.failed",
  Review: "kpiBreakdown.planStates.review",
} as const;

const planStateLabel = (t: PanelsT, state: string): string =>
  state in PLAN_STATE_KEYS ? t(PLAN_STATE_KEYS[state as keyof typeof PLAN_STATE_KEYS]) : state;

/** The rolling window every "recent" figure on this page uses, as the cards do. */
const WINDOW_DAYS = KPI_WINDOW_DAYS;

/** `KpiBreakdownSheet`'s own window for the average-cost-per-plan card. */
const PLAN_WINDOW_DAYS = 7;

/**
 * The plan states the average-cost-per-plan query counts. Raw values: shown through their labels,
 * never as they are.
 */
const PLAN_STATES_INCLUDED = ["Completed", "Failed", "Review"] as const;

/**
 * The daemon's name for spend it could not tie to an agent: a row's `agent` value, matched and keyed
 * on as it is. It is shown by its label, in the table and in the callout that names it alike.
 */
const UNKNOWN_AGENT = "Unknown";

/** An agent as the table shows it: its own name, or the label of the daemon's "Unknown" row. */
const agentLabel = (t: PanelsT, agent: string): string =>
  agent === UNKNOWN_AGENT ? t("kpiBreakdown.agents.unknownAgent") : agent;

/** An amount that may not exist. `null` is unknown and renders as a dash. */
const cost = (value: number | null | undefined): string =>
  value == null ? NO_VALUE : formatCurrency(value);

/** Below this a difference is float noise, not a missing attribution. */
const CENT = 0.005;

/**
 * Spend a day's row records but attributes to neither the API nor the subscription.
 *
 * `get_activity_stats` splits spend on `CostSource`, treating only `'agent'`/`'computed'` as direct
 * API charges and `'estimated'` as subsidised, with a `Cost > 0` heuristic for rows where the column
 * is `NULL`. A row whose `CostSource` is the *empty string* — which is what every row written before
 * the column was captured holds, because V2 never ported V1's backfill — satisfies none of those
 * branches, so it lands in the total and in neither half.
 *
 * Reporting the two halves without this difference makes the split look complete when it is not, and
 * for a database of mostly historical rows the "API spend" it shows is near zero. So the panels state
 * the remainder as its own figure instead.
 */
const unclassifiedCost = (row: KpiDailyCost): number =>
  Math.max(0, row.cost - row.apiCost - row.subsidizedCost);

/**
 * `KpiBreakdownSheet.FormatCost`: whole dollars once a figure passes $100, because the cents on a
 * projection are noise next to its error bars.
 */
const roundedCost = (value: number | null | undefined): string => {
  if (value == null) return NO_VALUE;
  return value >= 100 ? formatWholeDollars(value) : formatCurrency(value);
};

/**
 * `FormatHelper.FormatPercent`: at most one decimal, so 38 reads as "38%" and not "38.0%". `+ 0` so
 * a -0 reads "0%", as the template literal wrote it, and not `Intl`'s "-0%".
 */
const percent = (value: number): string => formatPercentValue(Number(value.toFixed(1)) + 0, 1);

/** A share rounded to a whole percent, `Math.round` deciding as it always did (`+ 0`: never "-0%"). */
const wholePercent = (value: number): string => formatPercentValue(Math.round(value) + 0);

/** `FormatHelper.FormatCount`: thousands separators, which is how every count in V1 is written. */
const count = (value: number): string => formatNumber(value);

/**
 * `KpiBreakdownSheet.CalculateDelta`. "N/A" when either side is missing, because a change from
 * nothing is not a percentage; two decimals below 10% where the digits still carry information.
 */
const delta = (t: PanelsT, current: number, previous: number): string => {
  if (previous <= 0 || current <= 0) return t("kpiBreakdown.delta.notAvailable");
  const pct = ((current - previous) / previous) * 100;
  const wide = Math.abs(pct) >= 10;
  const magnitude = wide ? Math.round(Math.abs(pct)) : Number(Math.abs(pct).toFixed(2));
  // Signed after rounding, so a change that rounds to nothing keeps the sign it had: "-0%".
  return formatPercentValue(pct >= 0 ? magnitude : -magnitude, wide ? 0 : 2, "always");
};

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

/** The two adjacent windows every "vs the period before" figure on this page compares. */
const windows = (today: number) => {
  const windowStart = today - (WINDOW_DAYS - 1);
  const priorEnd = windowStart - 1;
  return { windowStart, priorEnd, priorStart: priorEnd - (WINDOW_DAYS - 1) };
};

const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation("uiPanels");
  return (
    <Callout.Info title={t("kpiBreakdown.empty.title")} className="m-4">
      {children}
    </Callout.Info>
  );
};

/** A titled section, the shape `Layout.Vertical() | Text.H4(...) | table` renders as. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="border-t border-border">
    <h4 className="px-4 pt-4 text-sm font-semibold text-foreground">{title}</h4>
    {children}
  </section>
);

// --- Spend by Coding Agent ---------------------------------------------------

const agentCostColumns = (
  t: PanelsT,
  totalCost: number,
  totalTokens: number,
): DataTableColumn<KpiAgentCost>[] => [
  {
    name: "agent",
    header: t("kpiBreakdown.agents.columns.agent"),
    accessor: (r) => r.agent,
    cell: (value) => (typeof value === "string" ? agentLabel(t, value) : null),
  },
  {
    name: "cost",
    header: t("kpiBreakdown.agents.columns.cost"),
    align: "Right",
    accessor: (r) => r.cost,
    cell: (value) => roundedCost(value as number),
  },
  {
    name: "costShare",
    header: t("kpiBreakdown.agents.columns.costShare"),
    align: "Right",
    accessor: (r) => (totalCost > 0 ? (r.cost / totalCost) * 100 : null),
    cell: (value) =>
      value == null ? t("kpiBreakdown.agents.shareNotAvailable") : percent(value as number),
  },
  {
    name: "tokens",
    header: t("kpiBreakdown.agents.columns.tokens"),
    align: "Right",
    accessor: (r) => r.tokens,
    cell: (value) => count(value as number),
  },
  {
    name: "tokenShare",
    header: t("kpiBreakdown.agents.columns.tokenShare"),
    align: "Right",
    accessor: (r) => (totalTokens > 0 ? (r.tokens / totalTokens) * 100 : null),
    cell: (value) =>
      value == null ? t("kpiBreakdown.agents.shareNotAvailable") : percent(value as number),
  },
  {
    name: "planCount",
    header: t("kpiBreakdown.agents.columns.planCount"),
    align: "Right",
    accessor: (r) => r.planCount,
  },
];

/**
 * `KpiBreakdownSheet.BuildAgentBreakdownSection`: which agent the money went to, under every card
 * that reports money. V1 refetches it per window (30 days for the two spend cards, 7 for the plan
 * average); the analytics hook fetches one snapshot at the daemon's default window, so the heading
 * claims no window rather than a wrong one.
 */
const AgentBreakdown: React.FC<{ agentCosts: readonly KpiAgentCost[] }> = ({ agentCosts }) => {
  const { t } = useTranslation("uiPanels");

  if (agentCosts.length === 0) {
    return (
      <Section title={t("kpiBreakdown.agents.title")}>
        <EmptyNote>{t("kpiBreakdown.agents.empty")}</EmptyNote>
      </Section>
    );
  }

  const totalCost = agentCosts.reduce((acc, a) => acc + a.cost, 0);
  const totalTokens = agentCosts.reduce((acc, a) => acc + a.tokens, 0);
  const unknownCost = agentCosts.find((a) => a.agent === UNKNOWN_AGENT)?.cost ?? null;

  return (
    <Section title={t("kpiBreakdown.agents.title")}>
      <DataTable
        columns={agentCostColumns(t, totalCost, totalTokens)}
        rows={[...agentCosts]}
        getRowId={(row) => row.agent}
        paginated={false}
      />
      {unknownCost != null && (
        <Callout.Info title={t("kpiBreakdown.agents.partialAttribution.title")} className="m-4">
          {totalCost > 0
            ? t(
                unknownCost >= totalCost - CENT
                  ? "kpiBreakdown.agents.partialAttribution.bodyUninformative"
                  : "kpiBreakdown.agents.partialAttribution.bodyWithShare",
                {
                  agent: agentLabel(t, UNKNOWN_AGENT),
                  share: percent((unknownCost / totalCost) * 100),
                },
              )
            : t("kpiBreakdown.agents.partialAttribution.body", {
                agent: agentLabel(t, UNKNOWN_AGENT),
              })}
        </Callout.Info>
      )}
    </Section>
  );
};

// --- featuresShipped ---------------------------------------------------------

const featureDayColumns = (t: PanelsT): DataTableColumn<KpiShippedFeatureDay>[] => [
  {
    name: "date",
    header: t("kpiBreakdown.featuresShipped.byDay.columns.date"),
    width: "140px",
    accessor: (r) => r.date,
  },
  {
    name: "count",
    header: t("kpiBreakdown.featuresShipped.byDay.columns.count"),
    align: "Right",
    accessor: (r) => r.count,
    cell: (value) => count(value as number),
  },
];

const mergedPrColumns = (t: PanelsT): DataTableColumn<KpiMergedPr>[] => [
  {
    name: "planId",
    header: t("kpiBreakdown.featuresShipped.mergedPrs.columns.plan"),
    width: "80px",
    accessor: (r) => r.planId,
  },
  {
    name: "title",
    header: t("kpiBreakdown.featuresShipped.mergedPrs.columns.title"),
    accessor: (r) => r.title,
    wrapText: true,
  },
  {
    name: "repo",
    header: t("kpiBreakdown.featuresShipped.mergedPrs.columns.repo"),
    accessor: (r) => r.repo,
    // Wrapped, like the title beside it. A repo is a local path with no spaces, and an unwrapped
    // cell's minimum width is the whole of it: once the sheet stopped growing to fit its content,
    // the table gave that path its full length and squeezed the title to a word per line. Letting
    // both break shares the width between them and keeps the path readable in full.
    wrapText: true,
    // A plan can have merged a PR without a Repos row, and an empty cell says so more honestly
    // than a guessed path would.
    cell: (value) => (typeof value === "string" && value !== "" ? value : NO_VALUE),
  },
  {
    name: "updated",
    header: t("kpiBreakdown.featuresShipped.mergedPrs.columns.merged"),
    width: "170px",
    accessor: (r) => r.updated,
  },
  {
    name: "prUrl",
    header: t("kpiBreakdown.featuresShipped.mergedPrs.columns.prUrl"),
    width: "60px",
    sortable: false,
    accessor: (r) => r.prUrl,
    cell: (value) =>
      typeof value === "string" ? (
        <a href={value} target="_blank" rel="noreferrer" className="text-xs underline">
          {t("kpiBreakdown.featuresShipped.mergedPrs.open")}
        </a>
      ) : null,
  },
];

// --- forecastMonth -----------------------------------------------------------

const dailyCostColumns = (t: PanelsT): DataTableColumn<KpiDailyCost>[] => [
  {
    name: "date",
    header: t("kpiBreakdown.forecastMonth.daily.columns.date"),
    width: "110px",
    accessor: (r) => r.date,
  },
  {
    name: "cost",
    header: t("kpiBreakdown.forecastMonth.daily.columns.cost"),
    align: "Right",
    accessor: (r) => r.cost,
    cell: (value) => roundedCost(value as number),
  },
  {
    name: "apiCost",
    header: t("kpiBreakdown.forecastMonth.daily.columns.apiCost"),
    align: "Right",
    accessor: (r) => r.apiCost,
    cell: (value) => roundedCost(value as number),
  },
  {
    name: "subsidizedCost",
    header: t("kpiBreakdown.forecastMonth.daily.columns.subsidizedCost"),
    align: "Right",
    accessor: (r) => r.subsidizedCost,
    cell: (value) => roundedCost(value as number),
  },
  {
    name: "tokens",
    header: t("kpiBreakdown.forecastMonth.daily.columns.tokens"),
    align: "Right",
    // The greater of the two token counts, the guard V1 applies here: the rollup under-reports
    // whenever a row carried tokens it missed.
    accessor: (r) => Math.max(r.tokens, r.apiTokens + r.subsidizedTokens),
    cell: (value) => count(value as number),
  },
  {
    name: "subsidizedShare",
    header: t("kpiBreakdown.forecastMonth.daily.columns.subsidizedShare"),
    align: "Right",
    accessor: (r) => {
      const total = Math.max(r.tokens, r.apiTokens + r.subsidizedTokens);
      if (total > 0) return (r.subsidizedTokens / total) * 100;
      return r.cost > 0 ? (r.subsidizedCost / r.cost) * 100 : 0;
    },
    cell: (value) => wholePercent(value as number),
  },
];

// --- avgCostPlan -------------------------------------------------------------

const planCostColumns = (t: PanelsT): DataTableColumn<KpiPlanCost>[] => [
  {
    name: "planId",
    header: t("kpiBreakdown.avgCostPlan.plans.columns.plan"),
    width: "80px",
    accessor: (r) => r.planId,
  },
  {
    name: "title",
    header: t("kpiBreakdown.avgCostPlan.plans.columns.title"),
    accessor: (r) => r.title,
    wrapText: true,
  },
  {
    name: "state",
    header: t("kpiBreakdown.avgCostPlan.plans.columns.state"),
    width: "110px",
    // Sorted on the raw state, shown by its label.
    accessor: (r) => r.state,
    cell: (value) => (typeof value === "string" ? planStateLabel(t, value) : null),
  },
  {
    name: "created",
    header: t("kpiBreakdown.avgCostPlan.plans.columns.created"),
    width: "170px",
    accessor: (r) => r.created,
  },
  {
    name: "tokens",
    header: t("kpiBreakdown.avgCostPlan.plans.columns.tokens"),
    align: "Right",
    accessor: (r) => r.tokens,
    cell: (value) => count(value as number),
  },
  {
    name: "cost",
    header: t("kpiBreakdown.avgCostPlan.plans.columns.cost"),
    align: "Right",
    accessor: (r) => r.cost,
    // The whole point of the null: a plan whose rows carried tokens without a charge cost an
    // unknown amount, not nothing.
    cell: (value) => cost(value as number | null),
  },
];

// --- panels ------------------------------------------------------------------

/**
 * Every KPI id that opens a panel — the four cards `DashboardApp.BuildKpis` emits. The fifth key
 * `usageWindow` has no V2 counterpart: there is no agent usage service to report a rate-limit
 * window, so the card never appears and neither does its panel.
 */
export const KPI_BREAKDOWN_IDS = [
  "featuresShipped",
  "costPerFeature",
  "forecastMonth",
  "avgCostPlan",
] as const;

export type KpiBreakdownId = (typeof KPI_BREAKDOWN_IDS)[number];

export const isKpiBreakdownId = (value: string): value is KpiBreakdownId =>
  (KPI_BREAKDOWN_IDS as readonly string[]).includes(value);

/** Panel titles, from `DashboardApp.GetKpiSheetTitle`. */
const kpiTitle = (t: PanelsT, kpiId: KpiBreakdownId): string => t(`kpiBreakdown.titles.${kpiId}`);

/**
 * The blade for one KPI, or `null` when the id is not one we drill into. `t` is the sheet's, so the
 * blade is rebuilt - in the new language - on the render a language change causes. Exported for
 * tests that want a panel without the sheet around it.
 */
export function buildKpiBlade(
  kpiId: string,
  data: KpiBreakdownData,
  t: PanelsT,
): BladeDescriptor | null {
  if (!isKpiBreakdownId(kpiId)) return null;
  const { activity, shippedFeatures, mergedPrs, planCosts, agentCosts } = data;
  const today = data.today ?? todayDayNumber();
  const { windowStart, priorStart, priorEnd } = windows(today);
  const blade = (subtitle: string, content: React.ReactNode): BladeDescriptor => ({
    id: kpiId,
    title: kpiTitle(t, kpiId),
    subtitle,
    width: "lg",
    content,
  });

  switch (kpiId) {
    case "featuresShipped": {
      const features = sumInWindow(shippedFeatures, (f) => f.count, windowStart, today);
      const priorFeatures = sumInWindow(shippedFeatures, (f) => f.count, priorStart, priorEnd);
      const inWindow = shippedFeatures
        .filter((f) => {
          const day = toDayNumber(f.date);
          return day != null && day >= windowStart && day <= today;
        })
        .sort((a, b) => b.date.localeCompare(a.date));

      return blade(t("kpiBreakdown.featuresShipped.subtitle"), [
        <Callout.Info
          key="note"
          title={t("kpiBreakdown.featuresShipped.note.title")}
          className="m-4"
        >
          {t("kpiBreakdown.featuresShipped.note.body", { count: WINDOW_DAYS })}
        </Callout.Info>,
        <Details key="details" className="px-4 pb-4">
          <DetailItem label={t("kpiBreakdown.details.metric")}>
            {t("kpiBreakdown.featuresShipped.metric")}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.details.formula")}>
            {t("kpiBreakdown.featuresShipped.formula", { count: WINDOW_DAYS })}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.featuresShipped.last", { count: WINDOW_DAYS })}>
            {count(features)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.featuresShipped.prior", { count: WINDOW_DAYS })}>
            {count(priorFeatures)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.featuresShipped.periodDelta", { days: WINDOW_DAYS })}>
            {delta(t, features, priorFeatures)}
          </DetailItem>
        </Details>,
        <Section
          key="days"
          title={t("kpiBreakdown.featuresShipped.byDay.title", { count: WINDOW_DAYS })}
        >
          {inWindow.length === 0 ? (
            <EmptyNote>
              {t("kpiBreakdown.featuresShipped.byDay.empty", { days: WINDOW_DAYS })}
            </EmptyNote>
          ) : (
            <DataTable
              columns={featureDayColumns(t)}
              rows={inWindow}
              getRowId={(row) => row.date}
              defaultPageSize={25}
            />
          )}
        </Section>,
        <Section key="prs" title={t("kpiBreakdown.featuresShipped.mergedPrs.title")}>
          {mergedPrs.length === 0 ? (
            <EmptyNote>{t("kpiBreakdown.featuresShipped.mergedPrs.empty")}</EmptyNote>
          ) : (
            <DataTable
              columns={mergedPrColumns(t)}
              rows={[...mergedPrs]}
              getRowId={(row) => row.prUrl}
              defaultPageSize={25}
            />
          )}
        </Section>,
      ]);
    }

    case "costPerFeature": {
      const features = sumInWindow(shippedFeatures, (f) => f.count, windowStart, today);
      const priorFeatures = sumInWindow(shippedFeatures, (f) => f.count, priorStart, priorEnd);
      const dailyCosts = activity?.dailyCosts ?? [];
      const spend = sumInWindow(dailyCosts, (d) => d.cost, windowStart, today);
      const priorSpend = sumInWindow(dailyCosts, (d) => d.cost, priorStart, priorEnd);
      const perFeature = features > 0 ? spend / features : 0;
      const priorPerFeature = priorFeatures > 0 ? priorSpend / priorFeatures : 0;

      return blade(t("kpiBreakdown.costPerFeature.subtitle"), [
        <Callout.Info
          key="note"
          title={t("kpiBreakdown.costPerFeature.note.title")}
          className="m-4"
        >
          {t("kpiBreakdown.costPerFeature.note.body", { days: WINDOW_DAYS })}
        </Callout.Info>,
        <Details key="details" className="px-4 pb-4">
          <DetailItem label={t("kpiBreakdown.details.metric")}>
            {t("kpiBreakdown.costPerFeature.metric")}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.details.formula")}>
            {t("kpiBreakdown.costPerFeature.formula", { days: WINDOW_DAYS })}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.costPerFeature.lastSpend", { count: WINDOW_DAYS })}>
            {cost(spend)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.costPerFeature.lastFeatures", { count: WINDOW_DAYS })}>
            {count(features)}
          </DetailItem>
          <DetailItem
            label={t("kpiBreakdown.costPerFeature.lastCostPerFeature", { count: WINDOW_DAYS })}
          >
            {features > 0 ? cost(perFeature) : t("kpiBreakdown.costPerFeature.noValue")}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.costPerFeature.priorSpend", { count: WINDOW_DAYS })}>
            {cost(priorSpend)}
          </DetailItem>
          <DetailItem
            label={t("kpiBreakdown.costPerFeature.priorFeatures", { count: WINDOW_DAYS })}
          >
            {count(priorFeatures)}
          </DetailItem>
          <DetailItem
            label={t("kpiBreakdown.costPerFeature.priorCostPerFeature", { count: WINDOW_DAYS })}
          >
            {priorFeatures > 0 ? cost(priorPerFeature) : t("kpiBreakdown.costPerFeature.noValue")}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.costPerFeature.periodDelta", { days: WINDOW_DAYS })}>
            {delta(t, perFeature, priorPerFeature)}
          </DetailItem>
        </Details>,
        <AgentBreakdown key="agents" agentCosts={agentCosts} />,
      ]);
    }

    case "forecastMonth": {
      if (activity == null) {
        return blade(t("kpiBreakdown.forecastMonth.subtitle"), [
          <EmptyNote key="empty">{t("kpiBreakdown.forecastMonth.empty")}</EmptyNote>,
        ]);
      }

      const { forecast } = activity;
      // Month to date off the date strings rather than a fresh clock, so the panel and the window
      // above it are both anchored to the same `today`.
      const todayIso = toIsoDate(today);
      const dayOfMonth = Number(todayIso.slice(8, 10));
      const monthToDate = activity.dailyCosts.filter((d) =>
        d.date.startsWith(todayIso.slice(0, 7)),
      );
      const mtdTotal = monthToDate.reduce((acc, d) => acc + d.cost, 0);
      const mtdApi = monthToDate.reduce((acc, d) => acc + d.apiCost, 0);
      const mtdSubsidized = monthToDate.reduce((acc, d) => acc + d.subsidizedCost, 0);
      const mtdUnclassified = monthToDate.reduce((acc, d) => acc + unclassifiedCost(d), 0);
      const daysRemaining = Math.max(0, forecast.daysInMonth - dayOfMonth);
      const inWindow = activity.dailyCosts
        .filter((d) => {
          const day = toDayNumber(d.date);
          return day != null && day >= windowStart && day <= today;
        })
        .sort((a, b) => b.date.localeCompare(a.date));
      const windowUnclassified = inWindow.reduce((acc, d) => acc + unclassifiedCost(d), 0);

      return blade(t("kpiBreakdown.forecastMonth.subtitle"), [
        <Callout.Info key="note" title={t("kpiBreakdown.forecastMonth.note.title")} className="m-4">
          {forecast.subsidizedTokenPercent > 0
            ? t("kpiBreakdown.forecastMonth.note.bodySubsidized", {
                count: WINDOW_DAYS,
                percent: wholePercent(forecast.subsidizedTokenPercent),
                subsidizedValue: roundedCost(forecast.totalSubsidizedSpend),
                apiCharges: roundedCost(forecast.totalApiSpend),
              })
            : t("kpiBreakdown.forecastMonth.note.body", { count: WINDOW_DAYS })}
        </Callout.Info>,
        // Both bases side by side rather than one headline figure. Neither is right on its own: the
        // calendar basis assumes the idle days keep coming, the activity basis assumes every day is
        // a working day, and for bursty usage the gap between them *is* the uncertainty.
        <Details key="details" className="px-4 pb-4">
          <DetailItem label={t("kpiBreakdown.details.metric")}>
            {t("kpiBreakdown.forecastMonth.metric")}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.apiCalendar")}>
            {roundedCost(forecast.apiCalendarProjection)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.apiActivity")}>
            {roundedCost(forecast.apiActivityProjection)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.totalCalendar")}>
            {roundedCost(forecast.calendarProjection)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.totalActivity")}>
            {roundedCost(forecast.activityProjection)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.subsidizedTokenShare")}>
            {t("kpiBreakdown.forecastMonth.subsidizedTokenShareValue", {
              percent: wholePercent(forecast.subsidizedTokenPercent),
            })}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.subsidizedValueShare")}>
            {t("kpiBreakdown.forecastMonth.subsidizedValueShareValue", {
              percent: wholePercent(forecast.subsidizedCostPercent),
            })}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.mtdApiSpend")}>
            {roundedCost(mtdApi)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.mtdSubsidizedValue")}>
            {roundedCost(mtdSubsidized)}
          </DetailItem>
          {mtdUnclassified > CENT && (
            <DetailItem label={t("kpiBreakdown.forecastMonth.mtdUnattributedSpend")}>
              {roundedCost(mtdUnclassified)}
            </DetailItem>
          )}
          <DetailItem label={t("kpiBreakdown.forecastMonth.mtdTotalMarketValue")}>
            {roundedCost(mtdTotal)}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.calendarDays")}>
            {t("kpiBreakdown.forecastMonth.dayCount", { count: forecast.calendarDays })}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.activeDays")}>
            {t("kpiBreakdown.forecastMonth.dayCount", { count: forecast.activityDays })}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.daysRemaining")}>
            {t("kpiBreakdown.forecastMonth.dayCount", { count: daysRemaining })}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.forecastMonth.daysInMonth")}>
            {t("kpiBreakdown.forecastMonth.dayCount", { count: forecast.daysInMonth })}
          </DetailItem>
        </Details>,
        <Section
          key="daily"
          title={t("kpiBreakdown.forecastMonth.daily.title", { count: WINDOW_DAYS })}
        >
          {inWindow.length === 0 ? (
            <EmptyNote>
              {t("kpiBreakdown.forecastMonth.daily.empty", { days: WINDOW_DAYS })}
            </EmptyNote>
          ) : (
            <>
              <DataTable
                columns={dailyCostColumns(t)}
                rows={inWindow}
                getRowId={(row) => row.date}
                defaultPageSize={25}
              />
              {windowUnclassified > CENT && (
                <Callout.Info
                  title={t("kpiBreakdown.forecastMonth.daily.incompleteSplit.title")}
                  className="m-4"
                >
                  {t("kpiBreakdown.forecastMonth.daily.incompleteSplit.body", {
                    amount: roundedCost(windowUnclassified),
                  })}
                </Callout.Info>
              )}
            </>
          )}
        </Section>,
        <AgentBreakdown key="agents" agentCosts={agentCosts} />,
      ]);
    }

    case "avgCostPlan": {
      const priced = planCosts.filter((plan) => {
        if (plan.cost == null) return false;
        const day = toDayNumber(plan.created.slice(0, 10));
        return day != null && day >= today - (PLAN_WINDOW_DAYS - 1) && day <= today;
      });
      const currentAvg =
        priced.length > 0
          ? priced.reduce((acc, plan) => acc + (plan.cost ?? 0), 0) / priced.length
          : 0;
      const priorAvg = activity?.prevWeekAvgCost ?? 0;
      const stateLabels = PLAN_STATES_INCLUDED.map((state) => planStateLabel(t, state));

      return blade(t("kpiBreakdown.avgCostPlan.subtitle"), [
        <Callout.Info key="note" title={t("kpiBreakdown.avgCostPlan.note.title")} className="m-4">
          {t("kpiBreakdown.avgCostPlan.note.body", {
            count: PLAN_WINDOW_DAYS,
            // "Completed, Failed, or Review" in English.
            states: formatList(stateLabels, { type: "disjunction" }),
          })}
        </Callout.Info>,
        <Details key="details" className="px-4 pb-4">
          <DetailItem label={t("kpiBreakdown.details.metric")}>
            {t("kpiBreakdown.avgCostPlan.metric")}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.avgCostPlan.window")}>
            {t("kpiBreakdown.avgCostPlan.windowValue", { count: PLAN_WINDOW_DAYS })}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.avgCostPlan.statesIncluded")}>
            {/* "Completed, Failed, Review" in English: a plain list, no "and". */}
            {formatList(stateLabels, { type: "unit", style: "short" })}
          </DetailItem>
          <DetailItem
            label={t("kpiBreakdown.avgCostPlan.currentAverage", { days: PLAN_WINDOW_DAYS })}
          >
            {priced.length > 0 ? cost(currentAvg) : NO_VALUE}
          </DetailItem>
          <DetailItem
            label={t("kpiBreakdown.avgCostPlan.priorAverage", { days: PLAN_WINDOW_DAYS })}
          >
            {priorAvg > 0 ? cost(priorAvg) : NO_VALUE}
          </DetailItem>
          <DetailItem label={t("kpiBreakdown.avgCostPlan.periodDelta", { days: PLAN_WINDOW_DAYS })}>
            {delta(t, currentAvg, priorAvg)}
          </DetailItem>
        </Details>,
        <Section
          key="plans"
          title={t("kpiBreakdown.avgCostPlan.plans.title", { count: PLAN_WINDOW_DAYS })}
        >
          {planCosts.length === 0 ? (
            <EmptyNote>
              {t("kpiBreakdown.avgCostPlan.plans.empty", { days: PLAN_WINDOW_DAYS })}
            </EmptyNote>
          ) : (
            <DataTable
              columns={planCostColumns(t)}
              rows={[...planCosts]}
              getRowId={(row) => String(row.planId)}
              defaultPageSize={25}
            />
          )}
        </Section>,
        <AgentBreakdown key="agents" agentCosts={agentCosts} />,
      ]);
    }
  }
}

// --- the sheet ---------------------------------------------------------------

export interface KpiBreakdownSheetProps {
  /**
   * The clicked card's KPI id, or `null` for closed. An id with no panel (anything outside
   * {@link KPI_BREAKDOWN_IDS}) keeps the sheet closed, so the host can pass the card's id through.
   */
  kpiId: string | null;
  data: KpiBreakdownData;
  onClose: () => void;
}

/**
 * The drill-down sheet itself, on the shared `ui/sheet.tsx` - same side, header and close behaviour
 * as the app's other sheets. The blade is its whole body and brings its own header, so the sheet's
 * title is for assistive technology only.
 *
 * Wider than `SheetPanel`'s `UxHelper.SheetWidth` ladder on purpose: the forecast and plan tables
 * carry six columns, and at two fifths of a wide window they wrap every cell.
 */
export function KpiBreakdownSheet({ kpiId, data, onClose }: KpiBreakdownSheetProps) {
  const { t } = useTranslation("uiPanels");
  const blade = kpiId == null ? null : buildKpiBlade(kpiId, data, t);
  return (
    <Sheet
      open={blade !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        data-testid="kpi-breakdown"
        className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-3/4 xl:w-3/5"
        aria-describedby={undefined}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{blade?.title ?? t("kpiBreakdown.sheetTitle")}</SheetTitle>
        </SheetHeader>
        {blade && (
          <BladeContainer
            root={{
              ...blade,
              // The descriptor's own width hint is what it gets when something pushes it deeper in
              // a stack; as the root of this sheet it fills the panel instead.
              width: "flex",
            }}
            className="min-h-0 flex-1"
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
