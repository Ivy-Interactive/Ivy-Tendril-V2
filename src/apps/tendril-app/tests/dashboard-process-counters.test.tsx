/**
 * The dashboard's eleven-counter aggregate, as far as V2 has a counterpart for it.
 *
 * V1 computes the whole set server-side in `TendrilProcessStatusService.Compute` behind a 200ms
 * debounce and a `CountsInvalidated` signal; V2 derives them per render from the plan and job lists
 * the shell already holds. These cases pin the *arithmetic*, which is the part that has to agree with
 * `Compute` regardless of where it runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardView, buildWeeklyPullRequests } from "../src/views/DashboardView";
import { bridge } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";
import { job } from "./fixtures/job.fixture";
import { toIsoDate, todayDayNumber } from "../src/utils/rollingAverage";
import type { Job, PlanSummary, RecentMergedPr } from "../src/types/api";

beforeEach(() => {
  // The analytics calls are irrelevant here and would otherwise reach for a real daemon.
  vi.spyOn(bridge, "getDashboardActivity").mockRejectedValue(new Error("no daemon under test"));
  vi.spyOn(bridge, "getShippedFeatures").mockResolvedValue([]);
  vi.spyOn(bridge, "getAgentCostBreakdown").mockResolvedValue([]);
  vi.spyOn(bridge, "getRecentPlanCosts").mockResolvedValue([]);
  vi.spyOn(bridge, "getRecentMergedPrs").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Text of the Plans box's count badge, or null when the box carries none. */
const boxCount = (container: HTMLElement, index: number): string | null => {
  const boxes = container.querySelectorAll(".tpv-box-stage");
  return boxes[index]?.querySelector(".tpv-box-count")?.textContent ?? null;
};

const renderDashboard = (plans: PlanSummary[], jobs: Job[]) =>
  render(<DashboardView plans={plans} jobs={jobs} />);

describe("dashboard plan-state counters", () => {
  it("counts Blocked plans with the drafts and Failed plans with the reviews", () => {
    const plans = [
      planSummary({ id: "00001", state: "Draft" }),
      planSummary({ id: "00002", state: "Blocked" }),
      planSummary({ id: "00003", state: "Review" }),
      planSummary({ id: "00004", state: "Failed" }),
      // Neither box: Completed and Skipped are terminal and Executing is mid-flight.
      planSummary({ id: "00005", state: "Completed" }),
      planSummary({ id: "00006", state: "Skipped" }),
      planSummary({ id: "00007", state: "Executing" }),
    ];

    const { container } = renderDashboard(plans, []);

    // `snapshot.Drafts` is `State IN ('Draft', 'Blocked')` and `ReviewCount` is
    // `snapshot.Review + snapshot.Failed`.
    expect(boxCount(container, 0)).toBe("2");
    expect(boxCount(container, 1)).toBe("2");
  });

  it("subtracts a plan an active job is still holding from its box", () => {
    const plans = [
      planSummary({ id: "00001", state: "Draft" }),
      planSummary({ id: "00002", state: "Draft" }),
      planSummary({ id: "00003", state: "Review" }),
    ];
    // `Compute`'s prematureDrafts / prematureReviews: a plan whose job has not finished has not
    // necessarily had its state advanced yet, and must not be offered to the operator as ready.
    const jobs = [
      job({ id: "j1", type: "ExecutePlan", planId: "00001", status: "Running" }),
      job({ id: "j2", type: "RetryPlan", planId: "00003", status: "Queued" }),
    ];

    const { container } = renderDashboard(plans, jobs);

    expect(boxCount(container, 0)).toBe("1");
    expect(boxCount(container, 1)).toBeNull();
  });

  it("leaves the counts uncorrected when a finished job holds the plan", () => {
    const plans = [planSummary({ id: "00001", state: "Draft" })];
    const jobs = [job({ id: "j1", type: "ExecutePlan", planId: "00001", status: "Completed" })];

    const { container } = renderDashboard(plans, jobs);

    expect(boxCount(container, 0)).toBe("1");
  });
});

