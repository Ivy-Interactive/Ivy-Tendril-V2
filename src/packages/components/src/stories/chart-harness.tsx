import type { Decorator } from "@storybook/react";
import { readStoryGlobals } from "../../.storybook/globals";
import { ThemeProvider } from "@/components/theme-provider";
import type { ChartData, ChordData, SankeyData } from "@/components/charts/chartTypes";

/**
 * Shared scaffolding for the chart stories.
 *
 * Two things every chart story needs. First a `ThemeProvider`: the charts read their colours through
 * `useThemeWithMonitoring`, which throws outside one, and `preview.tsx` applies the theme as a
 * wrapper class rather than a provider. Second a sized box: the charts default to `height="Full"`,
 * and echarts measures its container, so an auto-height parent renders a zero-pixel canvas.
 */

/**
 * Wraps a story in a `ThemeProvider` that follows the Storybook `theme` toolbar global, inside a
 * fixed-size frame.
 *
 * The provider gets its own `storageKey`. `ThemeProvider` seeds from `localStorage` before falling
 * back to `defaultTheme`, so sharing `"ui-theme"` would let whichever story ran first pin the theme
 * for the rest of the session — including the theme-provider stories, which write that key.
 */
export const chartDecorator: Decorator = (Story, context) => {
  const { theme = "light" } = readStoryGlobals(context);

  return (
    <ThemeProvider defaultTheme={theme} storageKey={`chart-story-theme-${theme}`}>
      <div style={{ width: 640, height: 320 }}>
        <Story />
      </div>
    </ThemeProvider>
  );
};

/**
 * Parameters shared by every chart story. echarts paints asynchronously and sets
 * `data-chart-rendered="true"` from `onChartReady`, so the screenshot waits on that marker rather
 * than on a guessed delay.
 */
export const chartParameters = {
  visual: {
    waitForSelector: '[data-chart-rendered="true"]',
    settleDelay: 1000,
  },
};

/** A tidy three-measure monthly series, used by the cartesian charts. */
export const MONTHLY_DATA: ChartData[] = [
  { month: "Jan", revenue: 4200, costs: 2400, profit: 1800 },
  { month: "Feb", revenue: 4800, costs: 2600, profit: 2200 },
  { month: "Mar", revenue: 5400, costs: 2900, profit: 2500 },
  { month: "Apr", revenue: 5100, costs: 3100, profit: 2000 },
  { month: "May", revenue: 6300, costs: 3300, profit: 3000 },
  { month: "Jun", revenue: 7100, costs: 3500, profit: 3600 },
];

/** A single-measure categorical series, for the charts that show one value per slice. */
export const CATEGORY_DATA: ChartData[] = [
  { category: "Direct", value: 4200 },
  { category: "Organic", value: 3100 },
  { category: "Referral", value: 2200 },
  { category: "Social", value: 1400 },
  { category: "Email", value: 900 },
];

/** Correlated x/y pairs for the scatter chart. */
export const SCATTER_DATA: ChartData[] = [
  { weight: 1.2, height: 3.4 },
  { weight: 2.1, height: 4.1 },
  { weight: 2.8, height: 5.6 },
  { weight: 3.6, height: 5.2 },
  { weight: 4.4, height: 7.1 },
  { weight: 5.0, height: 6.8 },
  { weight: 5.9, height: 8.4 },
];

/** Per-axis scores for the radar chart. */
export const RADAR_DATA: ChartData[] = [
  { axis: "Speed", current: 82, target: 95 },
  { axis: "Reliability", current: 91, target: 98 },
  { axis: "Coverage", current: 68, target: 90 },
  { axis: "Cost", current: 74, target: 60 },
  { axis: "Support", current: 88, target: 92 },
];

/** A staged conversion funnel. */
export const FUNNEL_DATA: ChartData[] = [
  { stage: "Visited", count: 12000 },
  { stage: "Signed up", count: 5400 },
  { stage: "Activated", count: 3100 },
  { stage: "Subscribed", count: 1200 },
  { stage: "Renewed", count: 740 },
];

/** A flow graph for the sankey chart. */
export const SANKEY_DATA: SankeyData = {
  nodes: [
    { name: "Search" },
    { name: "Social" },
    { name: "Landing" },
    { name: "Signup" },
    { name: "Churn" },
  ],
  links: [
    { source: 0, target: 2, value: 60 },
    { source: 1, target: 2, value: 30 },
    { source: 2, target: 3, value: 55 },
    { source: 2, target: 4, value: 35 },
  ],
};

/** A symmetric relationship matrix for the chord chart. */
export const CHORD_DATA: ChordData = {
  nodes: [{ name: "Web" }, { name: "API" }, { name: "Worker" }, { name: "Database" }],
  links: [
    { source: 0, target: 1, value: 40 },
    { source: 1, target: 3, value: 32 },
    { source: 2, target: 3, value: 18 },
    { source: 1, target: 2, value: 12 },
  ],
};
