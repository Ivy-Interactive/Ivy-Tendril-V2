/**
 * Plan lifecycle dialogs.
 *
 * Every dialog here composes `DialogShell`, which owns the accessibility
 * contract (focus in on open, focus back to the invoker on close, Escape
 * cancels, destructive confirm never default-focused). Import from this barrel
 * rather than reaching for a file directly, so a dialog can be split or renamed
 * without touching its call sites.
 */
export { DialogShell, type DialogShellProps } from "./DialogShell";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { DIALOG_WIDTH, type DialogWidth } from "./fieldStyles";

export { UnansweredQuestionsDialog } from "./UnansweredQuestionsDialog";
export { PendingAnnotationsDialog } from "./PendingAnnotationsDialog";
export { DirtyRepoDialog } from "./DirtyRepoDialog";

export { DeletePlanDialog } from "./DeletePlanDialog";
export { UpdatePlanDialog } from "./UpdatePlanDialog";
export { CreateIssueDialog } from "./CreateIssueDialog";
export { NoProjectsDialog } from "./NoProjectsDialog";

export { DiscardPlanDialog } from "./DiscardPlanDialog";
export { ResetToDraftDialog } from "./ResetToDraftDialog";
export { PartialDeliveryDialog } from "./PartialDeliveryDialog";
export { SuggestChangesDialog } from "./SuggestChangesDialog";
export { CreatePrDialog } from "./CreatePrDialog";

export { AutoAcceptSettingsDialog } from "./AutoAcceptSettingsDialog";
