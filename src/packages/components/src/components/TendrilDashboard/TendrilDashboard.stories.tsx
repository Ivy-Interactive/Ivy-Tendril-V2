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

/** The five drill-down tiles the app supplies, each with the id `OnSelectKpi` reports. */
const mockDrillDownKpis: DashboardKpiDto[] = [
  {
    id: "featuresShipped",
    label: "Features Shipped",
    value: "128",
    hint: "last 60 days",
    delta: "+22%",
    direction: "up",
  },
  {
    id: "costPerFeature",
    label: "Cost / Feature",
    value: "$3.84",
    hint: "priced features only",
    delta: "-9%",
    direction: "down",
  },
  {
    id: "forecastMonth",
    label: "Forecast This Month",
    value: "$620 – $940",
    hint: "calendar to activity basis",
  },
  {
    id: "avgCostPlan",
    label: "Average Cost / Plan",
    value: "$4.12",
    hint: "vs $4.68 prior week",
    delta: "-12%",
    direction: "down",
  },
  {
    id: "tokensConsumed",
    label: "Tokens Consumed",
    value: "412M",
    hint: "38% subsidized",
  },
];

const mockTrend: DashboardTrendDto = {
  months: ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"],
  cost: [120, 150, 180, 220, 280, 310, 390, 420, 480, 510, 580, 640],
  plans: [14, 18, 22, 28, 35, 38, 44, 48, 52, 58, 62, 70],
  prevCost: [90, 110, 130, 160, 190, 210, 260, 290, 320, 340, 390, 420],
  prevPlans: [10, 12, 15, 19, 22, 25, 30, 33, 36, 40, 42, 46],
};

const mockPullRequests: DashboardMonthValueDto[] = [
  { label: "Apr", value: 34 },
  { label: "May", value: 42 },
  { label: "Jun", value: 48 },
  { label: "Jul", value: 55 },
  { label: "Aug", value: 64 },
  { label: "Sep", value: 72 },
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
    dateText: "Saturday, September 5, 2026",
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
    activity: mockActivity,
    jobs: mockJobs,
  },
};

export const EmptyState: Story = {
  args: {
    id: "dashboard-empty",
    events: [],
    eventHandler: () => {},
    dateText: "Saturday, September 5, 2026",
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
