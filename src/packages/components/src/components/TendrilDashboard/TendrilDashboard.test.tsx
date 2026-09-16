import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import userEvent from "@testing-library/user-event";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TendrilDashboard } from "./TendrilDashboard.tsx";
import type { DashboardMonthValueDto, DashboardTrendDto } from "./types.ts";

const PLOT_LEFT = 44;
const PLOT_WIDTH = 548;
const CHART_WIDTH = PLOT_LEFT + PLOT_WIDTH + 8;

/** `count` ascending days ending on 2026-09-06. */
const days = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 6));
    date.setUTCDate(date.getUTCDate() - (count - 1 - i));
    return date.toISOString().slice(0, 10);
  });

/**
 * A trend payload whose cost and plan figures are far enough apart that a tooltip proves which
 * series and which unit the chart picked up.
 */
const trendOf = (
  count: number,
  cost: number,
  plans: number,
  rollingKnown = true,
): DashboardTrendDto => {
  const dates = days(count);
  return {
    dates,
    cost: dates.map(() => cost),
    plans: dates.map(() => plans),
    rollingCost: dates.map((_, i) => (rollingKnown && i >= 6 ? cost : null)),
    rollingPlans: dates.map((_, i) => (rollingKnown && i >= 6 ? plans : null)),
  };
};

const renderDashboard = (
  trend: DashboardTrendDto | null,
  trendWeekly: DashboardTrendDto | null = null,
) =>
  render(
    <TendrilDashboard id="dash" eventHandler={vi.fn()} trend={trend} trendWeekly={trendWeekly} />,
  );

/** The chart's own svg, not the first one in the tree: every status icon is an svg too. */
const hoverLastPoint = (container: HTMLElement) =>
  fireEvent.mouseMove(container.querySelector(".tdb-chart-wrap svg")!, {
    clientX: PLOT_LEFT + PLOT_WIDTH,
    clientY: 100,
  });

describe("TendrilDashboard trend legend", () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = vi.fn(
      () =>
        ({
          width: CHART_WIDTH,
          height: 236,
          top: 0,
          left: 0,
          right: CHART_WIDTH,
          bottom: 236,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof ResizeObserver;
  });

  it("names the rolling average and omits the comparison series", () => {
    renderDashboard(trendOf(30, 100, 4));

    expect(screen.getByText("7-day average")).toBeInTheDocument();
    expect(screen.getByText("Last 4 weeks")).toBeInTheDocument();
    expect(screen.queryByText("Previous 4 weeks")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Avg /)).not.toBeInTheDocument();
  });

  it("renders the 7-day average legend item and curve", () => {
    const { container } = renderDashboard(trendOf(30, 100, 4));

    expect(screen.getByText("7-day average")).toBeInTheDocument();
    expect(container.querySelectorAll(".tdb-trend-avg-curve")).toHaveLength(1);
  });
});

describe("TendrilDashboard range and metric combinations", () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = vi.fn(
      () =>
        ({
          width: CHART_WIDTH,
          height: 236,
          top: 0,
          left: 0,
          right: CHART_WIDTH,
          bottom: 236,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof ResizeObserver;
  });

  // Monthly and weekly carry different figures: activeTrend standardizes on weekly when available, or trend.
  const monthly = trendOf(365, 120, 6);
  const weekly = trendOf(28, 45, 4);

  it("shows the 4 week cost series in dollars by default", () => {
    const { container } = renderDashboard(monthly, weekly);

    hoverLastPoint(container);

    expect(screen.getByText("Last 4 weeks: $45.00")).toBeInTheDocument();
    expect(screen.getByText("7-day average: $45.00")).toBeInTheDocument();
    expect(screen.queryByText("Previous 4 weeks: $22.50")).not.toBeInTheDocument();
  });

  it("shows the 4 week plan series counted in plans", () => {
    const { container } = renderDashboard(monthly, weekly);

    fireEvent.click(screen.getByText("Total Plans"));
    hoverLastPoint(container);

    expect(screen.getByText("Last 4 weeks: 4 plans")).toBeInTheDocument();
    expect(screen.getByText("7-day average: 4 plans")).toBeInTheDocument();
    expect(screen.queryByText("Previous 4 weeks: 2 plans")).not.toBeInTheDocument();
  });

  it("falls back to monthly trend if weekly trend is not provided", () => {
    const { container } = renderDashboard(monthly, null);

    hoverLastPoint(container);

    expect(screen.getByText("Last 4 weeks: $120.00")).toBeInTheDocument();
    expect(screen.getByText("7-day average: $120.00")).toBeInTheDocument();
    expect(screen.queryByText("Previous 4 weeks: $60.00")).not.toBeInTheDocument();
  });

  it("hides the trend card entirely when there is no series", () => {
    const { container } = renderDashboard(null);

    expect(container.querySelector(".tdb-trend")).not.toBeInTheDocument();
    expect(screen.queryByText("7-day average")).not.toBeInTheDocument();
  });
});

