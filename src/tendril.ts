// Tendril Entrypoint for components-storybook/tendril
// Re-exports Tendril shell, agent viewers, inputs, plan widgets, and dashboard components

// Shell Components
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

// Plan Markdown Components & Sub-components
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

export { GraphvizRenderer } from "./components/PlanMarkdown/GraphvizRenderer";
export { MermaidRenderer } from "./components/PlanMarkdown/MermaidRenderer";

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
  prismTheme,
  normalizeLanguage,
  codeBlockPreStyle,
} from "./components/PlanMarkdown";

export { getMarkdownPlugins, hasMath } from "./lib/math";
export { rawHtmlSchema, hasRawHtml } from "./lib/rawHtml";
export { getWidth, getHeight } from "./lib/styles";

// Plan Diff Components
export {
  PlanDiffView,
  getLanguageFromFilePath,
  useIsNarrow,
  NARROW_BREAKPOINT,
} from "./components/PlanDiffView";

export type { PlanDiffViewProps, DraftComment } from "./components/PlanDiffView";

// Tendril Dashboard Components
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

// Web Viewer Component
export { WebViewer } from "./components/WebViewer/index.ts";
export type { WebViewerProps } from "./components/WebViewer/index.ts";
