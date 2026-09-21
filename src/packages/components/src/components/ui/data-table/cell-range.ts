/**
 * The rectangular cell selection and the clipboard buffer it copies to.
 *
 * Ported from the framework grid's selection and copy path rather than invented: V1's tables run in
 * `SelectionModes.Cells`, which `widgets/dataTables/utils/selectionModes.ts` resolves to
 * `{ rowSelect: "none", columnSelect: "none", rangeSelect: "rect" }`, and that grid's copy buffer is
 * built by `@glideapps/glide-data-grid/src/data-editor/copy-paste.ts`. Everything here that looks
 * arbitrary — the escaping predicate, the `text/html` table, the absent header row — is that file's
 * behaviour, cited at the point it is reproduced.
 *
 * Kept free of React so the format is testable on its own, which is the half of this feature that a
 * jsdom test can actually see: jsdom ships no `ClipboardEvent` and no `DataTransfer`, so what the
 * clipboard *receives* can only be asserted through a stub, and what goes into it has to be correct
 * by construction.
 */

/** One cell, addressed by its position among the rendered rows and the visible columns. */
export interface DataTableCellAddress {
  /** Index into the rows currently rendered (the page, under client-side pagination). */
  row: number;
  /** Index into the *visible, ordered* columns — the same order the `<th>`s are in. */
  column: number;
}

/**
 * A selection, held as the two cells that define it rather than as a normalised rectangle.
 *
 * The anchor is load-bearing and cannot be recovered from a rectangle: a shift-click extends *from
 * the anchor*, so dragging up-left and then shift-clicking down-right has to pivot on the cell the
 * drag started at, not on the rectangle's top-left corner. This is
 * `glide-data-grid/src/data-editor/data-editor.tsx:1958-1961`, which computes the new range from
 * `col`/`row` against `cellCol`/`cellRow` — the stored anchor cell — in exactly that way.
 */
export interface DataTableCellRange {
  /** Where the selection started. Shift-click and drag both pivot on this cell. */
  anchor: DataTableCellAddress;
  /** Where it currently ends. */
  focus: DataTableCellAddress;
}

/** A selection as a rectangle, with inclusive bounds. */
export interface DataTableCellRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * The inclusive rectangle a range covers.
 *
 * `min`/`max` on each axis, so a range dragged up-and-left covers the same cells as the same range
 * dragged down-and-right (`data-editor.tsx:1958-1961`).
 */
export function cellRangeRect(range: DataTableCellRange): DataTableCellRect {
  return {
    top: Math.min(range.anchor.row, range.focus.row),
    bottom: Math.max(range.anchor.row, range.focus.row),
    left: Math.min(range.anchor.column, range.focus.column),
    right: Math.max(range.anchor.column, range.focus.column),
  };
}

/** Whether a cell falls inside the selection. */
export function cellRangeContains(range: DataTableCellRange, row: number, column: number): boolean {
  const rect = cellRangeRect(range);
  return row >= rect.top && row <= rect.bottom && column >= rect.left && column <= rect.right;
}

/** Number of cells the selection covers. `1` for a single clicked cell. */
export function cellRangeSize(range: DataTableCellRange): number {
  const rect = cellRangeRect(range);
  return (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);
}

/**
 * A value as it goes onto the clipboard.
 *
 * `glide-data-grid/src/data-editor/copy-paste.ts:130-135` exactly: a value containing a tab, a
 * newline or a double quote is wrapped in double quotes and its own quotes doubled, and a value
 * containing none of them is emitted untouched. The `withComma` arm of that predicate is for
 * *array* cells, which join their own elements with commas and so have to escape commas too; a
 * scalar cell does not, and quoting every value that merely contains a comma would make a
 * spreadsheet paste show the quotes.
 */
export function escapeClipboardValue(value: string): string {
  if (/[\t\n"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * The `text/plain` buffer: cells joined by tabs, rows by newlines.
 *
 * `copy-paste.ts:137-153` (`createTextBuffer`). No trailing newline, and — deliberately — no header
 * row: glide's `copyHeaders` defaults to `false` (`data-editor.tsx:846`) and V1 never passes it, so
 * a copy out of a Tendril table is the cells and nothing else. Pasting a header row nobody asked for
 * into the middle of a spreadsheet is the failure mode that default avoids.
 */
export function cellRangeToText(cells: readonly (readonly string[])[]): string {
  return cells.map((row) => row.map(escapeClipboardValue).join("\t")).join("\n");
}

/** Escapes text for an HTML text node, and collapses the tabs a spreadsheet would choke on. */
function escapeHtmlText(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // `copy-paste.ts:155-162`: Google Sheets rejects tabs inside a cell, and runs of spaces are
      // collapsed on paste unless each one is wrapped in an element.
      .replace(/\t/g, "    ")
      .replace(/ {2,}/g, (match) => "<span> </span>".repeat(match.length))
  );
}

/**
 * The `text/html` buffer: the same cells as a `<table>`.
 *
 * This is the half that makes a paste land in a spreadsheet *as cells* rather than as one string of
 * tab-separated text — Excel, Numbers and Google Sheets all prefer `text/html` when it is on the
 * clipboard and parse a `<table>` into a grid. `copy-paste.ts:180-216` (`createHtmlBuffer`), minus
 * glide's `gdg-*` round-tripping attributes, which exist so *its own* paste handler can recover
 * typed values; this table does not paste, so writing them would be cargo cult.
 *
 * The `mso-data-placement` style is kept: without it Excel drops a multi-line cell into several
 * rows.
 */
export function cellRangeToHtml(cells: readonly (readonly string[])[]): string {
  const parts: string[] = [
    `<style type="text/css"><!--br {mso-data-placement:same-cell;}--></style>`,
    "<table><tbody>",
  ];
  for (const row of cells) {
    parts.push("<tr>");
    for (const cell of row) {
      parts.push(`<td>${escapeHtmlText(cell)}</td>`);
    }
    parts.push("</tr>");
  }
  parts.push("</tbody></table>");
  return parts.join("");
}
