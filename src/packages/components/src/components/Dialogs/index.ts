/**
 * Tendril's plan lifecycle dialogs.
 *
 * Every dialog here composes `DialogShell`, which owns the accessibility contract: focus in on
 * open, focus back to the invoker on close, Escape cancels, a destructive confirm is never
 * default-focused, and an overlay click does not dismiss.
 *
 * **These are presentational.** They take data and callbacks and reach nothing on their own - no
 * daemon, no store, no Tauri. A dialog that has to call the bridge keeps a thin connected wrapper
 * in the app (`views/dialogs/`), which is what supplies those callbacks. That split is what lets
 * them live in the library at all: the library cannot import from the app, and `PlanGitView` sets
 * the precedent for owning the shapes it renders rather than borrowing the app's DTOs.
 */
export { DialogShell, DialogShortcutHint, type DialogShellProps } from "./DialogShell";
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmVariant } from "./ConfirmDialog";
export { DIALOG_WIDTH, type DialogWidth } from "./fieldStyles";

export {
  DirtyRepoDialog,
  type DirtyRepoDialogProps,
  type DirtyRepo,
  type DirtyRepoPurpose,
} from "./DirtyRepoDialog";
export { SyncRepoDialog, type SyncRepoDialogProps, type SyncRepoPolicy } from "./SyncRepoDialog";
export {
  CreatePlanDialog,
  buildProjectOptions,
  defaultProject,
  ADD_PROJECT_VALUE,
  AUTO_PROJECT,
  MAX_PROJECTS_FOR_TOGGLE,
  type CreatePlanDialogProps,
  type CreatePlanUpload,
  type ProjectOption,
} from "./CreatePlanDialog";
export {
  RecommendationNoteDialog,
  type RecommendationNoteDialogProps,
} from "./RecommendationNoteDialog";
export {
  DialogAttachments,
  type DialogAttachment,
  type DialogAttachmentProps,
} from "./DialogAttachments";
export { NoProjectsDialog, type NoProjectsDialogProps } from "./NoProjectsDialog";
export {
  PendingAnnotationsDialog,
  type PendingAnnotationsDialogProps,
} from "./PendingAnnotationsDialog";
export {
  UnansweredQuestionsDialog,
  type UnansweredQuestionsDialogProps,
} from "./UnansweredQuestionsDialog";
export { RemoveProjectDialog, type RemoveProjectDialogProps } from "./RemoveProjectDialog";
export {
  ResetToDraftDialog,
  PartialDeliveryDialog,
  DeletePlanDialog,
  type ResetToDraftDialogProps,
  type PartialDeliveryDialogProps,
  type DeletePlanDialogProps,
} from "./PlanConfirmDialogs";
export {
  DeleteProjectDialog,
  confirmsProjectName,
  type DeleteProjectDialogProps,
} from "./DeleteProjectDialog";
export { UpdatePlanDialog, type UpdatePlanDialogProps } from "./UpdatePlanDialog";
export {
  PlanSearchDialog,
  MAX_PLAN_SEARCH_RESULTS,
  PLAN_SEARCH_DEBOUNCE_MS,
  type PlanSearchDialogProps,
} from "./PlanSearchDialog";
export {
  ShareTunnelDialog,
  shareUrlForPlan,
  SHARE_POLL_INTERVAL_MS,
  type ShareTunnelDialogProps,
  type ShareTunnelSnapshot,
  type ShareTunnelStatus,
  type ShareTunnelApi,
} from "./ShareTunnelDialog";
export {
  AutoAcceptSettingsDialog,
  type AutoAcceptSettingsDialogProps,
} from "./AutoAcceptSettingsDialog";
export {
  CreateIssueDialog,
  type CreateIssueDialogProps,
  type CreateIssueSubject,
  type CreateIssueSubmit,
} from "./CreateIssueDialog";
export { CreatePrDialog, type CreatePrDialogProps, type CreatePrOptions } from "./CreatePrDialog";
export { SuggestChangesDialog, type SuggestChangesDialogProps } from "./SuggestChangesDialog";
export {
  formatChangeRequest,
  readSource,
  applyCommentEvent,
  attributeLabel,
  type AppComment,
  type ViewerEvent,
  type SourceInfo,
} from "./appComments";
export {
  ChatSearchDialog,
  filterChatSessions,
  MAX_CHAT_SEARCH_RESULTS,
  type ChatSearchDialogProps,
  type ChatSearchSession,
} from "./ChatSearchDialog";
export {
  DeleteChatSessionDialog,
  type DeleteChatSessionDialogProps,
} from "./DeleteChatSessionDialog";
export {
  KeyboardShortcutsDialog,
  type KeyboardShortcutsDialogProps,
  type KeyboardShortcutEntry,
} from "./KeyboardShortcutsDialog";
export { ImageLightbox, type ImageLightboxProps, type LightboxImage } from "./ImageLightbox";
export { UpdateTendrilDialog, type UpdateTendrilDialogProps } from "./UpdateTendrilDialog";
export {
  DeleteJobDialog,
  StopQueuedJobsDialog,
  StopAllJobsDialog,
  ClearJobsDialog,
  describeJobClearPrompt,
  type DeleteJobDialogProps,
  type StopJobsDialogProps,
  type ClearJobsDialogProps,
  type JobClearScopeKey,
  type JobClearPrompt,
} from "./JobConfirmDialogs";
export { RerunJobDialog, rerunSupportsFeedback, type RerunJobDialogProps } from "./RerunJobDialog";
export { ReportBugDialog, type ReportBugDialogProps } from "./ReportBugDialog";
export { DebugWithAgentDialog, type DebugWithAgentDialogProps } from "./DebugWithAgentDialog";
// Settings dialogs (V1 `Apps/Settings/Dialogs/`), and the named confirms Settings uses.
export {
  AgentTestDialog,
  AgentTestDebugDialog,
  type AgentTestDialogProps,
  type AgentTestDebugDialogProps,
  type AgentTestRow,
  type AgentTestStatus,
} from "./AgentTestDialog";
export {
  RemoveSettingsEntryDialog,
  type RemoveSettingsEntryDialogProps,
  type SettingsRemovalKind,
  type SettingsRemovalSubject,
} from "./RemoveSettingsEntryDialog";
export {
  DiscardConfigChangesDialog,
  type DiscardConfigChangesDialogProps,
} from "./DiscardConfigChangesDialog";
export {
  ImportRepoAssetsDialog,
  type ImportRepoAssetsDialogProps,
  type DiscoveredRepoAsset,
  type RepoAssetKind,
  type RepoAssetSourceMode,
} from "./ImportRepoAssetsDialog";
export {
  VaultThemesDialog,
  VaultThemeExportDialog,
  VaultThemeImportDialog,
  type VaultThemesDialogProps,
  type VaultThemeExportDialogProps,
  type VaultThemeImportDialogProps,
  type VaultThemesTab,
} from "./VaultThemesDialog";
export {
  VAULT_THEME_COLOR_GROUPS,
  VAULT_THEME_RADII,
  VAULT_THEME_TOKENS,
  FALLBACK_THEME_COLORS,
  completeColors,
  exportThemeCss,
  exportThemeJson,
  parseThemeJson,
  previewColorsFor,
  themeFromPreset,
  vaultThemeId,
  type VaultTheme,
  type VaultThemeDraft,
  type VaultThemeRadius,
  type ParsedTheme,
} from "./vaultThemes";
