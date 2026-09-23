/**
 * Tendril's sheets — the side panels that slide over a page.
 *
 * Kept apart from `Dialogs/` because they are a different shape, not a different topic. A dialog
 * owns its own modal and answers a question; a sheet is a panel, and two of the three here do not
 * even own their `<Sheet>` — `JobDebugSheet` is a body its host wraps, and `ErrorSheet` subscribes
 * to a store rather than taking props at all. Their stories carry a real trigger button for that
 * reason: a sheet rendered bare shows something the app never displays.
 */
export {
  JobDebugSheet,
  buildJobDebugFields,
  formatJobDebugDetails,
  type JobDebugSheetProps,
  type JobDebugDetail,
  type JobDebugField,
} from "./JobDebugSheet";
export { ErrorSheet } from "./ErrorSheet";