describe("TendrilDashboard git activity and pull requests side cards", () => {
  it("renders Git Activity and Pull Requests as two separate cards, not as tabs", () => {
    const { container } = render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        activity={[{ label: "Jan", weeks: [1] }]}
        pullRequests={[{ label: "Jan", value: 3 }]}
      />,
    );

    const sideBlocks = container.querySelectorAll(".tdb-col-side .tdb-side-block");
    const titles = Array.from(sideBlocks).map(
      (block) => block.querySelector(".tdb-block-title")?.textContent,
    );
    expect(titles).toContain("Git Activity");
    expect(titles).toContain("Pull Requests");

    expect(screen.queryByRole("button", { name: "Git Activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pull Requests" })).not.toBeInTheDocument();
  });

  it("shows both the activity grid and the pull requests list at the same time", () => {
    const { container } = render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        activity={[{ label: "Jan", weeks: [1] }]}
        pullRequests={[{ label: "Jan", value: 3 }]}
        // The card opens on its Week range, so the weekly series is the one that has to be fed for
        // the bars to be on screen at all.
        pullRequestsWeekly={[{ label: "Jan 5", value: 3 }]}
      />,
    );

    expect(container.querySelector(".tdb-activity-col")).toBeInTheDocument();
    expect(container.querySelector(".tdb-bars")).toBeInTheDocument();
  });
});

