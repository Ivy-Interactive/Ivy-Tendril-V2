/**
 * KPI drill-down panels, one per clickable dashboard card.
 *
 * The original opened a right-hand sheet (`KpiBreakdownSheet`). This uses the blade stack from
 * plan 00548, which is the host the plan's `kpi-drilldown-host` question recommends and the
 * master → detail idiom the rest of the port is moving to. Inside that host each panel is what
 * `KpiBreakdownSheet.Build` composes: an explanatory callout, a details list of the figures the
 * card was computed from, the rows behind it, and — on the three money cards — the per-agent
 * split (`KpiBreakdownSheet.BuildAgentBreakdownSection`).
 *
 * The window arithmetic is recomputed here rather than shared with `buildKpis`, which is what
 * `KpiBreakdownSheet` does too: the sheet takes the raw series and derives its own last-30 and
 * prior-30 sums instead of being handed the card's.
 *
 * The one rule every panel obeys: an unpriced cost renders as an em dash, never `$0.00`. The
 * `Option<f64>` the query returns means "these rows carried tokens without a charge", and if that
 * distinction dies at the last render then the whole `PricedRows` guard behind it was pointless.
 */

import type React from "react";
import { Callout, DataTable, DetailItem, Details } from "@ivy-interactive/components/ui";
import type { BladeDescriptor, DataTableColumn } from "@ivy-interactive/components/ui";
import type {
  AgentCostBreakdown,
  DashboardActivity,
  DashboardDailyCost,
  RecentMergedPr,
  RecentPlanCost,
  ShippedFeatureDay,
} from "../types/api";
import { KPI_WINDOW_DAYS, NO_VALUE, formatCurrency } from "../utils/dashboardMetrics";
import { toDayNumber, toIsoDate, todayDayNumber } from "../utils/rollingAverage";

export interface KpiBreakdownData {
  activity: DashboardActivity | null;
  shippedFeatures: readonly ShippedFeatureDay[];
  mergedPrs: readonly RecentMergedPr[];
  planCosts: readonly RecentPlanCost[];
  agentCosts: readonly AgentCostBreakdown[];
  /** Injected so the windows can be tested at a fixed date. */
  today?: number;
}

/** The rolling window every "recent" figure on this page uses, as the cards do. */
const WINDOW_DAYS = KPI_WINDOW_DAYS;

/** `KpiBreakdownSheet`'s own window for the average-cost-per-plan card. */
const PLAN_WINDOW_DAYS = 7;

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
const unclassifiedCost = (row: DashboardDailyCost): number =>
  Math.max(0, row.cost - row.apiCost - row.subsidizedCost);

/**
 * `KpiBreakdownSheet.FormatCost`: whole dollars once a figure passes $100, because the cents on a
 * projection are noise next to its error bars.
 */
const roundedCost = (value: number | null | undefined): string => {
  if (value == null) return NO_VALUE;
  return value >= 100 ? `$${Math.round(value).toLocaleString("en-US")}` : formatCurrency(value);
};

/** `FormatHelper.FormatPercent`: at most one decimal, so 38 reads as "38%" and not "38.0%". */
const percent = (value: number): string => `${Number(value.toFixed(1))}%`;

/** `FormatHelper.FormatCount`: thousands separators, which is how every count in V1 is written. */
const count = (value: number): string => value.toLocaleString("en-US");

/**
 * `KpiBreakdownSheet.CalculateDelta`. "N/A" when either side is missing, because a change from
 * nothing is not a percentage; two decimals below 10% where the digits still carry information.
 */
const delta = (current: number, previous: number): string => {
  if (previous <= 0 || current <= 0) return "N/A";
  const pct = ((current - previous) / previous) * 100;
  const magnitude =
    Math.abs(pct) >= 10
      ? String(Math.round(Math.abs(pct)))
      : String(Number(Math.abs(pct).toFixed(2)));
  return `${pct >= 0 ? "+" : "-"}${magnitude}%`;
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

const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Callout.Info title="No Data" className="m-4">
    {children}
  </Callout.Info>
);

