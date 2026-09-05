export { cn } from "./lib/utils.ts";
export {
  ThemeContext,
  useTheme,
  type Theme,
  type ThemeContextType,
} from "./contexts/theme-context.tsx";
export { ThemeProvider, type ThemeProviderProps } from "./components/theme-provider.tsx";

// Agent & Execution Visualizers
export {
  AgentViewer,
  ToolUseCard,
  ToolUseGroup,
  AnimatedStatus,
  ResultSummary,
  inputSummary,
  parseEventWireStream,
  groupToolUseEvents,
  aggregateToolStatus,
  deriveStatus,
  useAutoScroll,
  type EventHandler,
  type PresentationEvent,
  type ToolUsePresentation,
  type EventWire,
  type SessionInitWire,
  type TextWire,
  type ThinkingWire,
  type ToolCallWire,
  type ToolResultWire,
  type ResultWire,
  type UsageWire,
  type ErrorWire,
  type FileChangeWire,
  type PermissionRequestWire,
  type PermissionDenialWire,
  type UserQuestionWire,
} from "./components/AgentViewer/index.ts";

// Tendril Process Pipeline Viewer
export {
  TendrilProcessViewer,
  type IvyEventHandler,
  type TendrilProcessViewerProps,
} from "./components/TendrilProcessViewer/index.ts";

export function fn() {
  return "Hello, tsdown!";
}
