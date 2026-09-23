import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import {
  KpiBreakdownSheet,
  type KpiBreakdownData,
  type KpiBreakdownId,
  type KpiDailyCost,
} from "./KpiBreakdownSheet";

/** 2026-09-22 as a day number, so every window in these stories is pinned. */
const TODAY = Math.floor(Date.UTC(2026, 8, 22) / 86_400_000);
const iso = (daysAgo: number): string =>
  new Date((TODAY - daysAgo) * 86_400_000).toISOString().slice(0, 10);

const dailyCosts: KpiDailyCost[] = Array.from({ length: 60 }, (_, i) => {
  const api = i % 6 === 0 ? 0 : 4 + ((i * 7) % 11);
  const subsidized = 12 + ((i * 5) % 9);
  // Every fifth day carries spend written before `CostSource` was captured: in neither half.
  const unattributed = i % 5 === 0 ? 3.25 : 0;
  return {
    date: iso(i),
    cost: api + subsidized + unattributed,
    tokens: 900_000 + i * 12_000,
    apiCost: api,
    apiTokens: 200_000 + i * 3_000,
    subsidizedCost: subsidized,
    subsidizedTokens: 650_000 + i * 8_000,
  };
});

const DATA: KpiBreakdownData = {
  today: TODAY,
  activity: {
    prevWeekAvgCost: 3.42,
    dailyCosts,
    forecast: {
      calendarProjection: 812.4,
      calendarDays: 22,
      activityProjection: 944.1,
      activityDays: 19,
      daysInMonth: 30,
      apiCalendarProjection: 241.9,
      apiActivityProjection: 281.3,
      totalApiSpend: 177.4,
      totalSubsidizedSpend: 418.2,
      subsidizedTokenPercent: 71.6,
      subsidizedCostPercent: 64.2,
    },
  },
  shippedFeatures: Array.from({ length: 45 }, (_, i) => ({ date: iso(i), count: (i * 3) % 4 })),
  mergedPrs: [
    {
      prUrl: "https://github.com/Ivy-Interactive/Ivy-Tendril/pull/402",
      planId: 412,
      title: "Port the Pull Requests dashboard view",
      repo: "D:\\Repos\\_Ivy\\Ivy-Tendril-V2",
      updated: "2026-09-21 16:40",
    },
    {
      prUrl: "https://github.com/Ivy-Interactive/Ivy-Tendril/pull/398",
      planId: 409,
      title: "Split the connected dialogs into presentational components",
      repo: null,
      updated: "2026-09-19 10:02",
    },
  ],
  planCosts: [
    {
      planId: 412,
      title: "Port the Pull Requests dashboard view",
      state: "Completed",
      created: `${iso(1)} 09:14`,
      cost: 4.18,
      tokens: 2_140_331,
    },
    {
      planId: 411,
      title: "Repair corrupt plan YAML",
      state: "Failed",
      created: `${iso(2)} 13:40`,
      cost: null,
      tokens: 88_120,
    },
    {
      planId: 410,
      title: "Port projects plans reference",
      state: "Review",
      created: `${iso(4)} 08:02`,
      cost: 2.51,
      tokens: 1_020_004,
    },
  ],
  agentCosts: [
    { agent: "claude", cost: 402.18, tokens: 61_000_000, planCount: 38 },
    { agent: "codex", cost: 121.4, tokens: 22_500_000, planCount: 11 },
    { agent: "Unknown", cost: 71.2, tokens: 9_800_000, planCount: 0 },
  ],
};

const EMPTY: KpiBreakdownData = {
  today: TODAY,
  activity: null,
  shippedFeatures: [],
  mergedPrs: [],
  planCosts: [],
  agentCosts: [],
};

/**
 * The Dashboard's KPI drill-down: V1's `Apps/Views/Sheets/KpiBreakdownSheet.cs`, one panel per
 * clickable card. One story per KPI, each with a trigger standing in for its card.
 *
 * The sheet takes the analytics the Dashboard already holds and does the window arithmetic itself,
 * as V1's sheet does. `today` is pinned to 2026-09-22 so the windows are stable. An unpriced cost is
 * an em dash, never $0.00 (the Avg Cost / Plan story has one).
 */
const meta: Meta<typeof KpiBreakdownSheet> = {
  title: "Sheets/KpiBreakdownSheet",
  component: KpiBreakdownSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof KpiBreakdownSheet>;

function Trigger({
  kpiId,
  label,
  data,
}: {
  kpiId: KpiBreakdownId;
  label: string;
  data: KpiBreakdownData;
}) {
  const [open, setOpen] = React.useState<string | null>(kpiId);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setOpen(kpiId)} data-testid="kpi-story-trigger">
        {label}
      </Button>
      <KpiBreakdownSheet kpiId={open} data={data} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Features shipped: the count, the per-day table and the merged PRs behind it. */
export const FeaturesShipped: Story = {
  render: () => <Trigger kpiId="featuresShipped" label="Features Shipped" data={DATA} />,
};

/** Cost per feature: spend over features, both windows, and the per-agent split. */
export const CostPerFeature: Story = {
  render: () => <Trigger kpiId="costPerFeature" label="Avg Cost / Feature" data={DATA} />,
};

/**
 * The month's forecast: both projection bases, the month-to-date split with the unattributed
 * remainder, the daily table and its incomplete-split note, and the per-agent split.
 */
export const ForecastMonth: Story = {
  render: () => <Trigger kpiId="forecastMonth" label="Forecast This Month" data={DATA} />,
};

/** Average cost per plan, with one unpriced plan that must read as a dash. */
export const AvgCostPlan: Story = {
  render: () => <Trigger kpiId="avgCostPlan" label="Avg Cost / Plan" data={DATA} />,
};

/** No analytics at all: every panel's empty notes, and the forecast's "no data" panel. */
export const ForecastWithoutData: Story = {
  render: () => <Trigger kpiId="forecastMonth" label="Forecast This Month" data={EMPTY} />,
};

/** Features shipped with nothing merged in the window. */
export const FeaturesShippedEmpty: Story = {
  render: () => <Trigger kpiId="featuresShipped" label="Features Shipped" data={EMPTY} />,
};
