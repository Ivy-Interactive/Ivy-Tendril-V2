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
import { CATEGORY_DATA, FUNNEL_DATA, RADAR_DATA } from "../src/stories/chart-harness";

interface Series {
  name?: string;
  type?: string;
  data?: unknown;
  stack?: string;
  itemStyle?: Record<string, unknown>;
  emphasis?: { itemStyle?: Record<string, unknown> };
}

/** A pie or funnel slice, after the component has resolved its value and label columns. */
interface Slice {
  value?: unknown;
  name?: unknown;
}

interface Axis {
  show?: boolean;
  type?: string;
  data?: unknown[];
  axisLabel?: { color?: string; fontFamily?: string };
}

interface ChartOption {
  color?: string[];
  radar?: { indicator?: { name?: string }[] };
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

  /**
   * `PieChart` and `FunnelChart` resolve their value and label columns from the first `pies`/
   * `funnels` entry, falling back to `dimension` and `measure`. Give them neither and every slice
   * resolves to `undefined` — echarts then paints nothing at all rather than raising, so this is a
   * failure mode that a "does it render" test cannot see. Three of the chart stories shipped blank
   * for exactly this reason before the screenshots caught it.
   */
  describe("dimension and measure column resolution", () => {
    const DIMENSION_DATA = [
      { dimension: "Direct", measure: 4200 },
      { dimension: "Organic", measure: 3100 },
    ];
    const CUSTOM_KEY_DATA = [
      { channel: "Direct", sessions: 4200 },
      { channel: "Organic", sessions: 3100 },
    ];

    const slicesOf = (option: ChartOption): Slice[] => {
      const [first] = seriesOf(option);
      expect(Array.isArray(first?.data)).toBe(true);
      return first.data as Slice[];
    };

    it("PieChart falls back to the dimension and measure columns", () => {
      expect(slicesOf(optionFor(<PieChart data={DIMENSION_DATA} />))).toEqual([
        { value: 4200, name: "Direct" },
        { value: 3100, name: "Organic" },
      ]);
    });

    it("PieChart honours an explicit dataKey and nameKey", () => {
      const option = optionFor(
        <PieChart data={CUSTOM_KEY_DATA} pies={[{ dataKey: "sessions", nameKey: "channel" }]} />,
      );

      expect(slicesOf(option)).toEqual([
        { value: 4200, name: "Direct" },
        { value: 3100, name: "Organic" },
      ]);
    });

    it("FunnelChart falls back to the dimension and measure columns", () => {
      const slices = slicesOf(optionFor(<FunnelChart data={DIMENSION_DATA} />));

      expect(slices.map((slice) => slice.name)).toEqual(["Direct", "Organic"]);
      expect(slices.map((slice) => slice.value)).toEqual([4200, 3100]);
    });

    it("FunnelChart honours an explicit dataKey and nameKey", () => {
      const slices = slicesOf(
        optionFor(
          <FunnelChart
            data={CUSTOM_KEY_DATA}
            funnels={[{ dataKey: "sessions", nameKey: "channel" }]}
          />,
        ),
      );

      expect(slices.map((slice) => slice.name)).toEqual(["Direct", "Organic"]);
      expect(slices.map((slice) => slice.value)).toEqual([4200, 3100]);
    });

    it("leaves a pie slice unresolved when neither the config nor the columns match", () => {
      // The negative case, so the four assertions above cannot pass for the wrong reason.
      expect(slicesOf(optionFor(<PieChart data={CUSTOM_KEY_DATA} />))).toEqual([
        { value: undefined, name: undefined },
        { value: undefined, name: undefined },
      ]);
    });
  });

  /**
   * `RadarChart` inverts the usual layout: one axis per numeric column, one ring per row. A radar
   * with two axes is drawn by echarts as a bare line, so the indicator count is the thing to pin.
   */
  /**
   * The same guard aimed at the story fixtures themselves, since those are what the visual
   * baselines are rendered from and a blank canvas is a passing screenshot.
   */
  describe("story fixtures resolve to real slices", () => {
    it("CATEGORY_DATA drives a pie with a label and a value per slice", () => {
      const [series] = seriesOf(optionFor(<PieChart data={CATEGORY_DATA} />));
      const slices = series.data as Slice[];

      expect(slices).toHaveLength(CATEGORY_DATA.length);
      for (const slice of slices) {
        expect(typeof slice.name).toBe("string");
        expect(typeof slice.value).toBe("number");
      }
    });

    it("FUNNEL_DATA drives a funnel with a label and a value per stage", () => {
      const [series] = seriesOf(optionFor(<FunnelChart data={FUNNEL_DATA} />));
      const slices = series.data as Slice[];

      expect(slices).toHaveLength(FUNNEL_DATA.length);
      for (const slice of slices) {
        expect(typeof slice.name).toBe("string");
        expect(typeof slice.value).toBe("number");
      }
    });

    it("RADAR_DATA gives the radar enough axes to be a polygon", () => {
      const option = optionFor(<RadarChart data={RADAR_DATA} />);

      expect(option.radar?.indicator?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("RadarChart axes", () => {
    it("derives one indicator per numeric column and one ring per row", () => {
      const option = optionFor(
        <RadarChart
          data={[
            { name: "Current", speed: 82, reliability: 91, coverage: 68 },
            { name: "Target", speed: 95, reliability: 98, coverage: 90 },
          ]}
        />,
      );

      expect(option.radar?.indicator?.map((i) => i.name)).toEqual([
        "speed",
        "reliability",
        "coverage",
      ]);

      const [series] = seriesOf(option);
      expect(series.data).toEqual([
        { value: [82, 91, 68], name: "Current" },
        { value: [95, 98, 90], name: "Target" },
      ]);
    });

    it("collapses to two indicators when the rows carry only two measures", () => {
      const option = optionFor(<RadarChart data={[{ axis: "Speed", current: 82, target: 95 }]} />);

      expect(option.radar?.indicator).toHaveLength(2);
    });
  });
});
