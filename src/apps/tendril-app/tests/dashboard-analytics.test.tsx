import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DashboardView } from "../src/views/DashboardView";
import { bridge } from "../src/api/bridge";
import { toIsoDate, todayDayNumber } from "../src/utils/rollingAverage";
import type {
  AgentCostBreakdown,
  DashboardActivity,
  DashboardDailyCost,
  RecentMergedPr,
  RecentPlanCost,
  ShippedFeatureDay,
} from "../src/types/api";

/**
 * Dates are generated relative to today rather than hard-coded, because the KPIs are windowed on the
 * real clock: a fixture pinned to a literal date would pass this month and silently stop counting
 * the next one.
 */
const TODAY = todayDayNumber();
const dayAgo = (days: number): string => toIsoDate(TODAY - days);

const dailyCost = (
  overrides: Partial<DashboardDailyCost> & { date: string },
): DashboardDailyCost => ({
  cost: 0,
  tokens: 0,
  apiCost: 0,
  apiTokens: 0,
  subsidizedCost: 0,
  subsidizedTokens: 0,
  ...overrides,
});

const activity = (overrides: Partial<DashboardActivity> = {}): DashboardActivity => ({
  months: [
    { year: 2026, month: 8, plansCreated: 4, prsMerged: 2, cost: 12.5, tokens: 400_000 },
    { year: 2026, month: 9, plansCreated: 6, prsMerged: 3, cost: 20, tokens: 900_000 },
  ],
  prevWeekAvgCost: 2,
  dailyCosts: [
    dailyCost({ date: dayAgo(3), cost: 8, tokens: 500_000, apiCost: 8, apiTokens: 500_000 }),
    dailyCost({ date: dayAgo(1), cost: 12, tokens: 400_000, apiCost: 12, apiTokens: 400_000 }),
  ],
  dailyPlans: [
    { date: dayAgo(3), count: 2 },
    { date: dayAgo(1), count: 4 },
  ],
  dailyDataStart: dayAgo(3),
  forecast: {
    calendarProjection: 100,
    calendarDays: 4,
    activityProjection: 200,
    activityDays: 2,
    totalSpend: 20,
    daysInMonth: 30,
    apiCalendarProjection: 100,
    apiActivityProjection: 200,
    totalApiSpend: 20,
    totalSubsidizedSpend: 0,
    totalApiTokens: 900_000,
    totalSubsidizedTokens: 0,
    subsidizedTokenPercent: 0,
    subsidizedCostPercent: 0,
  },
  ...overrides,
});

const SHIPPED: ShippedFeatureDay[] = [
  { date: dayAgo(2), count: 3 },
  { date: dayAgo(40), count: 1 },
];

const MERGED_PRS: RecentMergedPr[] = [
  {
    prUrl: "https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/7",
    planId: 611,
    title: "Port the Pull Requests dashboard view",
    repo: "/Users/rorychatt/git/Ivy-Tendril-V2",
    updated: `${dayAgo(2)} 09:12:00`,
  },
];

const PLAN_COSTS: RecentPlanCost[] = [
  {
    planId: 630,
    title: "Repair corrupt plan YAML",
    state: "Completed",
    created: `${dayAgo(1)} 08:00:00`,
    cost: 4,
    tokens: 120_000,
  },
  {
    // A plan whose rows carried tokens without ever being priced.
    planId: 631,
    title: "Port projects plans reference",
    state: "Review",
    created: `${dayAgo(1)} 11:00:00`,
    cost: null,
    tokens: 90_000,
  },
];

const AGENT_COSTS: AgentCostBreakdown[] = [
  { agent: "claude-opus-5", cost: 18, tokens: 800_000, planCount: 3 },
  { agent: "Unknown", cost: 2, tokens: 100_000, planCount: 1 },
];

/** Stubs all five analytics calls. Pass `null` for `data` to make every one of them reject. */
const mockAnalytics = (data: DashboardActivity | null) => {
  if (data == null) {
    const fail = () => Promise.reject(new Error("daemon unavailable"));
    vi.spyOn(bridge, "getDashboardActivity").mockImplementation(fail);
    vi.spyOn(bridge, "getShippedFeatures").mockImplementation(fail);
    vi.spyOn(bridge, "getAgentCostBreakdown").mockImplementation(fail);
    vi.spyOn(bridge, "getRecentPlanCosts").mockImplementation(fail);
    vi.spyOn(bridge, "getRecentMergedPrs").mockImplementation(fail);
    return;
  }
  vi.spyOn(bridge, "getDashboardActivity").mockResolvedValue(data);
  vi.spyOn(bridge, "getShippedFeatures").mockResolvedValue(SHIPPED);
  vi.spyOn(bridge, "getAgentCostBreakdown").mockResolvedValue(AGENT_COSTS);
  vi.spyOn(bridge, "getRecentPlanCosts").mockResolvedValue(PLAN_COSTS);
  vi.spyOn(bridge, "getRecentMergedPrs").mockResolvedValue(MERGED_PRS);
};

