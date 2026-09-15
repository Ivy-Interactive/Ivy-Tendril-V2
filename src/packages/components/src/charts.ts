/**
 * Charts entry point.
 *
 * echarts is around a megabyte, so the chart components live on their own subpath rather than
 * on `./ui` — importing a button must not pull a charting engine into the entry chunk. The same
 * rule the diagram renderers follow.
 */

export { AreaChart } from "./components/charts/AreaChart";
export { BarChart } from "./components/charts/BarChart";
export { ChordChart } from "./components/charts/ChordChart";
export { FunnelChart } from "./components/charts/FunnelChart";
export { GaugeChart } from "./components/charts/GaugeChart";
export { LineChart } from "./components/charts/LineChart";
export { PieChart } from "./components/charts/PieChart";
export { RadarChart } from "./components/charts/RadarChart";
export { SankeyChart } from "./components/charts/SankeyChart";
export { ScatterChart } from "./components/charts/ScatterChart";

export type { AreaChartProps } from "./components/charts/AreaChart";
export type { BarChartProps } from "./components/charts/BarChart";

export { ChartType } from "./components/charts/chartTypes";
export type {
  BarProps,
  CartesianGridProps,
  ChartData,
  ChordChartProps,
  ChordData,
  ChordLink,
  ChordNode,
  ColorScheme,
  FunnelChartProps,
  FunnelProps,
  GaugeChartProps,
  GaugePointerProps,
  GaugeThresholdProps,
  LegendProps,
  LineChartProps,
  LinesProps,
  MarkArea,
  MarkLine,
  PieChartProps,
  PieLegendProps,
  PieProps,
  PolarAngleAxisProps,
  PolarGridProps,
  PolarGridTypes,
  PolarRadiusAxisProps,
  RadarChartProps,
  RadarIndicatorProps,
  RadarProps,
  ReferenceDot,
  SankeyAlign,
  SankeyChartProps,
  SankeyData,
  SankeyLink,
  SankeyNode,
  ScatterChartProps,
  ScatterLineType,
  ScatterProps,
  ScatterShape,
  ToolTipProps,
  ToolboxFeatures,
  ToolboxProps,
  XAxisProps,
  YAxisProps,
  ZAxisProps,
} from "./components/charts/chartTypes";

export type { ChartThemeColors } from "./components/charts/styles";
export {
  generateGradientColors,
  getChartColors,
  getChartThemeColors,
} from "./components/charts/styles";