describe("TendrilDashboard KPI card interactions and accessibility", () => {
  const kpis = [
    { id: "featuresShipped", label: "Features shipped", value: "128", delta: "+10%" },
    { id: "costPerFeature", label: "Avg cost per Feature", value: "$3.84" },
    { id: "forecastMonth", label: "Forecast This Month", value: "$600" },
    { id: "avgCostPlan", label: "Avg Cost/Plan", value: "$24.50" },
  ];

  it("renders every identified KPI as a focusable control naming its breakdown", () => {
    render(
      <TendrilDashboard id="dash" eventHandler={vi.fn()} events={["OnSelectKpi"]} kpis={kpis} />,
    );

    const kpiButtons = screen.getAllByRole("button").filter((b) => b.classList.contains("tdb-kpi"));
    expect(kpiButtons).toHaveLength(4);

    kpiButtons.forEach((btn, idx) => {
      // A real <button> is focusable and Enter/Space-activated by the platform, so V1's explicit
      // tabindex and key handlers are unnecessary here; the accessible name is still V1's.
      expect(btn.tagName).toBe("BUTTON");
      expect(btn).toHaveAttribute(
        "aria-label",
        `View calculation breakdown for ${kpis[idx].label}`,
      );
    });
  });

  it("fires OnSelectKpi with the card's id when clicked", async () => {
    const eventHandler = vi.fn();
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={eventHandler}
        events={["OnSelectKpi"]}
        kpis={kpis}
      />,
    );

    await userEvent.click(screen.getByLabelText("View calculation breakdown for Features shipped"));
    expect(eventHandler).toHaveBeenCalledWith("OnSelectKpi", "dash", ["featuresShipped"]);

    await userEvent.click(screen.getByLabelText("View calculation breakdown for Avg Cost/Plan"));
    expect(eventHandler).toHaveBeenCalledWith("OnSelectKpi", "dash", ["avgCostPlan"]);
  });

  it("fires OnSelectKpi on Enter and on Space", async () => {
    const eventHandler = vi.fn();
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={eventHandler}
        events={["OnSelectKpi"]}
        kpis={kpis}
      />,
    );

    const costCard = screen.getByLabelText("View calculation breakdown for Avg cost per Feature");
    costCard.focus();
    await userEvent.keyboard("{Enter}");
    expect(eventHandler).toHaveBeenCalledWith("OnSelectKpi", "dash", ["costPerFeature"]);

    const forecastCard = screen.getByLabelText(
      "View calculation breakdown for Forecast This Month",
    );
    forecastCard.focus();
    await userEvent.keyboard(" ");
    expect(eventHandler).toHaveBeenCalledWith("OnSelectKpi", "dash", ["forecastMonth"]);
  });

  it("leaves a KPI without an id inert rather than a focusable control", () => {
    // Deliberate departure from V1, which falls back to a positional key so every tile is a
    // control. Those keys are legacy aliases, and V2's host omits the id exactly when there is no
    // data behind the drill-down, where a click would open an empty panel.
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        events={["OnSelectKpi"]}
        kpis={[{ label: "Avg Cost/Plan", value: "$24.50" }]}
      />,
    );

    expect(screen.queryByRole("button", { name: /Avg Cost\/Plan/ })).not.toBeInTheDocument();
    expect(screen.getByText("Avg Cost/Plan")).toBeInTheDocument();
  });

  it("renders subValue when provided on a KPI card", () => {
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        kpis={[
          {
            id: "forecastMonth",
            label: "Forecast This Month",
            value: "$42.50",
            subValue: "$85.00 total",
            hint: "50% subsidized",
          },
        ]}
      />,
    );

    const subValueEl = screen.getByText("$85.00 total");
    expect(subValueEl).toBeInTheDocument();
    expect(subValueEl).toHaveClass("tdb-kpi-subvalue");
  });
});