describe("dashboard process-viewer arrows", () => {
  it("derives every arrow from the active job list by promptware type, not from plan state", () => {
    // Not one plan in a transient state: `Compute` reads job types, so the arrows must light up from
    // the jobs alone. A CreatePlan job has no plan at all until it produces one.
    const jobs = [
      job({ id: "j1", type: "CreatePlan", planId: undefined, status: "Pending" }),
      job({ id: "j2", type: "ExpandPlan", planId: "00002", status: "Running" }),
      job({ id: "j3", type: "SplitPlan", planId: "00003", status: "Running" }),
      job({ id: "j4", type: "UpdatePlan", planId: "00004", status: "Blocked" }),
      job({ id: "j5", type: "ExecutePlan", planId: "00005", status: "Running" }),
      job({ id: "j6", type: "RetryPlan", planId: "00006", status: "Queued" }),
      job({ id: "j7", type: "CreatePr", planId: "00007", status: "Running" }),
    ];

    const { container } = renderDashboard([], jobs);

    const arrows = container.querySelectorAll(".tpv-arrow-segment .tpv-arrow-count");
    // Arrow 1 is CreatePlan; arrow 2 is ExecutePlan.
    expect(Array.from(arrows).map((n) => n.textContent)).toEqual(["1", "1"]);
    // ExpandPlan, SplitPlan and UpdatePlan share the Updating loop.
    const loops = container.querySelectorAll(".tpv-loop-arrow .tpv-arrow-count");
    expect(Array.from(loops).map((n) => n.textContent)).toEqual(["3", "1"]);
    expect(container.querySelector(".tpv-sub-label")?.textContent).toContain("PR 1");
  });

  it("ignores plan states that no active job backs", () => {
    // A plan whose state says Creating or Updating with no job behind it is a stale write, and V1's
    // counters would not report it.
    const plans = [
      planSummary({ id: "00001", state: "Creating" }),
      planSummary({ id: "00002", state: "Updating" }),
      planSummary({ id: "00003", state: "Executing" }),
    ];

    const { container } = renderDashboard(plans, []);

    expect(container.querySelectorAll(".tpv-arrow-segment .tpv-arrow-count")).toHaveLength(0);
    expect(container.querySelectorAll(".tpv-loop-arrow")).toHaveLength(0);
  });
});

describe("buildWeeklyPullRequests", () => {
  const today = todayDayNumber();
  const mergedPr = (dayOffset: number, url: string): RecentMergedPr => ({
    prUrl: url,
    planId: 1,
    title: "Ship it",
    repo: "/repos/Tendril-App",
    updated: `${toIsoDate(today - dayOffset)} 09:00:00`,
  });

  it("returns six Monday-start weeks, oldest first", () => {
    const weeks = buildWeeklyPullRequests([], today);

    expect(weeks).toHaveLength(6);
    for (const week of weeks) {
      // Epoch day 0 is a Thursday, so a correct Monday is what makes this pass.
      expect(new Date(`${week.date}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    expect(weeks.map((w) => w.date)).toEqual([...weeks.map((w) => w.date)].sort());
  });

  it("buckets a merged PR into the week containing its merge date", () => {
    const weeks = buildWeeklyPullRequests(
      [mergedPr(0, "a"), mergedPr(0, "b"), mergedPr(35, "c")],
      today,
    );

    expect(weeks[weeks.length - 1].value).toBe(2);
    expect(weeks.reduce((acc, w) => acc + w.value, 0)).toBe(3);
  });

  it("drops a merge older than the plotted window rather than folding it into the first bar", () => {
    const weeks = buildWeeklyPullRequests([mergedPr(400, "old")], today);

    expect(weeks.every((w) => w.value === 0)).toBe(true);
  });

  it("feeds the Pull Requests card's Week tab, which is otherwise an empty chart", async () => {
    vi.spyOn(bridge, "getRecentMergedPrs").mockResolvedValue([mergedPr(0, "a")]);
    // `useDashboardAnalytics` fetches its five queries under one `Promise.all`, so the rejecting
    // activity stub the other cases rely on would discard the merged-PR list with it. See the report.
    vi.spyOn(bridge, "getDashboardActivity").mockResolvedValue({
      months: [],
      prevWeekAvgCost: 0,
      dailyCosts: [],
      dailyPlans: [],
      dailyDataStart: null,
      forecast: {
        calendarProjection: null,
        calendarDays: 0,
        activityProjection: null,
        activityDays: 0,
        totalSpend: 0,
        daysInMonth: 30,
        apiCalendarProjection: null,
        apiActivityProjection: null,
        totalApiSpend: 0,
        totalSubsidizedSpend: 0,
        totalApiTokens: 0,
        totalSubsidizedTokens: 0,
        subsidizedTokenPercent: 0,
        subsidizedCostPercent: 0,
      },
    });
    const { container } = renderDashboard([], []);

    // The tab is clickable whether or not it has data, so before this the control rendered
    // PillBars' "No merged pull requests yet" note forever.
    fireEvent.click(screen.getByText("Week"));

    // Six bars, one per plotted week, where before there were none at all.
    await waitFor(() => expect(container.querySelectorAll(".tdb-bar-item").length).toBe(6));
  });
});
