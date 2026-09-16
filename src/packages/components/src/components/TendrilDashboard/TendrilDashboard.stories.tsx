import type { Meta, StoryObj } from "@storybook/react";
import { TendrilDashboard } from "./TendrilDashboard.tsx";
import type {
  DashboardActivityMonthDto,
  DashboardJobDto,
  DashboardKpiDto,
  DashboardMonthValueDto,
  DashboardTrendDto,
} from "./types.ts";

const mockKpis: DashboardKpiDto[] = [
  {
    label: "Total Velocity",
    value: "42 plans/mo",
    delta: "+18%",
    direction: "up",
  },
  {
    label: "Average Cost / Plan",
    value: "$4.12",
    delta: "-12%",
    direction: "down",
  },
  {
    label: "Merge Rate",
    value: "96.4%",
    delta: "+2.1%",
    direction: "up",
  },
  {
    label: "Autonomous Success",
    value: "91.8%",
    delta: "+5.4%",
    direction: "up",
  },
];

/** The four drill-down tiles the app supplies, each with the id `OnSelectKpi` reports. */
const mockDrillDownKpis: DashboardKpiDto[] = [
  {
    id: "featuresShipped",
    label: "Features shipped",
    value: "128",
    hint: "merged PRs and solved issues, last 30 days",
    delta: "+22%",
    direction: "up",
  },
  {
    id: "costPerFeature",
    label: "Avg cost per Feature",
    value: "$3.84",
    hint: "$491.52 over 128 features",
    delta: "-9%",
    direction: "down",
  },
  {
    id: "forecastMonth",
    label: "Forecast This Month",
    value: "$780",
    hint: "38% subsidized via subscription",
  },
  {
    id: "avgCostPlan",
    label: "Avg Cost/Plan",
    value: "$4.12",
    hint: "vs $4.68 prior week",
    delta: "-12%",
    direction: "down",
  },
];

const TREND_DATES = Array.from({ length: 28 }, (_, index) => {
  const day = new Date(Date.UTC(2026, 8, 5) - (27 - index) * 86_400_000);
  return day.toISOString().slice(0, 10);
});

const TREND_COST = [
  12, 18, 9, 0, 0, 24, 31, 27, 15, 8, 0, 19, 33, 41, 28, 22, 0, 0, 17, 26, 38, 44, 31, 20, 12, 0,
  29, 47,
];

const TREND_PLANS = [
  2, 3, 1, 0, 0, 4, 5, 4, 2, 1, 0, 3, 5, 6, 4, 3, 0, 0, 2, 4, 6, 7, 5, 3, 2, 0, 4, 7,
];

const rollingMean = (values: number[]): (number | null)[] =>
  values.map((_, index) =>
    index < 6
      ? null
      : values.slice(index - 6, index + 1).reduce((acc, value) => acc + value, 0) / 7,
  );

const mockTrend: DashboardTrendDto = {
  dates: TREND_DATES,
  cost: TREND_COST,
  plans: TREND_PLANS,
  rollingCost: rollingMean(TREND_COST),
  rollingPlans: rollingMean(TREND_PLANS),
};

const mockPullRequests: DashboardMonthValueDto[] = [
  { label: "Apr", value: 34, year: 2026, month: 4, day: 1, date: "2026-04-01" },
  { label: "May", value: 42, year: 2026, month: 5, day: 1, date: "2026-05-01" },
  { label: "Jun", value: 48, year: 2026, month: 6, day: 1, date: "2026-06-01" },
  { label: "Jul", value: 55, year: 2026, month: 7, day: 1, date: "2026-07-01" },
  { label: "Aug", value: 64, year: 2026, month: 8, day: 1, date: "2026-08-01" },
  { label: "Sep", value: 72, year: 2026, month: 9, day: 1, date: "2026-09-01" },
];

