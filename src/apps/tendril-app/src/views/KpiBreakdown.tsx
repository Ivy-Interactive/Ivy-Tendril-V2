/**
 * KPI drill-down panels, one per clickable dashboard card.
 *
 * The original opened a right-hand sheet (`KpiBreakdownSheet`). This uses the blade stack from
 * plan 00548, which is the host the plan's `kpi-drilldown-host` question recommends and the
 * master → detail idiom the rest of the port is moving to.
 *
 * The one rule every panel obeys: an unpriced cost renders as an em dash, never `$0.00`. The
 * `Option<f64>` the query returns means "these rows carried tokens without a charge", and if that
 * distinction dies at the last render then the whole `PricedRows` guard behind it was pointless.
 */

import type React from "react";
import { DataTable, type DataTableColumn } from "@ivy-interactive/components/ui";
import type { BladeDescriptor } from "@ivy-interactive/components/ui";
import type {
  AgentCostBreakdown,
  DashboardActivity,
  DashboardDailyCost,
  DashboardMonthStats,
  RecentMergedPr,
  RecentPlanCost,
} from "../types/api";
import { NO_VALUE, formatCurrency, formatTokens } from "../utils/dashboardMetrics";
import { ROLLING_WINDOW_DAYS, rollingAverage } from "../utils/rollingAverage";

export interface KpiBreakdownData {
  activity: DashboardActivity | null;
  mergedPrs: readonly RecentMergedPr[];
  planCosts: readonly RecentPlanCost[];
  agentCosts: readonly AgentCostBreakdown[];
}

/** An amount that may not exist. `null` is unknown and renders as a dash. */
const cost = (value: number | null | undefined): string =>
  value == null ? NO_VALUE : formatCurrency(value);

const percent = (value: number): string => `${value.toFixed(1)}%`;

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthName = (month: DashboardMonthStats): string =>
  `${MONTH_LABELS[month.month - 1] ?? month.month} ${month.year}`;

const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="p-4 text-xs text-muted-foreground">{children}</p>
);

// --- featuresShipped ---------------------------------------------------------

