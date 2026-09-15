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
  ShellRailFlyout,
  ShellSectionItems,
  ShellTooltip,
  sectionItemIcons,
  formatShortcut,
  type ShellContextValue,
  type ShellBadgeDto,
  type ShellItemState,
  type ShellNavItemDto,
  type ShellSectionItemDto,
  type ShellTabDto,
  type ShellWidgetProps,
  type RailFlyoutTrigger,
} from "./components/Shell/index.ts";

export {
  useResizableSidebar,
  type UseResizableSidebarOptions,
  type UseResizableSidebarReturn,
} from "./hooks/use-resizable-sidebar";

export { getPlatformShortcut } from "./lib/shortcut";
export { useShortcut } from "./lib/useShortcut";
export { getRegisteredShortcuts, type ShortcutInfo } from "./lib/shortcutRegistry";
export { useFocusable, useFocusManagement, type FocusManager } from "./hooks/use-focus-management";

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
  type StatusWire,
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

export type {
  PlanMarkdownProps,
  MarkdownAnnotation,
  AnswerCallback,
  QuestionsAnswerContextType,
  QuestionSubmitCallback,
  QuestionsDraftState,
  QuestionsDraftStore,
  PlanQuestion,
  QuestionOption,
  QuestionsBlock,
  ParsedQuestions,
} from "./components/PlanMarkdown";

export { QuestionsSubmitContext, QuestionsDraftContext } from "./components/PlanMarkdown";

export { prismTheme } from "./lib/prismTheme";
export { parseQuestions, tagQuestionBlocks } from "./components/PlanMarkdown";
export { normalizeLanguage, codeBlockPreStyle } from "./components/PlanMarkdown";

export { getMarkdownPlugins, hasMath } from "./lib/math";
export { rawHtmlSchema, hasRawHtml } from "./lib/rawHtml";
export { getWidth, getHeight } from "./lib/styles";

// Tendril Questions Widgets
export {
  TendrilQuestions,
  QuestionsForm,
  ChatQuestionsBlock,
  DescriptionMarkdown,
  buildAnswersSummary,
  canSubmitAnswers,
  documentAnswers,
  documentOtherOpen,
  entryTitle,
  hasEntries,
  submitNote,
  unansweredRequired,
} from "./components/TendrilQuestions";

export type {
  TendrilQuestionsProps,
  QuestionsFormProps,
  QuestionsSubmitAction,
  AnswerMap,
} from "./components/TendrilQuestions";

// Plan Diff Components
export {
  PlanDiffView,
  getLanguageFromFilePath,
  useIsNarrow,
  NARROW_BREAKPOINT,
  loadLanguage,
  registerLanguageLoader,
  registerLanguageLoaders,
  clearCustomLanguageLoaders,
  useCustomLanguageLoaders,
  customLanguageRegistry,
  customExtensionRegistry,
  registerExtensionMapping,
  registerExtensionMappings,
  clearCustomExtensionMappings,
  useCustomExtensionMappings,
  PlanChangesView,
  buildFileTree,
} from "./components/PlanDiffView";

export type {
  PlanDiffViewProps,
  DraftComment,
  LanguageModule,
  CustomLanguageLoader,
  CustomLanguageDefinition,
  CustomLanguageLoaders,
  CustomExtensionMappings,
  ChangedFile,
  TreeFolder,
  PlanChangesViewProps,
} from "./components/PlanDiffView";

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
export { WebViewer, Toolbar } from "./components/WebViewer/index.ts";
export type { WebViewerProps, ToolbarProps, ToolbarAction } from "./components/WebViewer/index.ts";

// Plan Workspace Split-Pane Layout
export { PlanWorkspace } from "./components/PlanWorkspace/index.ts";
export type {
  PlanActionDto,
  PlanTabDto,
  PlanWorkspaceProps,
  PlanWorkspaceSlots,
} from "./components/PlanWorkspace/index.ts";

// Team Configuration Vault
export {
  AssetChecklist,
  computeVaultGate,
  ConfirmVaultDeleteDialog,
  ConnectVaultDialog,
  CreateVaultDialog,
  defaultLocalRepoPath,
  formatAccountOption,
  formatDiscoveredRepo,
  formatVaultRepo,
  formatVaultSync,
  GatedActionButton,
  generateVaultVersion,
  ImportFromVaultDialog,
  isLocalProjectNameTaken,
  parseReviewers,
  PushToVaultDialog,
  repoFolderName,
  seedRepoMappings,
  suggestLocalProjectName,
  VAULT_GATE_REASONS,
  VaultDialogShell,
  VaultEmptyState,
  VaultProjectsTable,
  vaultRepoKey,
  VaultStatusCard,
} from "./components/Vault/index.ts";
export type {
  AssetChecklistProps,
  ConfirmVaultDeleteDialogProps,
  ConnectVaultDialogProps,
  ConnectVaultSubmission,
  CreateVaultDialogProps,
  CreateVaultSubmission,
  DiscoveredVaultRepo,
  GatedActionButtonProps,
  GitHubAccountOption,
  ImportFromVaultDialogProps,
  LocalProjectRef,
  ProjectAssets,
  PushToVaultDialogProps,
  VaultCatalog,
  VaultCatalogItem,
  VaultDialogShellProps,
  VaultEmptyStateProps,
  VaultExportDraft,
  VaultExportRequest,
  VaultGate,
  VaultGateInput,
  VaultGateRequirement,
  VaultImportRequest,
  VaultItemSyncStatus,
  VaultPrResult,
  VaultProjectsTableProps,
  VaultRepoRef,
  VaultResult,
  VaultStatus,
  VaultStatusCardProps,
} from "./components/Vault/index.ts";
