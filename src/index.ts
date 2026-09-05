export function fn() {
  return "Hello, tsdown!";
}

// Components
export {
  TendrilDashboard,
  ActivityGrid,
  PillBars,
  TrendChart,
  HoverTip,
  useHoverTip,
  hasSlotContent,
  rampLevel,
  niceTicks,
  formatCurrencyTick,
  formatCountTick,
} from "./components/TendrilDashboard/index.ts";
export type {
  DashboardKpiDto,
  DashboardMonthValueDto,
  DashboardActivityMonthDto,
  DashboardJobDto,
  DashboardTrendDto,
  TendrilDashboardProps,
  IvyEventHandler,
} from "./components/TendrilDashboard/index.ts";

export { WebViewer } from "./components/WebViewer/index.ts";
export type { WebViewerProps } from "./components/WebViewer/index.ts";