const mergedPrColumns: DataTableColumn<RecentMergedPr>[] = [
  { name: "planId", header: "Plan", width: "80px", accessor: (r) => r.planId },
  { name: "title", header: "Title", accessor: (r) => r.title, wrapText: true },
  {
    name: "repo",
    header: "Repository",
    accessor: (r) => r.repo,
    // A plan can have merged a PR without a Repos row, and an empty cell says so more honestly
    // than a guessed path would.
    cell: (value) => (typeof value === "string" && value !== "" ? value : NO_VALUE),
  },
  { name: "updated", header: "Merged", width: "170px", accessor: (r) => r.updated },
  {
    name: "prUrl",
    header: "",
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

// --- costPerFeature ----------------------------------------------------------

const dailyCostColumns: DataTableColumn<DashboardDailyCost>[] = [
  { name: "date", header: "Date", width: "110px", accessor: (r) => r.date },
  {
    name: "cost",
    header: "Total spend",
    align: "Right",
    accessor: (r) => r.cost,
    cell: (value) => cost(value as number),
  },
  {
    name: "apiCost",
    header: "API spend",
    align: "Right",
    accessor: (r) => r.apiCost,
    cell: (value) => cost(value as number),
  },
  {
    name: "subsidizedCost",
    header: "Subsidized",
    align: "Right",
    accessor: (r) => r.subsidizedCost,
    cell: (value) => cost(value as number),
  },
  {
    name: "tokens",
    header: "Tokens",
    align: "Right",
    accessor: (r) => r.tokens,
    cell: (value) => formatTokens(value as number),
  },
  {
    name: "subsidizedShare",
    header: "Subsidized %",
    align: "Right",
    // Computed from the greater of the two token counts, the same guard the forecast uses: the
    // total column under-reports whenever a row carried tokens the rollup missed.
    accessor: (r) => {
      const total = Math.max(r.tokens, r.apiTokens + r.subsidizedTokens);
      return total > 0 ? (r.subsidizedTokens / total) * 100 : 0;
    },
    cell: (value) => percent(value as number),
  },
];

/**
 * The daily columns plus the trailing 7-day mean of `cost` for each day.
 *
 * The average is a function of the whole series and of `dailyDataStart`, so the columns are built
 * per-activity rather than declared once. It lives here rather than on the trend chart because the
 * chart plots monthly totals against the same months a year earlier, and a daily mean drawn on that
 * axis would sit on the floor — the smoothing only says anything next to the days it smooths.
 *
 * A day before the first record has no average, which is what `dailyDataStart` gates, and renders as
 * a dash under the same rule the cost columns follow: a figure we do not have is never a zero.
 */
const buildDailyCostColumns = (
  activity: DashboardActivity,
): DataTableColumn<DashboardDailyCost>[] => {
  const costByDate = new Map(activity.dailyCosts.map((day) => [day.date, day.cost]));
  const dates = activity.dailyCosts.map((day) => day.date);
  const averages = rollingAverage(
    dates,
    // Zero-filled: a recorded day with no spend contributes 0 to the mean, which is a different
    // thing from a day outside the recorded range contributing nothing at all.
    (isoDate) => costByDate.get(isoDate) ?? 0,
    activity.dailyDataStart,
  );
  const averageByDate = new Map(dates.map((date, index) => [date, averages[index]]));

  return [
    ...dailyCostColumns,
    {
      name: "rollingCost",
      header: `${ROLLING_WINDOW_DAYS}-day avg`,
      align: "Right",
      accessor: (r) => averageByDate.get(r.date) ?? null,
      cell: (value) => cost(value as number | null),
    },
  ];
};

// --- forecastMonth -----------------------------------------------------------

const monthColumns: DataTableColumn<DashboardMonthStats>[] = [
  { name: "month", header: "Month", width: "150px", accessor: monthName },
  {
    name: "cost",
    header: "Spend",
    align: "Right",
    accessor: (r) => r.cost,
    cell: (value) => cost(value as number),
  },
  {
    name: "tokens",
    header: "Tokens",
    align: "Right",
    accessor: (r) => r.tokens,
    cell: (value) => formatTokens(value as number),
  },
  {
    name: "plansCreated",
    header: "Plans created",
    align: "Right",
    accessor: (r) => r.plansCreated,
  },
  { name: "prsMerged", header: "PRs merged", align: "Right", accessor: (r) => r.prsMerged },
];

/**
 * Both bases side by side rather than one headline figure. Neither is right on its own: the calendar
 * basis assumes the idle days keep coming, the activity basis assumes every day is a working day,
 * and for bursty usage the gap between them *is* the uncertainty.
 */
const ForecastBases: React.FC<{ activity: DashboardActivity }> = ({ activity }) => {
  const { forecast } = activity;
  return (
    <dl className="grid grid-cols-2 gap-4 border-b border-border p-4 text-xs">
      <div>
        <dt className="text-muted-foreground">Calendar basis (lower)</dt>
        <dd className="text-base font-semibold">{cost(forecast.calendarProjection)}</dd>
        <dd className="text-muted-foreground">
          {cost(forecast.totalSpend)} over {forecast.calendarDays} days on record
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Activity basis (upper)</dt>
        <dd className="text-base font-semibold">{cost(forecast.activityProjection)}</dd>
        <dd className="text-muted-foreground">
          {cost(forecast.totalSpend)} over {forecast.activityDays} days with spend
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">API spend</dt>
        <dd>
          {cost(forecast.totalApiSpend)} · {formatTokens(forecast.totalApiTokens)} tokens
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Subsidized</dt>
        <dd>
          {cost(forecast.totalSubsidizedSpend)} · {formatTokens(forecast.totalSubsidizedTokens)}{" "}
          tokens ({percent(forecast.subsidizedTokenPercent)})
        </dd>
      </div>
    </dl>
  );
};

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
    cell: (value) => formatTokens(value as number),
  },
  {
    name: "cost",
    header: "Cost",
    align: "Right",
    accessor: (r) => r.cost,
    // The whole point of the null: a plan whose rows carried tokens without a charge cost an
    // unknown amount, not nothing.
    cell: (value) => cost(value as number | null),
  },
];

// --- tokensConsumed ---------------------------------------------------------

