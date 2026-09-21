import type { Meta, StoryObj } from "@storybook/react";
import { TendrilDashboard } from "@/components/TendrilDashboard";
import type {
  DashboardActivityMonthDto,
  DashboardJobDto,
  DashboardKpiDto,
  DashboardMonthValueDto,
  DashboardTrendDto,
} from "@/components/TendrilDashboard/types";
import { AppFrame, fullBleedDecorator, planSectionItems } from "./app-layout-harness";

/**
 * The Dashboard as the app opens on it: the landing page with figures and running jobs, the same
 * page on a first run before any analytics exist, and the loading state a cold start shows.
 *
 * The dashboard takes every figure as a prop, so these are the real widget with different data -
 * not a mock of it.
 */
const meta: Meta = {
  title: "App/Dashboard Layout",
  parameters: {
    layout: "fullscreen",
    // The trend and pull-request cards are echarts canvases, which finish painting on their own
    // schedule; the running job row also animates its spinner.
    visual: { disable: true },
  },
  decorators: [fullBleedDecorator],
};

export default meta;
type Story = StoryObj;

const noop = () => {};

const kpis: DashboardKpiDto[] = [
  { id: "plans", label: "Plans completed", value: "38", delta: "+6", direction: "up" },
  { id: "cost", label: "Spend this month", value: "$182.40", delta: "-12%", direction: "down" },
  {
    id: "duration",
    label: "Median plan duration",
    value: "14m",
    subValue: "p90 41m",
    delta: "-3m",
    direction: "down",
  },
  {
    id: "forecast",
    label: "Forecast",
    value: "$240",
    hint: "Projected from the last 14 days",
  },
];