describe("TendrilDashboard pull requests week/month toggle", () => {
  const monthlyPrs: DashboardMonthValueDto[] = [
    { label: "Apr", value: 10 },
    { label: "May", value: 15 },
    { label: "Jun", value: 8 },
    { label: "Jul", value: 12 },
    { label: "Aug", value: 20 },
    { label: "Sep", value: 7 },
  ];

  const weeklyPrs: DashboardMonthValueDto[] = [
    { label: "Aug 3", value: 4 },
    { label: "Aug 10", value: 6 },
    { label: "Aug 17", value: 3 },
    { label: "Aug 24", value: 5 },
    { label: "Aug 31", value: 8 },
    { label: "Sep 7", value: 2 },
  ];

  // Weeks, not months: the card's question is "are we shipping this week", and a week bar's label
  // also fits the 280px side column that a month's does not.
  it("defaults to week view and displays weekly pull requests", () => {
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        pullRequests={monthlyPrs}
        pullRequestsWeekly={weeklyPrs}
      />,
    );

    const monthBtn = screen.getByRole("button", { name: "Month" });
    const weekBtn = screen.getByRole("button", { name: "Week" });

    expect(weekBtn).toHaveAttribute("data-active", "true");
    expect(monthBtn).toHaveAttribute("data-active", "false");

    expect(screen.getByText("Aug 24")).toBeInTheDocument();
    expect(screen.getByText("Sep 7")).toBeInTheDocument();
    expect(screen.queryByText("Apr")).not.toBeInTheDocument();
  });

  it("switches to month view on click and restores week view when clicked again", () => {
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        pullRequests={monthlyPrs}
        pullRequestsWeekly={weeklyPrs}
      />,
    );

    const monthBtn = screen.getByRole("button", { name: "Month" });
    const weekBtn = screen.getByRole("button", { name: "Week" });

    // Switch to Month
    fireEvent.click(monthBtn);
    expect(monthBtn).toHaveAttribute("data-active", "true");
    expect(weekBtn).toHaveAttribute("data-active", "false");

    expect(screen.getByText("Apr")).toBeInTheDocument();
    expect(screen.getByText("Sep")).toBeInTheDocument();
    expect(screen.queryByText("Aug 24")).not.toBeInTheDocument();

    // Switch back to Week
    fireEvent.click(weekBtn);
    expect(weekBtn).toHaveAttribute("data-active", "true");
    expect(monthBtn).toHaveAttribute("data-active", "false");

    expect(screen.getByText("Aug 24")).toBeInTheDocument();
    expect(screen.queryByText("Apr")).not.toBeInTheDocument();
  });

  /**
   * The month range's width, which is the half of the fit that markup can hold.
   *
   * jsdom lays nothing out, so "does not overflow" cannot be measured here; what makes it true is
   * two things that can be. One is the bar count — `buildPullRequests` plots V1's six months rather
   * than twelve, which is asserted in the app's own dashboard tests. The other is that every level
   * between the card and a bar is free to shrink: `.tdb-bars-plot` and `.tdb-bar-item` both declare
   * `min-width: 0`, without which a flex item's `min-width: auto` refuses to go below its content
   * and pushes the track past the card (see dashboard.css.test.ts). This case pins the third part:
   * the bars are flexible, so six of them share whatever width the card has instead of claiming a
   * fixed one.
   */
  it("gives the month range no more bars than it has data, each one flexible", () => {
    const { container } = render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        pullRequests={monthlyPrs}
        pullRequestsWeekly={weeklyPrs}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    const bars = container.querySelectorAll<HTMLElement>(".tdb-bar-item");
    expect(bars).toHaveLength(monthlyPrs.length);
    // No inline width anywhere on the track or its items: width is the stylesheet's flexible
    // `flex: 1` / `min-width: 0`, never a hard number the card cannot honour.
    expect(container.querySelector<HTMLElement>(".tdb-bars-plot")!.style.width).toBe("");
    for (const bar of bars) expect(bar.style.width).toBe("");
    // The bar's own height is the only inline geometry, and it is a percentage of its track.
    for (const fill of container.querySelectorAll<HTMLElement>(".tdb-bar")) {
      expect(fill.style.height).toMatch(/%$/);
    }
  });

  it("renders weekly labels with formatted two-line date wrapping while remaining accessible", () => {
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        pullRequests={monthlyPrs}
        pullRequestsWeekly={weeklyPrs}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    const labelAug3 = screen.getByText("Aug 3");
    const labelAug10 = screen.getByText("Aug 10");
    const labelSep7 = screen.getByText("Sep 7");

    expect(labelAug3).toBeInTheDocument();
    expect(labelAug10).toBeInTheDocument();
    expect(labelSep7).toBeInTheDocument();

    expect(labelAug3.textContent).toBe("Aug\n3");
    expect(labelAug10.textContent).toBe("Aug\n10");
    expect(labelSep7.textContent).toBe("Sep\n7");
  });

  it("renders bars with proper aria-label incorporating structured date fields", () => {
    const structuredMonthlyPrs: DashboardMonthValueDto[] = [
      { label: "Aug", value: 15, year: 2026, month: 8, day: 1, date: "2026-08-01" },
      { label: "Sep", value: 1, year: 2026, month: 9, day: 1, date: "2026-09-01" },
    ];

    const structuredWeeklyPrs: DashboardMonthValueDto[] = [
      { label: "Aug 24", value: 7, year: 2026, month: 8, day: 24, date: "2026-08-24" },
      { label: "Aug 31", value: 1, year: 2026, month: 8, day: 31, date: "2026-08-31" },
    ];

    render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        pullRequests={structuredMonthlyPrs}
        pullRequestsWeekly={structuredWeeklyPrs}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    expect(screen.getByLabelText("August 2026: 15 pull requests merged")).toBeInTheDocument();
    expect(screen.getByLabelText("September 2026: 1 pull request merged")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    expect(
      screen.getByLabelText("Week of August 24, 2026: 7 pull requests merged"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Week of August 31, 2026: 1 pull request merged"),
    ).toBeInTheDocument();
  });

  it("renders accessible labels with backward compatibility when structured date fields are absent", () => {
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        pullRequests={monthlyPrs}
        pullRequestsWeekly={weeklyPrs}
      />,
    );

    expect(screen.getByLabelText("Aug 24: 5 pull requests merged")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    expect(screen.getByLabelText("Aug: 20 pull requests merged")).toBeInTheDocument();
  });
});

