import { resolve } from "node:path";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readCssInlined } from "./read-css";

/**
 * The charts hand echarts a single `option` object; everything the port has to get right — resolved
 * theme colours, axis wiring, series mapping, the colour scheme — lives in there. echarts itself
 * needs a canvas, which jsdom does not have, so these tests stub `echarts-for-react` and assert on
 * the option each component builds.
 */

const captured = vi.hoisted(() => [] as ChartOption[]);

vi.mock("echarts-for-react", () => ({
  default: (props: { option: ChartOption }) => {
    captured.push(props.option);
    return <div data-testid="echarts" />;
  },
}));

import { ThemeProvider } from "../src/components/theme-provider";
import {
  AreaChart,
  BarChart,
  ChordChart,
  FunnelChart,
  GaugeChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
} from "../src/charts";
import { getThemeColors } from "../src/lib/theme";
import { getChartColors } from "../src/components/charts/styles";

interface Series {
  name?: string;
  type?: string;
  data?: unknown;
  stack?: string;
  itemStyle?: Record<string, unknown>;
  emphasis?: { itemStyle?: Record<string, unknown> };
}

interface Axis {
  show?: boolean;
  type?: string;
  data?: unknown[];
  axisLabel?: { color?: string; fontFamily?: string };
}

interface ChartOption {
  color?: string[];
  series?: Series[] | Series;
  xAxis?: Axis;
  yAxis?: Axis;
  legend?: { show?: boolean; textStyle?: { color?: string; fontFamily?: string } };
  tooltip?: {
    trigger?: string;
    backgroundColor?: string;
    textStyle?: { color?: string; fontFamily?: string };
    formatter?: unknown;
  };
  textStyle?: { color?: string; fontFamily?: string; fontSize?: number };
  radar?: unknown;
  [key: string]: unknown;
}

const DATA = [
  { month: "Jan", sales: 10, costs: 4 },
  { month: "Feb", sales: 20, costs: 8 },
  { month: "Mar", sales: 15, costs: 6 },
];

/** Renders inside a ThemeProvider and returns the option the chart passed to echarts. */
function optionFor(element: ReactElement): ChartOption {
  const before = captured.length;
  render(<ThemeProvider>{element}</ThemeProvider>);
  expect(captured.length).toBeGreaterThan(before);
  return captured[captured.length - 1];
}

function seriesOf(option: ChartOption): Series[] {
  const { series } = option;
  return Array.isArray(series) ? series : series ? [series] : [];
}

let stylesheet: HTMLStyleElement;

