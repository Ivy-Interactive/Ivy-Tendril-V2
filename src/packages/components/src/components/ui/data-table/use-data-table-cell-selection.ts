import * as React from "react";

import {
  cellRangeContains,
  cellRangeRect,
  cellRangeSize,
  cellRangeToHtml,
  cellRangeToText,
  type DataTableCellAddress,
  type DataTableCellRange,
} from "./cell-range";

export interface UseDataTableCellSelectionOptions {
  /** Whether cells can be selected at all. */
  enabled: boolean;
  /** Rows currently rendered (the page, under client-side pagination). */
  rowCount: number;
  /** Visible columns, in render order. */
  columnCount: number;
  /**
   * The text one cell contributes to the clipboard, by position. Cells are pulled lazily at copy
   * time rather than held in the selection, so a selection costs two coordinates however large it is
   * — which is what makes Cmd+A over a fifty-thousand-row table free until something is copied.
   */
  getCellText: (row: number, column: number) => string;
  /** The element the selection belongs to, used to scope the `copy` listener and clear on outside clicks. */
  containerRef: React.RefObject<HTMLElement | null>;
}

export interface UseDataTableCellSelectionResult {
  /** The live selection, or `null`. */
  range: DataTableCellRange | null;
  /** Whether a cell is inside the selection — the per-cell render check. */
  isSelected: (row: number, column: number) => boolean;
  /** True while the pointer is down and dragging out a range. */
  isDragging: boolean;
  /** `onMouseDown` for a body cell: starts a range, or extends the existing one under Shift. */
  handleCellMouseDown: (row: number, column: number, event: React.MouseEvent) => void;
  /** `onMouseEnter` for a body cell: extends the range while the pointer is down. */
  handleCellMouseEnter: (row: number, column: number) => void;
  /**
   * Whether a click should be swallowed because it is the tail of a drag.
   *
   * A range selection must not also fire the cell's `onCellClick`: the operator was selecting text to
   * copy, not asking to open a sheet.
   */
  shouldSuppressClick: () => boolean;
  /** Table-level `onKeyDown`: Cmd/Ctrl+A selects every cell, Escape clears. */
  handleKeyDown: (event: React.KeyboardEvent) => void;
  /** Drops the selection. */
  clear: () => void;
}

/** The whole table as one range. `data-editor.tsx:3208-3225`: `primary+a` spans every column and row. */
function selectAllRange(rowCount: number, columnCount: number): DataTableCellRange | null {
  if (rowCount <= 0 || columnCount <= 0) return null;
  return {
    anchor: { row: 0, column: 0 },
    focus: { row: rowCount - 1, column: columnCount - 1 },
  };
}

/**
 * Rectangular cell selection with a TSV clipboard copy — the DOM equivalent of the framework grid's
 * `rangeSelect: "rect"`.
 *
 * V1's every table gets this: `DataTableDefaults.ts:32-35` defaults `selectionMode` to
 * `SelectionModes.Cells` and `allowCopySelection` to true, and
 * `widgets/dataTables/utils/selectionModes.ts` maps `Cells` to
 * `{ rowSelect: "none", columnSelect: "none", rangeSelect: "rect" }`. (Tendril V1's own C# call
 * sites *opt out* — `JobsApp.DataTable.cs:91` sets `SelectionModes.None` — but the user asked for
 * select-and-copy on all of them, so this reproduces the framework default rather than the opt-out.)
 *
 * The interaction is ported piece by piece:
 * - A plain press collapses the selection to one cell and makes it the anchor
 *   (`data-editor.tsx:1979-1989`).
 * - Dragging extends to the cell under the pointer, always as the rectangle between it and the
 *   anchor (`data-editor.tsx:1958-1961`).
 * - Shift-click extends from the *anchor*, not from the nearest corner — the same block.
 * - Cmd/Ctrl+A selects every cell (`data-editor.tsx:3208-3225`), scoped to the table rather than the
 *   document, so it only fires when focus is inside.
 * - A click outside clears (`dataTableEditor/DataTableEditor.tsx:384-400`, a document `mousedown`
 *   listener that does exactly this).
 * - Copy writes `text/plain` and `text/html` (`data-editor-fns.ts:168-213`, `copyToClipboard`).
 *
 * Mouse events rather than pointer events: a `<td>` cannot capture the pointer usefully — the drag
 * has to track whichever cell is *under* the cursor, which is what `mouseenter` on each cell already
 * reports, and pointer capture would redirect every move to the cell the drag started on.
 */