/** A titled section, the shape `Layout.Vertical() | Text.H4(...) | table` renders as. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="border-t border-border">
    <h4 className="px-4 pt-4 text-sm font-semibold text-foreground">{title}</h4>
    {children}
  </section>
);

// --- Spend by Coding Agent ---------------------------------------------------

const agentCostColumns = (
  totalCost: number,
  totalTokens: number,
): DataTableColumn<AgentCostBreakdown>[] => [
  { name: "agent", header: "Coding Agent", accessor: (r) => r.agent },
  {
    name: "cost",
    header: "Spend",
    align: "Right",
    accessor: (r) => r.cost,
    cell: (value) => roundedCost(value as number),
  },
  {
    name: "costShare",
    header: "Spend Share",
    align: "Right",
    accessor: (r) => (totalCost > 0 ? (r.cost / totalCost) * 100 : null),
    cell: (value) => (value == null ? "N/A" : percent(value as number)),
  },
  {
    name: "tokens",
    header: "Tokens",
    align: "Right",
    accessor: (r) => r.tokens,
    cell: (value) => count(value as number),
  },
  {
    name: "tokenShare",
    header: "Token Share",
    align: "Right",
    accessor: (r) => (totalTokens > 0 ? (r.tokens / totalTokens) * 100 : null),
    cell: (value) => (value == null ? "N/A" : percent(value as number)),
  },
  { name: "planCount", header: "Plans", align: "Right", accessor: (r) => r.planCount },
];

/**
 * `KpiBreakdownSheet.BuildAgentBreakdownSection`: which agent the money went to, under every card
 * that reports money. V1 refetches it per window (30 days for the two spend cards, 7 for the plan
 * average); the analytics hook fetches one snapshot at the daemon's default window, so the heading
 * claims no window rather than a wrong one.
 */
const AgentBreakdown: React.FC<{ agentCosts: readonly AgentCostBreakdown[] }> = ({
  agentCosts,
}) => {
  if (agentCosts.length === 0) {
    return (
      <Section title="Spend by Coding Agent">
        <EmptyNote>No agent-attributed spend in this window.</EmptyNote>
      </Section>
    );
  }

  const totalCost = agentCosts.reduce((acc, a) => acc + a.cost, 0);
  const totalTokens = agentCosts.reduce((acc, a) => acc + a.tokens, 0);
  const unknownCost = agentCosts.find((a) => a.agent === "Unknown")?.cost ?? null;

  return (
    <Section title="Spend by Coding Agent">
      <DataTable
        columns={agentCostColumns(totalCost, totalTokens)}
        rows={[...agentCosts]}
        getRowId={(row) => row.agent}
        paginated={false}
      />
      {unknownCost != null && (
        <Callout.Info title="Partial Attribution" className="m-4">
          Rows predating agent capture appear as Unknown and cannot be attributed to a specific
          agent.
          {totalCost > 0 &&
            ` That is ${percent((unknownCost / totalCost) * 100)} of the spend in this window` +
              `${unknownCost >= totalCost - CENT ? ", so the split below it carries no information" : ""}.`}
        </Callout.Info>
      )}
    </Section>
  );
};

// --- featuresShipped ---------------------------------------------------------

const featureDayColumns: DataTableColumn<ShippedFeatureDay>[] = [
  { name: "date", header: "Date", width: "140px", accessor: (r) => r.date },
  {
    name: "count",
    header: "Features",
    align: "Right",
    accessor: (r) => r.count,
    cell: (value) => count(value as number),
  },
];

const mergedPrColumns: DataTableColumn<RecentMergedPr>[] = [
  { name: "planId", header: "Plan", width: "80px", accessor: (r) => r.planId },
  { name: "title", header: "Title", accessor: (r) => r.title, wrapText: true },
  {
    name: "repo",
    header: "Repo",
    accessor: (r) => r.repo,
    // A plan can have merged a PR without a Repos row, and an empty cell says so more honestly
    // than a guessed path would.
    cell: (value) => (typeof value === "string" && value !== "" ? value : NO_VALUE),
  },
  { name: "updated", header: "Merged", width: "170px", accessor: (r) => r.updated },
  {
    name: "prUrl",
    header: "PR URL",
    width: "60px",
    sortable: false,
    accessor: (r) => r.prUrl,
    cell: (value) =>
      typeof value === "string" ? (
        <a href={value} target="_blank" rel="noreferrer" className="text-xs underline">
          open
        </a>
      ) : null,
  },
];