beforeAll(() => {
  // ThemeProvider reads the system preference; jsdom has no matchMedia.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  stylesheet = document.createElement("style");
  stylesheet.textContent = readCssInlined(
    resolve(import.meta.dirname, "../src/styles/globals.css"),
  );
  document.head.appendChild(stylesheet);
});

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("chart options", () => {
  describe("LineChart", () => {
    it("builds one line series per numeric column", () => {
      const series = seriesOf(optionFor(<LineChart data={DATA} />));

      expect(series).toHaveLength(2);
      expect(series.map((s) => s.name)).toEqual(["sales", "costs"]);
      expect(series.map((s) => s.type)).toEqual(["line", "line"]);
      expect(series[0].data).toEqual([10, 20, 15]);
      expect(series[1].data).toEqual([4, 8, 6]);
    });

    it("puts the string column on a category x axis and values on a value y axis", () => {
      const option = optionFor(<LineChart data={DATA} />);

      expect(option.xAxis?.type).toBe("category");
      expect(option.xAxis?.data).toEqual(["Jan", "Feb", "Mar"]);
      expect(option.yAxis?.type).toBe("value");
    });

    it("respects only the configured data keys", () => {
      const series = seriesOf(
        optionFor(<LineChart data={DATA} lines={[{ dataKey: "sales", name: "Sales" }]} />),
      );

      expect(series).toHaveLength(1);
      expect(series[0].name).toBe("Sales");
    });

    it("hands echarts a resolved colour for the emphasis symbol border, not a CSS variable", () => {
      const series = seriesOf(optionFor(<LineChart data={DATA} />));
      const borderColor = series[0].emphasis?.itemStyle?.borderColor;

      expect(borderColor).toBe(getThemeColors().background);
      expect(borderColor).not.toContain("var(");
    });
  });

  describe("colour schemes", () => {
    it("uses the default scheme's resolved values", () => {
      const option = optionFor(<LineChart data={DATA} />);

      expect(option.color).toEqual(getChartColors("Default", getThemeColors()));
      expect(option.color?.[0]).toMatch(/^#[0-9a-f]{3,8}$/i);
    });

    it("uses the rainbow scheme when asked", () => {
      const option = optionFor(<LineChart data={DATA} colorScheme="Rainbow" />);
      const rainbow = getChartColors("Rainbow", getThemeColors());

      expect(option.color).toEqual(rainbow);
      // The rainbow scheme is the wider palette, which is the point of offering it.
      expect(rainbow.length).toBeGreaterThan(getChartColors("Default", getThemeColors()).length);
    });

    it("picks up the dark palette when the dark class is applied", () => {
      const light = optionFor(<LineChart data={DATA} />);
      document.documentElement.classList.add("dark");
      const dark = optionFor(<LineChart data={DATA} />);

      expect(dark.color).not.toEqual(light.color);
      expect(dark.textStyle?.color).not.toBe(light.textStyle?.color);
    });

    it("never emits a CSS custom property anywhere in the option", () => {
      const option = optionFor(<LineChart data={DATA} colorScheme="Rainbow" />);
      const serialised = JSON.stringify(option, (_key, value: unknown) =>
        typeof value === "function" ? undefined : value,
      );

      expect(serialised).not.toContain("var(--");
    });
  });

  describe("typography", () => {
    it("takes the font family from --font-sans", () => {
      const option = optionFor(<LineChart data={DATA} />);
      const fontSans = getComputedStyle(document.documentElement)
        .getPropertyValue("--font-sans")
        .trim();

      expect(fontSans).not.toBe("");
      expect(option.textStyle?.fontFamily).toBe(fontSans);
      expect(option.xAxis?.axisLabel?.fontFamily).toBe(fontSans);
      expect(option.yAxis?.axisLabel?.fontFamily).toBe(fontSans);
    });

    it("takes the text colour from --foreground and axis labels from --muted-foreground", () => {
      const option = optionFor(<LineChart data={DATA} />);
      const colors = getThemeColors();

      expect(option.textStyle?.color).toBe(colors.foreground);
      expect(option.xAxis?.axisLabel?.color).toBe(colors.mutedForeground);
    });
  });

  describe("legend and tooltip", () => {
    it("styles a shown legend from the theme", () => {
      const option = optionFor(<LineChart data={DATA} legend={{ verticalAlign: "Bottom" }} />);
      const colors = getThemeColors();

      expect(option.legend?.show).toBe(true);
      expect(option.legend?.textStyle?.color).toBe(colors.foreground);
      expect(option.legend?.textStyle?.fontFamily).toBe(option.textStyle?.fontFamily);
    });

    // The legend is opt-in by presence of the prop — `LegendProps` carries no `show` flag, so a
    // caller turns it off by omitting the whole object.
    it("hides the legend when no legend prop is given", () => {
      const option = optionFor(
        <BarChart data={DATA} bars={[{ dataKey: "sales", name: "Sales" }]} />,
      );

      expect(option.legend?.show).toBe(false);
    });

    it("shows the legend once the prop is given", () => {
      const option = optionFor(
        <BarChart data={DATA} bars={[{ dataKey: "sales", name: "Sales" }]} legend={{}} />,
      );

      expect(option.legend?.show).toBe(true);
    });

    it("triggers the cartesian tooltip on the axis and paints it with the theme background", () => {
      const option = optionFor(<LineChart data={DATA} tooltip={{ animated: false }} />);

      expect(option.tooltip?.trigger).toBe("axis");
      expect(option.tooltip?.backgroundColor).toBe(getThemeColors().background);
      expect(typeof option.tooltip?.formatter).toBe("function");
    });
  });

  describe("BarChart", () => {
    it("builds bar series for the configured bars", () => {
      const series = seriesOf(
        optionFor(
          <BarChart
            data={DATA}
            bars={[
              { dataKey: "sales", name: "Sales" },
              { dataKey: "costs", name: "Costs" },
            ]}
          />,
        ),
      );

      expect(series.map((s) => s.type)).toEqual(["bar", "bar"]);
      expect(series.map((s) => s.name)).toEqual(["Sales", "Costs"]);
    });

    it("maps stackId onto the echarts stack key", () => {
      const series = seriesOf(
        optionFor(
          <BarChart
            data={DATA}
            bars={[
              { dataKey: "sales", name: "Sales", stackId: "total" },
              { dataKey: "costs", name: "Costs", stackId: "total" },
            ]}
          />,
        ),
      );

      expect(series.map((s) => s.stack)).toEqual(["total", "total"]);
    });

    it("leaves the series unstacked without a stackId", () => {
      const series = seriesOf(
        optionFor(
          <BarChart
            data={DATA}
            bars={[
              { dataKey: "sales", name: "Sales" },
              { dataKey: "costs", name: "Costs" },
            ]}
          />,
        ),
      );

      expect(series.map((s) => s.stack)).toEqual([undefined, undefined]);
    });
  });

  describe("other chart types", () => {
    it("AreaChart emits filled line series", () => {
      const series = seriesOf(optionFor(<AreaChart data={DATA} />));

      expect(series.length).toBeGreaterThan(0);
      expect(series.every((s) => s.type === "line")).toBe(true);
      expect(series[0]).toHaveProperty("areaStyle");
    });

    // A scatter needs both axes bound to a data key; without them it has no coordinates to plot.
    it("ScatterChart emits a scatter series once both axes name a data key", () => {
      const series = seriesOf(
        optionFor(
          <ScatterChart
            data={[
              { x: 1, y: 2 },
              { x: 2, y: 4 },
            ]}
            scatters={[{ dataKey: "y", name: "Points" }]}
            xAxis={[{ dataKey: "x" }]}
            yAxis={[{ dataKey: "y" }]}
          />,
        ),
      );

      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe("scatter");
      expect(series[0].data).toEqual([
        [1, 2],
        [2, 4],
      ]);
    });

    it("PieChart emits a pie series with no cartesian axes", () => {
      const option = optionFor(<PieChart data={DATA} />);
      const series = seriesOf(option);

      expect(series[0].type).toBe("pie");
      expect(option.xAxis).toBeUndefined();
      expect(option.yAxis).toBeUndefined();
    });

    it("FunnelChart emits a funnel series", () => {
      const series = seriesOf(optionFor(<FunnelChart data={DATA} />));

      expect(series[0].type).toBe("funnel");
    });

    it("GaugeChart emits a gauge series", () => {
      const series = seriesOf(optionFor(<GaugeChart value={42} />));

      expect(series[0].type).toBe("gauge");
    });

    it("RadarChart emits a radar series alongside a radar coordinate system", () => {
      const option = optionFor(<RadarChart data={DATA} />);
      const series = seriesOf(option);

      expect(series[0].type).toBe("radar");
      expect(option.radar).toBeDefined();
    });

    it("SankeyChart emits a sankey series from nodes and links", () => {
      const series = seriesOf(
        optionFor(
          <SankeyChart
            data={{
              nodes: [{ name: "A" }, { name: "B" }, { name: "C" }],
              links: [
                { source: 0, target: 1, value: 5 },
                { source: 1, target: 2, value: 3 },
              ],
            }}
          />,
        ),
      );

      expect(series[0].type).toBe("sankey");
    });

    it("ChordChart emits a graph series on a circular layout", () => {
      const series = seriesOf(
        optionFor(
          <ChordChart
            data={{
              nodes: [{ name: "A" }, { name: "B" }],
              links: [{ source: 0, target: 1, value: 7 }],
            }}
          />,
        ),
      );

      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe("graph");
    });
  });

  describe("empty data", () => {
    it("renders without series rather than throwing", () => {
      const option = optionFor(<LineChart />);

      expect(seriesOf(option)).toEqual([]);
    });
  });
});