export function useDataTableCellSelection({
  enabled,
  rowCount,
  columnCount,
  getCellText,
  containerRef,
}: UseDataTableCellSelectionOptions): UseDataTableCellSelectionResult {
  const [range, setRange] = React.useState<DataTableCellRange | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  // The drag spans commits, and reading it from a ref keeps the `mouseenter` handler stable while
  // still seeing the live value.
  const draggingRef = React.useRef(false);
  // Set when a drag actually covered a second cell, and read (then cleared) by the click that
  // follows `mouseup`. A press-and-release on one cell is a click and must still reach `onCellClick`.
  const draggedRef = React.useRef(false);
  const rangeRef = React.useRef<DataTableCellRange | null>(null);
  rangeRef.current = range;

  const clear = React.useCallback(() => {
    setRange(null);
  }, []);

  /* The rows or columns changed under the selection — a sort, a filter, a page turn. The coordinates
     would still be in bounds but would now name different cells, so the selection is dropped rather
     than silently re-pointed at data nobody selected. */
  const shape = `${rowCount}x${columnCount}`;
  const lastShape = React.useRef(shape);
  React.useEffect(() => {
    if (lastShape.current === shape) return;
    lastShape.current = shape;
    setRange(null);
  }, [shape]);

  React.useEffect(() => {
    if (!enabled) setRange(null);
  }, [enabled]);

  /* A press anywhere outside the table clears it — `DataTableEditor.tsx:384-400`, which listens on
     `document` for `mousedown` for the same reason: the selection is a table-scoped mode, and
     leaving it painted while the operator works elsewhere makes the next Cmd+C copy something they
     are no longer looking at. */
  React.useEffect(() => {
    if (!enabled) return;
    const onMouseDown = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(event.target as Node)) return;
      setRange(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [containerRef, enabled]);

  // A drag that ends outside the table still ends: the button is up, so the range is final.
  React.useEffect(() => {
    if (!enabled) return;
    const onMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [enabled]);

  const handleCellMouseDown = React.useCallback(
    (row: number, column: number, event: React.MouseEvent) => {
      if (!enabled || event.button !== 0) return;
      // Something inside the cell owns the press: a row-action button, a checkbox, the inline
      // editor. Selecting a range out from under a control the operator is aiming at would both
      // steal the click and paint a selection they did not ask for.
      if (
        (event.target as HTMLElement | null)?.closest("button, input, select, textarea, a[href]")
      ) {
        return;
      }

      draggedRef.current = false;

      const current = rangeRef.current;
      if (event.shiftKey && current) {
        // `data-editor.tsx:1945-1974`: shift extends the existing range, pivoting on its anchor.
        setRange({ anchor: current.anchor, focus: { row, column } });
        // Shift-extending is a selection gesture, so the click it produces must not also activate
        // the cell.
        draggedRef.current = true;
        return;
      }

      const cell: DataTableCellAddress = { row, column };
      setRange({ anchor: cell, focus: cell });
      draggingRef.current = true;
      setIsDragging(true);
    },
    [enabled],
  );

  const handleCellMouseEnter = React.useCallback(
    (row: number, column: number) => {
      if (!enabled || !draggingRef.current) return;
      const current = rangeRef.current;
      if (!current) return;
      if (current.focus.row === row && current.focus.column === column) return;
      draggedRef.current = true;
      setRange({ anchor: current.anchor, focus: { row, column } });
    },
    [enabled],
  );

  const shouldSuppressClick = React.useCallback(() => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (!enabled) return;
      if (event.key === "Escape" && rangeRef.current) {
        setRange(null);
        return;
      }
      // `data-editor.tsx:3208`, whose `selectAll` keybinding is `primary+a` — Cmd on a Mac, Ctrl
      // elsewhere. Scoped to the table (this is the table's own `onKeyDown`) rather than the
      // document, so it only pre-empts the browser's select-all when focus is actually in here.
      if ((event.metaKey || event.ctrlKey) && (event.key === "a" || event.key === "A")) {
        const all = selectAllRange(rowCount, columnCount);
        if (!all) return;
        event.preventDefault();
        setRange(all);
      }
    },
    [columnCount, enabled, rowCount],
  );

  /*
   * Copy, on the window.
   *
   * A `copy` listener rather than a Cmd+C key handler, which is what the grid does too
   * (`data-editor.tsx:3877`, `useEventListener("copy", onCopy, safeWindow, ...)`). The reason is the
   * clipboard permission model: writing to `event.clipboardData` inside a real copy event needs no
   * permission and no async hop, while `navigator.clipboard.write` from a keydown can prompt, can be
   * blocked outside a secure context, and lands *after* the browser's own default copy. Guarded on
   * focus being inside the table, exactly as `data-editor.tsx:3775-3779` guards it, so Cmd+C
   * elsewhere on the page still copies whatever it would have.
   */
  React.useEffect(() => {
    if (!enabled) return;
    const onCopy = (event: ClipboardEvent) => {
      const current = rangeRef.current;
      if (!current) return;
      const container = containerRef.current;
      if (!container) return;
      const active = document.activeElement;
      if (!(active && container.contains(active))) return;

      const rect = cellRangeRect(current);
      const cells: string[][] = [];
      for (let row = rect.top; row <= rect.bottom; row++) {
        const line: string[] = [];
        for (let column = rect.left; column <= rect.right; column++) {
          line.push(getCellText(row, column));
        }
        cells.push(line);
      }

      const text = cellRangeToText(cells);
      const html = cellRangeToHtml(cells);
      // `data-editor-fns.ts:168-213` writes both flavours: `text/plain` for an editor, `text/html`
      // so a spreadsheet pastes the rectangle as cells instead of as one run of tab-separated text.
      event.clipboardData?.setData("text/plain", text);
      event.clipboardData?.setData("text/html", html);
      event.preventDefault();
    };
    window.addEventListener("copy", onCopy);
    return () => window.removeEventListener("copy", onCopy);
  }, [containerRef, enabled, getCellText]);

  const isSelected = React.useCallback(
    (row: number, column: number) => {
      if (!range) return false;
      // A single cell is a caret, not a selection: glide paints one cell as the *focused* cell, and
      // painting a lone cell as a highlighted block on every click would make ordinary clicking look
      // like a mis-drag. The range still exists — Shift+click extends from it, and Cmd+C copies it.
      if (cellRangeSize(range) <= 1) return false;
      return cellRangeContains(range, row, column);
    },
    [range],
  );

  return {
    range,
    isSelected,
    isDragging,
    handleCellMouseDown,
    handleCellMouseEnter,
    shouldSuppressClick,
    handleKeyDown,
    clear,
  };
}