const days = (count: number, start: string): string[] => {
  const out: string[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    out.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
};

const COST = [
  5.2, 7.8, 4.1, 9.6, 12.3, 8.7, 6.4, 11.2, 14.8, 9.1, 7.3, 10.6, 13.9, 8.2, 5.7, 12.1, 15.4, 11.8,
  9.3, 6.9, 8.4, 13.2, 16.1, 12.7, 10.2, 7.6, 9.8, 14.3,
];
const PLANS = [1, 2, 1, 3, 4, 2, 2, 3, 5, 3, 2, 3, 4, 2, 1, 4, 5, 4, 3, 2, 3, 4, 5, 4, 3, 2, 3, 5];

/** A trailing 7-day mean, with the first six entries null because the window reaches past the start. */
const rolling = (values: number[]): (number | null)[] =>
  values.map((_, index) => {
    if (index < 6) return null;
    const window = values.slice(index - 6, index + 1);
    return Number((window.reduce((sum, n) => sum + n, 0) / window.length).toFixed(2));
  });

const trend: DashboardTrendDto = {
  dates: days(COST.length, "2026-08-25"),
  cost: COST,
  plans: PLANS,
  rollingCost: rolling(COST),
  rollingPlans: rolling(PLANS),
};

const pullRequests: DashboardMonthValueDto[] = [
  { label: "Apr", value: 12, year: 2026, month: 4 },
  { label: "May", value: 18, year: 2026, month: 5 },
  { label: "Jun", value: 15, year: 2026, month: 6 },
  { label: "Jul", value: 24, year: 2026, month: 7 },
  { label: "Aug", value: 21, year: 2026, month: 8 },
  { label: "Sep", value: 29, year: 2026, month: 9 },
];

/**
 * The card opens on its Week tab and reads `pullRequestsWeekly` there, so a story that supplies
 * only the monthly series renders "No merged pull requests yet" on arrival. Both are given.
 */
const pullRequestsWeekly: DashboardMonthValueDto[] = [
  { label: "Aug 25", value: 4, year: 2026, month: 8, day: 25 },
  { label: "Sep 1", value: 7, year: 2026, month: 9, day: 1 },
  { label: "Sep 8", value: 5, year: 2026, month: 9, day: 8 },
  { label: "Sep 15", value: 9, year: 2026, month: 9, day: 15 },
];

const activity: DashboardActivityMonthDto[] = [
  { label: "Jul", weeks: [3, 7, 5, 9, 4] },
  { label: "Aug", weeks: [6, 11, 8, 4, 7] },
  { label: "Sep", weeks: [9, 14, 6, 10, 5] },
];

const jobs: DashboardJobDto[] = [
  {
    id: "job-1",
    planId: "00074",
    title: "Storybook stories for full app layout states",
    status: "running",
  },
  { id: "job-2", planId: "00071", title: "Port plan verification reordering", status: "queued" },
  {
    id: "job-3",
    planId: "00068",
    title: "Resizable sidebar width persistence",
    status: "completed",
  },
];

/** The everyday landing page: figures, charts, and a job still running. */
export const Populated: Story = {
  render: () => (
    <AppFrame activeNav="dashboard" navBadges={{ plans: 4, review: 1, jobs: 1 }} chatCount={4}>
      <TendrilDashboard
        id="tendril-dashboard"
        eventHandler={noop}
        events={["OnSelectKpi", "OnSelectJob"]}
        greeting="Good afternoon, Joel"
        headline="Two plans are waiting on you"
        dateText="Monday, 21 September 2026"
        draftCount={4}
        inProgressCount={1}
        reviewCount={1}
        completedCount={38}
        failedCount={2}
        kpis={kpis}
        trend={trend}
        pullRequests={pullRequests}
        pullRequestsWeekly={pullRequestsWeekly}
        activity={activity}
        jobs={jobs}
      />
    </AppFrame>
  ),
};

/** A cold start: the analytics have never arrived, so the four data regions hold their skeletons. */
export const Loading: Story = {
  render: () => (
    <AppFrame activeNav="dashboard">
      <TendrilDashboard
        id="tendril-dashboard"
        eventHandler={noop}
        greeting="Good afternoon, Joel"
        dateText="Monday, 21 September 2026"
        loading
        jobs={[]}
      />
    </AppFrame>
  ),
};

/** First run: the app is installed, nothing has been planned yet, and every count is zero. */
export const FirstRun: Story = {
  render: () => (
    <AppFrame activeNav="dashboard">
      <TendrilDashboard
        id="tendril-dashboard"
        eventHandler={noop}
        greeting="Welcome to Tendril"
        headline="Start by describing a change you want made"
        dateText="Monday, 21 September 2026"
        draftCount={0}
        inProgressCount={0}
        reviewCount={0}
        completedCount={0}
        failedCount={0}
        kpis={[]}
        trend={null}
        pullRequests={[]}
        activity={[]}
        jobs={[]}
      />
    </AppFrame>
  ),
};

/**
 * The collapsed rail: the sidebar is a strip of icons and the content takes the rest, which is the
 * layout most of the app's width budget is actually spent in.
 */
export const CollapsedSidebar: Story = {
  render: () => (
    <AppFrame
      activeNav="dashboard"
      sectionTitle="Plans"
      sectionItems={planSectionItems}
      selectedItemId="00074"
      navBadges={{ plans: 4, review: 1, jobs: 1 }}
      chatCount={4}
      collapsed
    >
      <TendrilDashboard
        id="tendril-dashboard"
        eventHandler={noop}
        events={["OnSelectKpi", "OnSelectJob"]}
        greeting="Good afternoon, Joel"
        headline="Two plans are waiting on you"
        dateText="Monday, 21 September 2026"
        draftCount={4}
        inProgressCount={1}
        reviewCount={1}
        completedCount={38}
        failedCount={2}
        kpis={kpis}
        trend={trend}
        pullRequests={pullRequests}
        pullRequestsWeekly={pullRequestsWeekly}
        activity={activity}
        jobs={jobs}
      />
    </AppFrame>
  ),
};
