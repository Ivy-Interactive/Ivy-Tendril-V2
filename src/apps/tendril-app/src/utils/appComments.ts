/**
 * The app-comment helpers, re-exported from the component library.
 *
 * They moved there with `SuggestChangesDialog`, which renders their output. Two copies would be a
 * real hazard rather than mere duplication: `formatChangeRequest` produces the literal text
 * dispatched to the agent, and the dialog falls back to the library's copy when the reviewer types
 * nothing while `ReviewActionView` pre-formats with this one. Once they drifted, the same dialog
 * would emit different requests depending on whether the caller pre-filled `initialChangeRequest`.
 *
 * Kept as a module rather than rewriting every import site, because this path is the one the app's
 * own views and tests already name.
 */
export {
  formatChangeRequest,
  readSource,
  applyCommentEvent,
  attributeLabel,
  type AppComment,
  type ViewerEvent,
  type SourceInfo,
} from "@ivy-interactive/components/dialogs";
