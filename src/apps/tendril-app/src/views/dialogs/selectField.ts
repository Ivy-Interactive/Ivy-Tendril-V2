import { inputVariant } from "@ivy-interactive/components/ui";

/**
 * The styling for the lifecycle dialogs' two native `<select>`s: Create Issue's Repository and
 * Auto-Accept's Check Interval.
 *
 * Every other field in those dialogs is now the shared `Input`, `Textarea` or `Callout`. A native
 * select cannot be, because the shared `Select` is Radix: a button over a portalled listbox, so
 * `fireEvent.change(getByLabelText("Repository"), ...)` - what these dialogs' tests do, and what a
 * screen reader's forms mode drives - has nothing to change. `DataTablePagination` in the library
 * reaches the same conclusion for the same reason and keeps its own native select.
 *
 * So the element stays native, but the styling is no longer a hand-typed near-copy of the shared
 * field: it is `inputVariant` itself, the exact `cva` the shared `Input` renders. The `file:`
 * utilities in it are inert on a select, and `appearance` is left alone so the platform still draws
 * the chevron.
 *
 * `inputVariant` rather than `InputVariants.inputVariant`, which is the same `cva` by a different
 * road and reads more naturally, but is worth a sentence because the difference is measurable.
 * `InputVariants` is a namespace re-export of ten variant modules; a namespace object has to be
 * built whole, so nothing in it tree-shakes and importing it here put all ten in the eager chunk -
 * +6,782 bytes against the ~16 kB `code-splitting.test.tsx` has left. The bare named export is the
 * one module, and measures -72 bytes. `ui.ts` gained that export for this.
 *
 * Its own module rather than a line in `fieldStyles`, which is why this looks over-split for one
 * constant: `fieldStyles` holds `DIALOG_WIDTH`, `DialogShell` imports it, and that puts anything
 * living there in the eager graph. Here it is reached only from the two lazy dialog chunks.
 */
export const SELECT_FIELD_CLASS = inputVariant({ density: "Medium" });