const renderDashboard = () => render(<DashboardView plans={[]} jobs={[]} />);

/** The four analytics KPI cards, which are buttons; the fallback ones are plain divs. */
const kpiButtons = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".tdb-kpi[data-clickable='true']"));

const clickKpi = async (label: string) => {
  const card = await waitFor(() => {
    const found = kpiButtons().find((button) => button.textContent?.includes(label));
    expect(found, `KPI card '${label}' should be rendered`).toBeDefined();
    return found!;
  });
  fireEvent.click(card);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardView analytics", () => {
  it("renders the four analytics KPIs from the bridge", async () => {
    mockAnalytics(activity());
    renderDashboard();

    // Four cards, in this order: `DashboardApp.BuildKpis` emits exactly these, its fourth being the
    // permanent Avg Cost/Plan fallback for the agent usage window V2 has no service for.
    await waitFor(() => expect(kpiButtons()).toHaveLength(4));
    for (const label of [
      "Features Shipped",
      "Avg Cost / Feature",
      "Forecast This Month",
      "Avg Cost / Plan",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText("Tokens Consumed")).not.toBeInTheDocument();
    // 3 features over 30 days, and $20 of spend over them.
    const features = kpiButtons().find((b) => b.textContent?.includes("Features Shipped"));
    expect(features?.querySelector(".tdb-kpi-value")?.textContent).toBe("3");
    expect(screen.getByText("$6.67")).toBeInTheDocument();
    // Both projection bases are reported, never one picked.
    expect(screen.getByText("$100.00 – $200.00")).toBeInTheDocument();
  });

  it("shows the hint instead of a figure when a KPI has no basis", async () => {
    mockAnalytics(activity({ dailyCosts: [], dailyDataStart: null }));
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Avg Cost / Feature")).toBeInTheDocument());
    // No spend at all: cost per feature is unknown, not zero.
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText("no priced spend in 30 days")).toBeInTheDocument();
  });

  it("opens the matching drill-down when a KPI is clicked", async () => {
    mockAnalytics(activity());
    renderDashboard();

    await clickKpi("Features Shipped");

    const panel = screen.getByTestId("kpi-breakdown");
    expect(panel).toBeInTheDocument();
    // The blade lists the merged PRs behind the count.
    expect(screen.getByText("Port the Pull Requests dashboard view")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "open" })).toHaveAttribute("href", MERGED_PRS[0].prUrl);

    fireEvent.click(screen.getByRole("button", { name: "Close breakdown" }));
    expect(screen.queryByTestId("kpi-breakdown")).not.toBeInTheDocument();
  });

  it("renders an unpriced plan cost as a dash, never $0.00", async () => {
    mockAnalytics(activity());
    renderDashboard();

    await clickKpi("Avg Cost / Plan");

    expect(screen.getByText("Repair corrupt plan YAML")).toBeInTheDocument();
    expect(screen.getByText("Port projects plans reference")).toBeInTheDocument();
    const panel = screen.getByTestId("kpi-breakdown");
    expect(panel.textContent).toContain("—");
    expect(panel.textContent).not.toContain("$0.00");
  });

  it("keeps the four cards, valueless, when the analytics fetch rejects", async () => {
    mockAnalytics(null);
    renderDashboard();

    // V1 states an unknown figure as a dash or "n/a" with a hint saying why, and never changes
    // which cards the dashboard has (`DashboardApp.BuildKpis`).
    await waitFor(() => expect(screen.getByText("Features shipped")).toBeInTheDocument());
    expect(screen.getByText("Forecast This Month")).toBeInTheDocument();
    expect(screen.getByText("No cost data in the last 30 days")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    // Nothing is clickable while there is no data to drill into.
    expect(kpiButtons()).toHaveLength(0);
  });

  it("puts the per-agent split under every card that reports money", async () => {
    // `KpiBreakdownSheet` appends BuildAgentBreakdownSection to the cost-per-feature, forecast and
    // avg-cost-per-plan sheets, and flags the unattributable rows.
    mockAnalytics(activity());
    renderDashboard();

    await clickKpi("Forecast This Month");

    const panel = screen.getByTestId("kpi-breakdown");
    expect(screen.getByText("Spend by Coding Agent")).toBeInTheDocument();
    expect(screen.getByText("claude-opus-5")).toBeInTheDocument();
    expect(panel.textContent).toContain("Partial Attribution");
    // Both projection bases are reported here too, never one picked.
    expect(screen.getByText("Total Forecast (Calendar Basis)")).toBeInTheDocument();
    expect(screen.getByText("Total Forecast (Activity Basis)")).toBeInTheDocument();
  });

  it("shows the quotient's two halves on the cost-per-feature panel", async () => {
    mockAnalytics(activity());
    renderDashboard();

    await clickKpi("Avg Cost / Feature");

    expect(screen.getByText("30-day spend / 30-day features shipped")).toBeInTheDocument();
    expect(screen.getByText("Last 30 Days (Features)")).toBeInTheDocument();
    expect(screen.getByText("Spend by Coding Agent")).toBeInTheDocument();
  });

  it("feeds the trend, activity and pull-request panels", async () => {
    mockAnalytics(activity());
    const { container } = renderDashboard();

    // The trend block is skipped entirely when `trend` is null, so its presence is the assertion.
    await waitFor(() => expect(container.querySelector(".tdb-trend")).not.toBeNull());
    // The trend axis is daily now ("Sep 12"), so a bare month label can only come from the
    // activity grid and the PR bars.
    expect(screen.getAllByText("Sep").length).toBeGreaterThan(0);
    // V1's rolling-average curve, not a previous-year comparison line.
    expect(screen.getByText("7-day average")).toBeInTheDocument();
    expect(container.querySelector(".tdb-trend-compare")).toBeNull();
    // ActivityGrid and PillBars render one column/bar per month, and their empty state renders
    // neither — so counting the nodes distinguishes "fed" from "defaulted".
    expect(container.querySelectorAll(".tdb-activity-col")).toHaveLength(2);
    expect(container.querySelectorAll(".tdb-bar-item")).toHaveLength(2);
    expect(screen.queryByText("No merged pull requests yet")).not.toBeInTheDocument();
  });

  /**
   * The un-ported cost backfills.
   *
   * `get_activity_stats` splits daily spend on `CostSource`, counting only `'agent'`/`'computed'` as
   * API and `'estimated'` as subsidised, with a `Cost > 0` heuristic for `NULL`. A row written before
   * the column existed holds the *empty string*, which matches none of those branches — so it is in
   * `cost` and in neither half, and both columns silently under-report. These cases pin that the
   * panels say so rather than presenting an incomplete split as a complete one.
   */
  describe("unattributed spend", () => {
    const historical = activity({
      dailyCosts: [
        // $30 recorded, $10 attributed: the $20 remainder is what an un-backfilled CostSource costs
        // the report.
        dailyCost({
          date: dayAgo(1),
          cost: 30,
          tokens: 900_000,
          apiCost: 10,
          apiTokens: 300_000,
        }),
      ],
    });

    it("states the remainder under the daily spend table", async () => {
      mockAnalytics(historical);
      renderDashboard();

      await clickKpi("Forecast This Month");

      const panel = screen.getByTestId("kpi-breakdown");
      expect(panel.textContent).toContain("Incomplete Split");
      expect(panel.textContent).toContain("$20.00");
    });

    it("reports it as its own month-to-date figure", async () => {
      mockAnalytics(historical);
      renderDashboard();

      await clickKpi("Forecast This Month");

      expect(screen.getByText("Month-to-Date Unattributed Spend")).toBeInTheDocument();
    });

    it("says nothing when the split does add up", async () => {
      mockAnalytics(activity());
      renderDashboard();

      await clickKpi("Forecast This Month");

      const panel = screen.getByTestId("kpi-breakdown");
      expect(panel.textContent).not.toContain("Incomplete Split");
      expect(screen.queryByText("Month-to-Date Unattributed Spend")).not.toBeInTheDocument();
    });

    it("names the share the Unknown agent accounts for", async () => {
      mockAnalytics(activity());
      renderDashboard();

      await clickKpi("Forecast This Month");

      // $2 of $20 in AGENT_COSTS. V1's `BuildAgentBreakdownSection` flags the presence of Unknown;
      // saying how much of the spend it is turns the flag into something actionable.
      const panel = screen.getByTestId("kpi-breakdown");
      expect(panel.textContent).toContain("Partial Attribution");
      expect(panel.textContent).toContain("10% of the spend in this window");
    });
  });
});
