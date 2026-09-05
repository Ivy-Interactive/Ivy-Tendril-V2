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

// Density
export {
  DensityContext,
  DensityProvider,
  useDensity,
  type DensityContextValue,
  type DensityProviderProps,
} from "./contexts/density-context.tsx";

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

// Presentation & UI
export { Icon, type IconProps } from "./components/Icon";
export { InvalidIcon, type InvalidIconProps } from "./components/InvalidIcon";
export { IvyLogo, type IvyLogoProps } from "./components/IvyLogo";
export { Kbd, ShortcutKeys, type KbdProps, type ShortcutKeysProps } from "./components/Kbd";
export {
  Loading,
  Spinner,
  SkeletonList,
  type LoadingProps,
  type SpinnerProps,
  type SkeletonListProps,
} from "./components/Loading";
export { LoadingScreen, type LoadingScreenProps } from "./components/LoadingScreen";
export { LogoLoading, type LogoLoadingProps } from "./components/LogoLoading";
export { TextShimmer, type TextShimmerProps } from "./components/TextShimmer";
export {
  CopyToClipboardButton,
  type CopyToClipboardButtonProps,
} from "./components/CopyToClipboardButton";
export { EmojiRating, type EmojiRatingProps } from "./components/EmojiRating";
export { StarRating, type StarRatingProps } from "./components/StarRating";
export { NumberInput, type NumberInputProps } from "./components/NumberInput";
export { MadeWithIvy, type MadeWithIvyProps } from "./components/MadeWithIvy";

// Rich Content Renderers
export {
  MarkdownRenderer,
  normalizeNestedFences,
  type MarkdownRendererProps,
} from "./components/MarkdownRenderer";
export { MermaidRenderer, type MermaidRendererProps } from "./components/MermaidRenderer";
export { GraphvizRenderer, type GraphvizRendererProps } from "./components/GraphvizRenderer";
export { JsonRenderer, type JsonRendererProps } from "./components/JsonRenderer";
export { XmlRenderer, type XmlRendererProps } from "./components/XmlRenderer";
export { HtmlRenderer, type HtmlRendererProps } from "./components/HtmlRenderer";

// Chat & Feedback
export {
  ChatBubble,
  ChatBubbleMessage,
  ChatBubbleAction,
  ChatBubbleActionWrapper,
  type ChatBubbleProps,
  type ChatBubbleMessageProps,
  type ChatBubbleActionProps,
  type ChatBubbleActionWrapperProps,
} from "./components/ChatBubble";
export { ChatInput, type ChatInputProps } from "./components/ChatInput";
export { ChatMessageList, type ChatMessageListProps } from "./components/ChatMessageList";
export { MessageLoading } from "./components/MessageLoading";

// Diagnostics & Errors
export { DevTools, type WidgetInfo } from "./components/DevTools";
export {
  ErrorBoundary,
  type ErrorBoundaryProps,
  type ErrorBoundaryState,
} from "./components/ErrorBoundary";
export { ErrorDisplay, type ErrorDisplayProps } from "./components/ErrorDisplay";
export { ErrorSheet } from "./components/ErrorSheet";
export { useErrorSheet, showError, type ErrorItem } from "./hooks/use-error-sheet";

// Supporting Utilities & Contexts
export { copyToClipboard } from "./lib/clipboard";
export { getPlatformShortcut, formatShortcut } from "./lib/shortcut";
export { TypographyContext, useTypography } from "./contexts/TypographyContext";
export { widgetCallSiteRegistry, type CallSite } from "./types/widgets";

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
  type ShellBadgeDto,
  type ShellNavItemDto,
  type ShellSectionItemDto,
  type ShellTabDto,
  type ShellWidgetProps,
} from "./components/Shell/index.ts";

export function fn() {
  return "Hello, tsdown!";
}

// Plan Markdown components and sub-components
export {
  PlanMarkdown,
  DraftMarkdown,
  AlertBlockquote,
  AnnotationPopover,
  AddAnnotationPopover,
  EditAnnotationPopover,
  SelectionToolbar,
  QuestionsCallout,
  SearchOverlay,
  BlockHandler,
  CodeBlock,
  ImageRenderer,
} from "./components/PlanMarkdown";

export type {
  MarkdownAnnotation,
  AnswerCallback,
  QuestionsAnswerContextType,
  PlanQuestion,
  QuestionOption,
  QuestionsBlock,
  ParsedQuestions,
} from "./components/PlanMarkdown";

export {
  parseQuestions,
  tagQuestionBlocks,
  getMarkdownPlugins,
  hasMath,
  prismTheme,
  normalizeLanguage,
  codeBlockPreStyle,
  rawHtmlSchema,
  hasRawHtml,
  getWidth,
  getHeight,
} from "./components/PlanMarkdown";

// Plan Diff components
export {
  PlanDiffView,
  getLanguageFromFilePath,
  useIsNarrow,
  NARROW_BREAKPOINT,
} from "./components/PlanDiffView";

export type { PlanDiffViewProps, DraftComment } from "./components/PlanDiffView";

// Inputs & Form Controls
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

// Tendril Dashboard components
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
} from "./components/TendrilDashboard/index.ts";

// Web Viewer component
export { WebViewer } from "./components/WebViewer/index.ts";
export type { WebViewerProps } from "./components/WebViewer/index.ts";
