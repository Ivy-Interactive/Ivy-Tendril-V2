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

/** The five analytics KPI cards, which are buttons; the fallback ones are plain divs. */
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
  it("renders the five analytics KPIs from the bridge", async () => {
    mockAnalytics(activity());
    renderDashboard();

    await waitFor(() => expect(kpiButtons()).toHaveLength(5));
    for (const label of [
      "Features Shipped",
      "Avg Cost / Feature",
      "Forecast This Month",
      "Avg Cost / Plan",
      "Tokens Consumed",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
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

  it("falls back to the in-memory KPIs when the analytics fetch rejects", async () => {
    mockAnalytics(null);
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Active Plans")).toBeInTheDocument());
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    // Nothing is clickable while there is no data to drill into.
    expect(kpiButtons()).toHaveLength(0);
  });

  it("feeds the trend, activity and pull-request panels", async () => {
    mockAnalytics(activity());
    const { container } = renderDashboard();

    // The trend block is skipped entirely when `trend` is null, so its presence is the assertion.
    await waitFor(() => expect(container.querySelector(".tdb-trend")).not.toBeNull());
    expect(screen.getAllByText("Sep").length).toBeGreaterThan(0);
    // ActivityGrid and PillBars render one column/bar per month, and their empty state renders
    // neither — so counting the nodes distinguishes "fed" from "defaulted".
    expect(container.querySelectorAll(".tdb-activity-col")).toHaveLength(2);
    expect(container.querySelectorAll(".tdb-bar-item")).toHaveLength(2);
    expect(screen.queryByText("No merged pull requests yet")).not.toBeInTheDocument();
  });
});
