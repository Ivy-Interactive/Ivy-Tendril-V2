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

/**
 * A single-measure categorical series, for the charts that show one value per slice.
 *
 * The columns are `dimension` and `measure` because that is the pair `PieChart` and `FunnelChart`
 * fall back to when no `pies`/`funnels` entry names a `dataKey` and `nameKey`. Hand them
 * differently named columns with no config and every slice resolves to `undefined`: an empty
 * canvas, not an error. `CATEGORY_DATA_CUSTOM_KEYS` covers the other half of that contract.
 */
export const CATEGORY_DATA: ChartData[] = [
  { dimension: "Direct", measure: 4200 },
  { dimension: "Organic", measure: 3100 },
  { dimension: "Referral", measure: 2200 },
  { dimension: "Social", measure: 1400 },
  { dimension: "Email", measure: 900 },
];

/** The same series under arbitrary column names, for the stories that remap them explicitly. */
export const CATEGORY_DATA_CUSTOM_KEYS: ChartData[] = [
  { channel: "Direct", sessions: 4200 },
  { channel: "Organic", sessions: 3100 },
  { channel: "Referral", sessions: 2200 },
  { channel: "Social", sessions: 1400 },
  { channel: "Email", sessions: 900 },
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

/**
 * Scores for the radar chart, one row per series.
 *
 * `RadarChart` inverts the usual layout: each numeric column becomes an axis and each row becomes a
 * ring, labelled from the row's `name`. Laying it out the other way round — a label column plus two
 * measures — yields a two-axis radar, which echarts draws as a bare line.
 */
export const RADAR_DATA: ChartData[] = [
  { name: "Current", speed: 82, reliability: 91, coverage: 68, cost: 74, support: 88 },
  { name: "Target", speed: 95, reliability: 98, coverage: 90, cost: 60, support: 92 },
];

/** A staged conversion funnel, keyed like `CATEGORY_DATA` for the same reason. */
export const FUNNEL_DATA: ChartData[] = [
  { dimension: "Visited", measure: 12000 },
  { dimension: "Signed up", measure: 5400 },
  { dimension: "Activated", measure: 3100 },
  { dimension: "Subscribed", measure: 1200 },
  { dimension: "Renewed", measure: 740 },
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
