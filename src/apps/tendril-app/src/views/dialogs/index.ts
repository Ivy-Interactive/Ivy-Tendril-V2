/**
 * Plan lifecycle dialogs.
 *
 * Every dialog here composes `DialogShell`, which owns the accessibility
 * contract (focus in on open, focus back to the invoker on close, Escape
 * cancels, destructive confirm never default-focused). Import from this barrel
 * rather than reaching for a file directly, so a dialog can be split or renamed
 * without touching its call sites.
 */
/**
 * The presentational dialogs now live in `@ivy-interactive/components`, and are re-exported here so
 * every call site keeps importing from this barrel. Moving them was what let them into Storybook:
 * the library has one, the app does not, and a library cannot import from the app.
 *
 * What is re-exported below reaches nothing on its own. What is defined in this folder is the
 * connected half - the wrappers that call the bridge and the stores, and hand the results down.
 */
export {
  DialogShell,
  DialogShortcutHint,
  ConfirmDialog,
  DIALOG_WIDTH,
  DirtyRepoDialog,
  NoProjectsDialog,
  PendingAnnotationsDialog,
  UnansweredQuestionsDialog,
  type DialogShellProps,
  type ConfirmDialogProps,
  type ConfirmVariant,
  type DialogWidth,
  type DirtyRepoDialogProps,
  type DirtyRepo,
  type NoProjectsDialogProps,
  type PendingAnnotationsDialogProps,
  type UnansweredQuestionsDialogProps,
} from "@ivy-interactive/components/tendril";

export { DeletePlanDialog } from "./DeletePlanDialog";
export { RemoveProjectDialog } from "./RemoveProjectDialog";
export { DeleteProjectDialog, confirmsProjectName } from "./DeleteProjectDialog";
export { UpdatePlanDialog } from "./UpdatePlanDialog";
export { CreateIssueDialog } from "./CreateIssueDialog";

export { ResetToDraftDialog } from "./ResetToDraftDialog";
export { PartialDeliveryDialog } from "./PartialDeliveryDialog";
export { SuggestChangesDialog } from "./SuggestChangesDialog";
export { CreatePrDialog } from "./CreatePrDialog";

export { AutoAcceptSettingsDialog } from "./AutoAcceptSettingsDialog";

/**
 * The shell's own plan search, which is what the sidebar section's search icon opens for every plan
 * list. `App.tsx` deliberately reaches for the module rather than this barrel: it is the shell's one
 * eager chunk and must not pull the dialog family's `@ivy-interactive/components/ui` graph in.
 */
export {
  PlanSearchDialog,
  planSearchRow,
  planSearchRowBadges,
  MAX_PLAN_SEARCH_RESULTS,
  PLAN_SEARCH_DEBOUNCE_MS,
  type PlanSearchDialogProps,
} from "./PlanSearchDialog";

export {
  ShareTunnelDialog,
  shareTunnelApi,
  shareUrlForPlan,
  SHARE_POLL_INTERVAL_MS,
  type ShareTunnelDialogProps,
  type ShareTunnelSnapshot,
  type ShareTunnelStatus,
  type ShareTunnelApi,
} from "./ShareTunnelDialog";
