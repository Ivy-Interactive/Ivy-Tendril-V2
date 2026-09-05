// Styles
import "./styles/globals.css";

// Utilities & Helpers
export * from "./lib/utils";
export * from "./lib/formatters";
export * from "./lib/logger";

// Types
export * from "./types/density";

// Hooks
export * from "./hooks/use-mobile";
export * from "./hooks/use-toast";

// Theme
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

// Density Scales
export * from "./components/ui/density-scale";

// Primitives
export * from "./components/ui/accordion";
export * from "./components/ui/alert";
export * from "./components/ui/alert-dialog";
export * from "./components/ui/avatar";
export * from "./components/ui/badge";
export * from "./components/ui/button";
export * from "./components/ui/calendar";
export * from "./components/ui/card";
export * from "./components/ui/chart";
export * from "./components/ui/checkbox";
export * from "./components/ui/collapsible";
export * from "./components/ui/command";
export * from "./components/ui/context-menu";
export * from "./components/ui/detail.tsx";
export * as DetailVariants from "./components/ui/detail/index";
export * from "./components/ui/dialog";
export * from "./components/ui/dropdown-menu";
export * as ExpandableVariants from "./components/ui/expandable/index";
export * from "./components/ui/form";
export * from "./components/ui/input.tsx";
export * as InputVariants from "./components/ui/input/index";
export * from "./components/ui/label";
export * from "./components/ui/menubar";
export * from "./components/ui/multiselect";
export * from "./components/ui/pagination";
export * from "./components/ui/pagination-variant";
export * from "./components/ui/popover";
export * from "./components/ui/progress";
export * from "./components/ui/radio-group";
export * from "./components/ui/resizable";
export * from "./components/ui/scroll-area";
export * from "./components/ui/select.tsx";
export * as SelectVariants from "./components/ui/select/index";
export * from "./components/ui/separator";
export * from "./components/ui/sheet";
export * from "./components/ui/sidebar";
export * from "./components/ui/skeleton";
export * from "./components/ui/slider";
export * from "./components/ui/stepper";
export * from "./components/ui/switch";
export * from "./components/ui/table.tsx";
export * as TableVariants from "./components/ui/table/index";
export * from "./components/ui/tabs";
export * from "./components/ui/textarea";
export * from "./components/ui/toast";
export * from "./components/ui/toaster";
export * from "./components/ui/toggle";
export * from "./components/ui/tooltip";

// Shell
export {
  TendrilShell,
  ShellNav,
  ShellTabs,
  ShellAgentButton,
  ShellNewPlanButton,
  ShellSettingsButton,
  ShellSidebarHeader,
  ShellSidebarSection,
  ShellContext,
  useShell,
  BrandIcon,
  brandIcons,
  type ShellContextValue,
  type IvyEventHandler,
  type ShellBadgeDto,
  type ShellNavItemDto,
  type ShellSectionItemDto,
  type ShellTabDto,
  type ShellWidgetProps,
} from "./components/Shell/index.ts";

export function fn() {
  return "Hello, tsdown!";
}

// Components
export { ContentInput } from "./components/ContentInput/index.ts";
export type {
  ContentInputProps,
  AttachedFile,
  VoiceStatus,
  VoiceRecorderOptions,
} from "./components/ContentInput/index.ts";
export { VoiceRecorder } from "./components/ContentInput/index.ts";

export { BadgeSelect } from "./components/BadgeSelect/index.ts";
export type { BadgeSelectOption, BadgeSelectProps } from "./components/BadgeSelect/index.ts";

export { SortableVerificationList } from "./components/SortableVerificationList/index.ts";
export type {
  VerificationItem,
  SortableVerificationListProps,
} from "./components/SortableVerificationList/index.ts";