// --- forecastMonth -----------------------------------------------------------

const dailyCostColumns: DataTableColumn<DashboardDailyCost>[] = [
  { name: "date", header: "Date", width: "110px", accessor: (r) => r.date },
  {
    name: "cost",
    header: "Total Spend",
    align: "Right",
    accessor: (r) => r.cost,
    cell: (value) => roundedCost(value as number),
  },
  {
    name: "apiCost",
    header: "API Spend",
    align: "Right",
    accessor: (r) => r.apiCost,
    cell: (value) => roundedCost(value as number),
  },
  {
    name: "subsidizedCost",
    header: "Subsidized Spend",
    align: "Right",
    accessor: (r) => r.subsidizedCost,
    cell: (value) => roundedCost(value as number),
  },
  {
    name: "tokens",
    header: "Total Tokens",
    align: "Right",
    // The greater of the two token counts, the guard V1 applies here: the rollup under-reports
    // whenever a row carried tokens it missed.
    accessor: (r) => Math.max(r.tokens, r.apiTokens + r.subsidizedTokens),
    cell: (value) => count(value as number),
  },
  {
    name: "subsidizedShare",
    header: "Subsidized %",
    align: "Right",
    accessor: (r) => {
      const total = Math.max(r.tokens, r.apiTokens + r.subsidizedTokens);
      if (total > 0) return (r.subsidizedTokens / total) * 100;
      return r.cost > 0 ? (r.subsidizedCost / r.cost) * 100 : 0;
    },
    cell: (value) => `${Math.round(value as number)}%`,
  },
];

// --- avgCostPlan -------------------------------------------------------------