/** The range the card opens on, so the Default story shows bars rather than its empty note. */
const mockPullRequestsWeekly: DashboardMonthValueDto[] = [
  { label: "Aug 3", value: 12, year: 2026, month: 8, day: 3, date: "2026-08-03" },
  { label: "Aug 10", value: 17, year: 2026, month: 8, day: 10, date: "2026-08-10" },
  { label: "Aug 17", value: 14, year: 2026, month: 8, day: 17, date: "2026-08-17" },
  { label: "Aug 24", value: 21, year: 2026, month: 8, day: 24, date: "2026-08-24" },
  { label: "Aug 31", value: 19, year: 2026, month: 8, day: 31, date: "2026-08-31" },
  { label: "Sep 7", value: 9, year: 2026, month: 9, day: 7, date: "2026-09-07" },
];

const mockActivity: DashboardActivityMonthDto[] = [
  { label: "May", weeks: [8, 12, 10, 14] },
  { label: "Jun", weeks: [11, 15, 13, 17] },
  { label: "Jul", weeks: [14, 18, 16, 20] },
  { label: "Aug", weeks: [16, 22, 19, 24] },
  { label: "Sep", weeks: [18, 25, 21, 28] },
];

const mockJobs: DashboardJobDto[] = [
  {
    id: "job-001",
    planId: "00064",
    title: "Port Tendril Dashboard Analytics and Web Viewer",
    status: "running",
  },
  {
    id: "job-002",
    planId: "00062",
    title: "Port Tendril Plan Markdown and Diff Inspection Widgets",
    status: "running",
  },
  {
    id: "job-003",
    planId: "00055",
    title: "Configure Foundation React 19 Tailwind Storybook 8",
    status: "completed",
  },
];

const meta: Meta<typeof TendrilDashboard> = {
  title: "Components/TendrilDashboard",
  component: TendrilDashboard,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof TendrilDashboard>;

export const Default: Story = {
  args: {
    id: "dashboard-1",
    events: ["OnDrafts", "OnJobs", "OnReview", "OnJob", "OnSelectKpi"],
    eventHandler: (eventName, id, args) => {
      console.log("Dashboard event:", eventName, id, args);
    },
    dateText: "Saturday, 5th September",
    greeting: "Good morning, Operator",
    headline: "Tendril Autonomous Execution Fleet",
    draftCount: 8,
    inProgressCount: 5,
    reviewCount: 3,
    completedCount: 142,
    failedCount: 2,
    kpis: mockKpis,
    trend: mockTrend,
    pullRequests: mockPullRequests,
    pullRequestsWeekly: mockPullRequestsWeekly,
    activity: mockActivity,
    jobs: mockJobs,
  },
};

export const EmptyState: Story = {
  args: {
    id: "dashboard-empty",
    events: [],
    eventHandler: () => {},
    dateText: "Saturday, 5th September",
    greeting: "Welcome to Tendril",
    headline: "System Initialized",
    draftCount: 0,
    inProgressCount: 0,
    reviewCount: 0,
    completedCount: 0,
    failedCount: 0,
    kpis: [],
    trend: null,
    pullRequests: [],
    activity: [],
    jobs: [],
  },
};

/**
 * The KPI tiles the app renders: each carries an id, so each is a button that reports
 * `OnSelectKpi` with that id. The `Default` story's tiles have no ids and stay inert.
 */
export const ClickableKpis: Story = {
  args: {
    ...Default.args,
    id: "dashboard-kpis",
    kpis: mockDrillDownKpis,
  },
};

/**
 * The first paint, before any analytics have arrived.
 *
 * Distinct from `EmptyState`, which is the settled answer "we looked and there is nothing" — this is
 * "we have not looked yet", and it states no figure at all. The four tiles, the trend card and the two
 * side charts are `Skeleton` placeholders sized to the content they stand in for, so the page does not
 * move when the numbers replace them. The status strip and Active Jobs carry real counts throughout:
 * they come from the plan and job stores, which keep the previous list across a refresh.
 */
export const Loading: Story = {
  args: {
    ...Default.args,
    id: "dashboard-loading",
    loading: true,
    kpis: [],
    trend: null,
    pullRequests: [],
    pullRequestsWeekly: [],
    activity: [],
    jobs: [],
  },
};