const agentCostColumns: DataTableColumn<AgentCostBreakdown>[] = [
  { name: "agent", header: "Agent", accessor: (r) => r.agent },
  {
    name: "cost",
    header: "Cost",
    align: "Right",
    accessor: (r) => r.cost,
    cell: (value) => cost(value as number),
  },
  {
    name: "tokens",
    header: "Tokens",
    align: "Right",
    accessor: (r) => r.tokens,
    cell: (value) => formatTokens(value as number),
  },
  { name: "planCount", header: "Plans", align: "Right", accessor: (r) => r.planCount },
];

// --- panels ------------------------------------------------------------------

/** Every KPI id that opens a panel. */
export const KPI_BREAKDOWN_IDS = [
  "featuresShipped",
  "costPerFeature",
  "forecastMonth",
  "avgCostPlan",
  "tokensConsumed",
] as const;

export type KpiBreakdownId = (typeof KPI_BREAKDOWN_IDS)[number];

export const isKpiBreakdownId = (value: string): value is KpiBreakdownId =>
  (KPI_BREAKDOWN_IDS as readonly string[]).includes(value);

/**
 * The blade for one KPI, or `null` when the id is not one we drill into.
 *
 * `tokensConsumed` opens the per-agent breakdown: the plan tabulates that panel under the id
 * `agentCosts`, but there is no `agentCosts` card to click, and "which agent spent the tokens" is
 * exactly the question the tokens card raises.
 */
export function buildKpiBlade(kpiId: string, data: KpiBreakdownData): BladeDescriptor | null {
  if (!isKpiBreakdownId(kpiId)) return null;
  const { activity, mergedPrs, planCosts, agentCosts } = data;

  switch (kpiId) {
    case "featuresShipped":
      return {
        id: kpiId,
        title: "Features Shipped",
        subtitle: "Merged pull requests, most recently updated first",
        width: "lg",
        content:
          mergedPrs.length === 0 ? (
            <EmptyNote>No merged pull requests on record.</EmptyNote>
          ) : (
            <DataTable
              columns={mergedPrColumns}
              rows={[...mergedPrs]}
              getRowId={(row) => row.prUrl}
              defaultPageSize={25}
            />
          ),
      };

    case "costPerFeature":
      return {
        id: kpiId,
        title: "Avg Cost / Feature",
        subtitle: "Daily spend, split by cost source",
        width: "lg",
        content:
          activity == null || activity.dailyCosts.length === 0 ? (
            <EmptyNote>No spend on record.</EmptyNote>
          ) : (
            <DataTable
              columns={buildDailyCostColumns(activity)}
              rows={[...activity.dailyCosts].reverse()}
              getRowId={(row) => row.date}
              defaultPageSize={25}
            />
          ),
      };

    case "forecastMonth":
      return {
        id: kpiId,
        title: "Forecast This Month",
        subtitle: "Both projection bases, and the months behind them",
        width: "lg",
        content:
          activity == null ? (
            <EmptyNote>No activity on record.</EmptyNote>
          ) : (
            <div>
              <ForecastBases activity={activity} />
              <DataTable
                columns={monthColumns}
                rows={[...activity.months].reverse()}
                getRowId={(row) => `${row.year}-${row.month}`}
                defaultPageSize={25}
              />
            </div>
          ),
      };

    case "avgCostPlan":
      return {
        id: kpiId,
        title: "Avg Cost / Plan",
        subtitle: "Recent plans; a dash means the rows were never priced",
        width: "lg",
        content:
          planCosts.length === 0 ? (
            <EmptyNote>No plans on record for this window.</EmptyNote>
          ) : (
            <DataTable
              columns={planCostColumns}
              rows={[...planCosts]}
              getRowId={(row) => String(row.planId)}
              defaultPageSize={25}
            />
          ),
      };

    case "tokensConsumed":
      return {
        id: kpiId,
        title: "Tokens Consumed",
        subtitle: "By agent, most expensive first",
        width: "md",
        content:
          agentCosts.length === 0 ? (
            <EmptyNote>No agent costs on record.</EmptyNote>
          ) : (
            <DataTable
              columns={agentCostColumns}
              rows={[...agentCosts]}
              getRowId={(row) => row.agent}
              paginated={false}
            />
          ),
      };
  }
}
