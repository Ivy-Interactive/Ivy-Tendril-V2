/**
 * The accept/decline-with-note dialog lives in the component library now (`Dialogs/`
 * `RecommendationNoteDialog`, V1 `AcceptWithNotesDialog`), with its story and its strings. It needs
 * nothing from the app - the note is handed back to the caller, which owns the write - so there is no
 * connected half; this module only keeps the import path the three views use.
 *
 * From the `dialogs` entry, not `tendril`: every importer (`RecommendationsView`, `ReviewView`,
 * `PlanDetailView`) is itself a lazily loaded view, so the dialog chunk stays out of the shell's
 * eager graph.
 */
export {
  RecommendationNoteDialog,
  type RecommendationNoteDialogProps,
} from "@ivy-interactive/components/dialogs";