const planCostColumns: DataTableColumn<RecentPlanCost>[] = [
  { name: "planId", header: "Plan", width: "80px", accessor: (r) => r.planId },
  { name: "title", header: "Title", accessor: (r) => r.title, wrapText: true },
  { name: "state", header: "State", width: "110px", accessor: (r) => r.state },
  { name: "created", header: "Created", width: "170px", accessor: (r) => r.created },
  {
    name: "tokens",
    header: "Tokens",
    align: "Right",
    accessor: (r) => r.tokens,
    cell: (value) => count(value as number),
  },
  {
    name: "cost",
    header: "Total Cost",
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
const TITLES: Record<KpiBreakdownId, string> = {
  featuresShipped: "Features Shipped",
  costPerFeature: "Avg Cost Per Feature",
  forecastMonth: "Forecast This Month",
  avgCostPlan: "Avg Cost/Plan",
};

/** The blade for one KPI, or `null` when the id is not one we drill into. */
export function buildKpiBlade(kpiId: string, data: KpiBreakdownData): BladeDescriptor | null {
  if (!isKpiBreakdownId(kpiId)) return null;
  const { activity, shippedFeatures, mergedPrs, planCosts, agentCosts } = data;
  const today = data.today ?? todayDayNumber();
  const { windowStart, priorStart, priorEnd } = windows(today);
  const blade = (subtitle: string, content: React.ReactNode): BladeDescriptor => ({
    id: kpiId,
    title: TITLES[kpiId],
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

      return blade("Merged PRs and solved issues behind the count", [
        <Callout.Info key="note" title="Output Metric" className="m-4">
          Features Shipped counts merged PRs and solved issues without a PR over the last{" "}
          {WINDOW_DAYS} days. A plan with three PRs counts three features; an issue-only plan counts
          one.
        </Callout.Info>,
        <Details key="details" className="px-4 pb-4">
          <DetailItem label="Metric">Features Shipped</DetailItem>
          <DetailItem label="Formula">
            Merged PRs + solved issues, last {WINDOW_DAYS} days
          </DetailItem>
          <DetailItem label={`Last ${WINDOW_DAYS} Days`}>{count(features)}</DetailItem>
          <DetailItem label={`Prior ${WINDOW_DAYS} Days`}>{count(priorFeatures)}</DetailItem>
          <DetailItem label={`${WINDOW_DAYS}-Day Period Delta`}>
            {delta(features, priorFeatures)}
          </DetailItem>
        </Details>,
        <Section key="days" title={`Features by Day (Last ${WINDOW_DAYS} Days)`}>
          {inWindow.length === 0 ? (
            <EmptyNote>No features shipped in the {WINDOW_DAYS}-day window.</EmptyNote>
          ) : (
            <DataTable
              columns={featureDayColumns}
              rows={inWindow}
              getRowId={(row) => row.date}
              defaultPageSize={25}
            />
          )}
        </Section>,
        <Section key="prs" title="Recent Merged Pull Requests">
          {mergedPrs.length === 0 ? (
            <EmptyNote>No merged pull requests recorded yet.</EmptyNote>
          ) : (
            <DataTable
              columns={mergedPrColumns}
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

      return blade("The two figures the quotient is taken from", [
        <Callout.Info key="note" title="Unit Cost" className="m-4">
          Avg Cost per Feature divides {WINDOW_DAYS}-day spend by {WINDOW_DAYS}-day features
          shipped, so the card shows the exact quotient of the two cards beside it.
        </Callout.Info>,
        <Details key="details" className="px-4 pb-4">
          <DetailItem label="Metric">Avg Cost per Feature</DetailItem>
          <DetailItem label="Formula">
            {WINDOW_DAYS}-day spend / {WINDOW_DAYS}-day features shipped
          </DetailItem>
          <DetailItem label={`Last ${WINDOW_DAYS} Days (Spend)`}>{cost(spend)}</DetailItem>
          <DetailItem label={`Last ${WINDOW_DAYS} Days (Features)`}>{count(features)}</DetailItem>
          <DetailItem label={`Last ${WINDOW_DAYS} Days (Cost/Feature)`}>
            {features > 0 ? cost(perFeature) : "n/a"}
          </DetailItem>
          <DetailItem label={`Prior ${WINDOW_DAYS} Days (Spend)`}>{cost(priorSpend)}</DetailItem>
          <DetailItem label={`Prior ${WINDOW_DAYS} Days (Features)`}>
            {count(priorFeatures)}
          </DetailItem>
          <DetailItem label={`Prior ${WINDOW_DAYS} Days (Cost/Feature)`}>
            {priorFeatures > 0 ? cost(priorPerFeature) : "n/a"}
          </DetailItem>
          <DetailItem label={`${WINDOW_DAYS}-Day Period Delta`}>
            {delta(perFeature, priorPerFeature)}
          </DetailItem>
        </Details>,
        <AgentBreakdown key="agents" agentCosts={agentCosts} />,
      ]);
    }

    case "forecastMonth": {
      if (activity == null) {
        return blade("Both projection bases, and the days behind them", [
          <EmptyNote key="empty">No activity on record.</EmptyNote>,
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

      return blade("Both projection bases, and the days behind them", [
        <Callout.Info key="note" title="Usage & Subsidized Analysis" className="m-4">
          {forecast.subsidizedTokenPercent > 0
            ? `Forecast This Month projects month-end spend using daily activity over the last ${WINDOW_DAYS} days. ${Math.round(forecast.subsidizedTokenPercent)}% of tokens in this window were subsidized via subscription (${roundedCost(forecast.totalSubsidizedSpend)} equivalent value) with ${roundedCost(forecast.totalApiSpend)} in direct API charges.`
            : `Forecast This Month projects month-end spend using daily activity over the last ${WINDOW_DAYS} days. Direct API projections estimate billed out-of-pocket spend, while total projections reflect overall token market value.`}
        </Callout.Info>,
        // Both bases side by side rather than one headline figure. Neither is right on its own: the
        // calendar basis assumes the idle days keep coming, the activity basis assumes every day is
        // a working day, and for bursty usage the gap between them *is* the uncertainty.
        <Details key="details" className="px-4 pb-4">
          <DetailItem label="Metric">Forecast This Month</DetailItem>
          <DetailItem label="Direct API Forecast (Calendar Basis)">
            {roundedCost(forecast.apiCalendarProjection)}
          </DetailItem>
          <DetailItem label="Direct API Forecast (Activity Basis)">
            {roundedCost(forecast.apiActivityProjection)}
          </DetailItem>
          <DetailItem label="Total Forecast (Calendar Basis)">
            {roundedCost(forecast.calendarProjection)}
          </DetailItem>
          <DetailItem label="Total Forecast (Activity Basis)">
            {roundedCost(forecast.activityProjection)}
          </DetailItem>
          <DetailItem label="Subsidized Token Share">
            {Math.round(forecast.subsidizedTokenPercent)}% of tokens
          </DetailItem>
          <DetailItem label="Subsidized Value Share">
            {Math.round(forecast.subsidizedCostPercent)}% of value
          </DetailItem>
          <DetailItem label="Month-to-Date Direct API Spend">{roundedCost(mtdApi)}</DetailItem>
          <DetailItem label="Month-to-Date Subsidized Value">
            {roundedCost(mtdSubsidized)}
          </DetailItem>
          {mtdUnclassified > CENT && (
            <DetailItem label="Month-to-Date Unattributed Spend">
              {roundedCost(mtdUnclassified)}
            </DetailItem>
          )}
          <DetailItem label="Month-to-Date Total Market Value">{roundedCost(mtdTotal)}</DetailItem>
          <DetailItem label="Calendar Days in Window">{forecast.calendarDays} day(s)</DetailItem>
          <DetailItem label="Active Days with Spend">{forecast.activityDays} day(s)</DetailItem>
          <DetailItem label="Days Remaining">{daysRemaining} day(s)</DetailItem>
          <DetailItem label="Days in Month">{forecast.daysInMonth} day(s)</DetailItem>
        </Details>,
        <Section key="daily" title={`Daily Spend (Last ${WINDOW_DAYS} Days)`}>
          {inWindow.length === 0 ? (
            <EmptyNote>No daily spend records found in the {WINDOW_DAYS}-day window.</EmptyNote>
          ) : (
            <>
              <DataTable
                columns={dailyCostColumns}
                rows={inWindow}
                getRowId={(row) => row.date}
                defaultPageSize={25}
              />
              {windowUnclassified > CENT && (
                <Callout.Info title="Incomplete Split" className="m-4">
                  {roundedCost(windowUnclassified)} of the spend in this window carries no cost
                  source, so it is in Total Spend but in neither the API nor the Subsidized column.
                  The two columns therefore under-report and must not be read as a complete split.
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

      return blade("Recent plans; a dash means the rows were never priced", [
        <Callout.Info key="note" title="7-Day Rolling Average" className="m-4">
          Average Cost per Plan calculates the mean execution and agent spend for plans created
          in the last {PLAN_WINDOW_DAYS} days that reached Completed, Failed, or Review state.
          Unpriced plans (e.g. subscription runs where cost is null) are excluded from the divisor
          so they do not artificially deflate the average.
        </Callout.Info>,
        <Details key="details" className="px-4 pb-4">
          <DetailItem label="Metric">Average Cost per Plan</DetailItem>
          <DetailItem label="Window">
            {PLAN_WINDOW_DAYS} days (plans created in last {PLAN_WINDOW_DAYS} days)
          </DetailItem>
          <DetailItem label="Plan States Included">Completed, Failed, Review</DetailItem>
          <DetailItem label={`Current ${PLAN_WINDOW_DAYS}-Day Average`}>
            {priced.length > 0 ? cost(currentAvg) : NO_VALUE}
          </DetailItem>
          <DetailItem label={`Prior ${PLAN_WINDOW_DAYS}-Day Average (Days 8-14)`}>
            {priorAvg > 0 ? cost(priorAvg) : NO_VALUE}
          </DetailItem>
          <DetailItem label={`${PLAN_WINDOW_DAYS}-Day Period Delta`}>
            {delta(currentAvg, priorAvg)}
          </DetailItem>
        </Details>,
        <Section key="plans" title={`Plans in Rolling Window (Last ${PLAN_WINDOW_DAYS} Days)`}>
          {planCosts.length === 0 ? (
            <EmptyNote>No plans created in the {PLAN_WINDOW_DAYS}-day rolling window.</EmptyNote>
          ) : (
            <DataTable
              columns={planCostColumns}
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
