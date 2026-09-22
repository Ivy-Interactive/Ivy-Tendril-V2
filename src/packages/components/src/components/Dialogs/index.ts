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

export { DirtyRepoDialog, type DirtyRepoDialogProps, type DirtyRepo } from "./DirtyRepoDialog";
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
export {
  CreatePrDialog,
  type CreatePrDialogProps,
  type CreatePrOptions,
} from "./CreatePrDialog";
export {
  SuggestChangesDialog,
  type SuggestChangesDialogProps,
} from "./SuggestChangesDialog";
export {
  formatChangeRequest,
  readSource,
  type AppComment,
} from "./appComments";
export {
  JobDebugSheet,
  buildJobDebugFields,
  formatJobDebugDetails,
  type JobDebugSheetProps,
  type JobDebugDetail,
  type JobDebugField,
} from "./JobDebugSheet";