/**
 * The loading state, which is the framework's `Skeleton` idiom rather than V1's
 * `Text.Muted("Loading Dashboard Data...")` blanking of the whole page.
 *
 * The contract these pin is narrow and worth stating: while `loading` is set the dashboard states no
 * figure at all, not even an honest "unknown" one. A dash or an "n/a" is a claim about the data, and
 * the caller has not looked yet.
 */
describe("TendrilDashboard loading placeholders", () => {
  const renderLoading = (loading: boolean) =>
    render(
      <TendrilDashboard
        id="dash"
        eventHandler={vi.fn()}
        loading={loading}
        draftCount={3}
        inProgressCount={1}
        // What a caller with nothing fetched would pass, i.e. the shape of a first paint.
        kpis={[]}
        trendWeekly={null}
        pullRequests={[]}
        pullRequestsWeekly={[]}
        activity={[]}
      />,
    );

  it("blocks out four KPI tiles instead of stating an unknown figure", () => {
    const { container } = renderLoading(true);

    expect(screen.getByTestId("tdb-kpis-skeleton")).toBeInTheDocument();
    expect(container.querySelectorAll(".tdb-kpi")).toHaveLength(4);
    // The tones cycle exactly as the real tiles' do, so no card changes colour on arrival.
    expect(
      Array.from(container.querySelectorAll(".tdb-kpi")).map((el) => el.getAttribute("data-tone")),
    ).toEqual(["0", "1", "2", "3"]);
    // Not one of the no-data vocabularies, in any casing.
    expect(container.textContent).not.toMatch(/n\/a/i);
    expect(container.textContent).not.toContain("—");
  });

  it("reserves the trend card and both side charts so nothing moves when the data lands", () => {
    const { container } = renderLoading(true);

    // The trend block is skipped entirely when there is no series, so its frame is what stops the
    // whole left column reflowing later.
    expect(container.querySelector(".tdb-trend")).not.toBeNull();
    // One placeholder each for the trend, Git Activity and Pull Requests.
    expect(screen.getAllByTestId("tdb-chart-skeleton")).toHaveLength(3);
    // The real empty notes belong to a settled empty state, not to this one.
    expect(screen.queryByText("No merged pull requests yet")).not.toBeInTheDocument();
  });

  it("leaves the status strip and Active Jobs alone, whose counts survive a refresh", () => {
    renderLoading(true);

    // Those come from the plan and job stores, which keep the previous list; inventing a placeholder
    // for a number that is already correct would be the flicker in reverse.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("No jobs running")).toBeInTheDocument();
  });

  it("draws no placeholder once the figures exist, however empty they are", () => {
    renderLoading(false);

    expect(screen.queryByTestId("tdb-kpis-skeleton")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("tdb-chart-skeleton")).toHaveLength(0);
    // A settled empty range says so — one note per side card — which is a statement the loading
    // state must not make.
    expect(screen.getAllByText("No merged pull requests yet")).toHaveLength(2);
  });
});
