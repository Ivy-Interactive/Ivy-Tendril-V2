import { describe, expect, it } from "vitest";
import * as Charts from "../src/charts";
import * as UI from "../src/index";
import * as Renderers from "../src/renderers";
import * as Tendril from "../src/tendril";

/**
 * echarts is roughly a megabyte, so the charts live on `./charts` and nowhere else — the same rule
 * the diagram renderers follow. `./ui` also used to re-export a dead shadcn `chart.tsx` stub whose
 * components all returned `null`; the regression block below keeps it from coming back.
 */

const CHART_NAMES = [
  "AreaChart",
  "BarChart",
  "ChordChart",
  "FunnelChart",
  "GaugeChart",
  "LineChart",
  "PieChart",
  "RadarChart",
  "SankeyChart",
  "ScatterChart",
] as const;

/** The shadcn stub's exports. None of these ever rendered anything. */
const REMOVED_STUB_NAMES = [
  "ChartContainer",
  "ChartTooltip",
  "ChartTooltipContent",
  "ChartLegend",
  "ChartLegendContent",
  "ChartStyle",
  "ChartConfig",
] as const;

describe("charts export", () => {
  it("exports all ten charts from the charts entrypoint", () => {
    for (const name of CHART_NAMES) {
      expect(Charts, name).toHaveProperty(name);
      expect(typeof Charts[name], name).toBe("function");
    }
  });

  it("exports the chart colour helpers from the charts entrypoint", () => {
    expect(Charts.getChartColors).toBeTypeOf("function");
    expect(Charts.getChartThemeColors).toBeTypeOf("function");
    expect(Charts.generateGradientColors).toBeTypeOf("function");
    expect(Charts.ChartType).toBeDefined();
  });

  it("does NOT export any chart from the main entrypoint", () => {
    for (const name of CHART_NAMES) {
      expect(name in UI, name).toBe(false);
    }
  });

  it("does NOT export any chart from the renderers entrypoint", () => {
    for (const name of CHART_NAMES) {
      expect(name in Renderers, name).toBe(false);
    }
  });

  it("does NOT export any chart from the tendril entrypoint", () => {
    for (const name of CHART_NAMES) {
      expect(name in Tendril, name).toBe(false);
    }
  });

  describe("the dead shadcn chart stub", () => {
    it("is gone from the main entrypoint", () => {
      for (const name of REMOVED_STUB_NAMES) {
        expect(name in UI, name).toBe(false);
      }
    });

    it("is gone from the renderers and tendril entrypoints", () => {
      for (const name of REMOVED_STUB_NAMES) {
        expect(name in Renderers, name).toBe(false);
        expect(name in Tendril, name).toBe(false);
      }
    });

    it("was not reintroduced on the charts entrypoint either", () => {
      for (const name of REMOVED_STUB_NAMES) {
        expect(name in Charts, name).toBe(false);
      }
    });
  });
});
