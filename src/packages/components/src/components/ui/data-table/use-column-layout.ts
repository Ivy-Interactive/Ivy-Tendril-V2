import * as React from "react";

import type { DataTableColumn } from "./types";

/**
 * Narrowest a column may be dragged.
 *
 * The framework grid's own floor: `glide-data-grid/src/data-editor/data-editor.tsx:862` defaults
 * `minColumnWidth` to 50, and V1's mobile resize path independently clamps to the same number
 * (`widgets/dataTables/hooks/useMobileColumnResize.ts:4`). Below about this the header label has no
 * room at all and the column stops being identifiable.
 */
export const DATA_TABLE_MIN_COLUMN_WIDTH = 50;

/**
 * Widest a column may be dragged.
 *
 * `useMobileColumnResize.ts:5` — V1's own resize clamp. Deliberately not glide's `maxColumnWidth`
 * default of 500 (`data-editor.tsx:863`): that one bounds a *canvas* column, where the grid owns the
 * horizontal scroll and a 2000px column would strand every other one off-screen. Here the table
 * scrolls in a real `overflow-auto` viewport, and a reader widening a Prompt column to read it is
 * doing the thing the feature is for.
 */
export const DATA_TABLE_MAX_COLUMN_WIDTH = 2000;

/** Keyboard resize step, matching `use-resizable-sidebar.ts`'s separator contract. */
export const DATA_TABLE_RESIZE_STEP = 10;
/** Shift+Arrow resize step, likewise. */
export const DATA_TABLE_RESIZE_SHIFT_STEP = 50;

/**
 * Fallback width when nothing else is known — V1's `parseSize` default
 * (`widgets/dataTables/dataTableContext/utils/columnSizing.ts:9-10`).
 */
export const DATA_TABLE_DEFAULT_COLUMN_WIDTH = 150;

/**
 * A declared `column.width` as a pixel number, or `undefined` when it is not expressible as one.
 *
 * Only what a resize can meaningfully start *from*: `px`, `rem` and a bare number. A `%`, `auto`,
 * `min-content` or a `calc()` has no pixel value until the browser has laid the table out, so those
 * return `undefined` and the caller measures the rendered `<th>` instead. `rem` is converted at 16px
 * for the same reason V1 does (`columnSizing.ts:20`): the root font size is not readable from here,
 * and 16 is the value this design system's tokens are written against.
 */
export function parseDeclaredWidth(width: string | undefined): number | undefined {
  if (width === undefined) return undefined;
  const trimmed = width.trim();
  const match = /^(-?\d+(?:\.\d+)?)(px|rem)?$/.exec(trimmed);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return match[2] === "rem" ? value * 16 : value;
}

/** Widths by column `name`, in px. A column absent from the map has not been resized. */
export type DataTableColumnWidths = Record<string, number>;

export interface UseColumnLayoutOptions<TRow> {
  /** Visible columns in their declared order, i.e. `useColumnVisibility`'s output. */
  columns: DataTableColumn<TRow>[];
  /** Whether the resize handles render and respond. */
  allowColumnResizing: boolean;
  /** Whether the reorder grips render and respond. */
  allowColumnReordering: boolean;
  /** Controlled widths by column name. `undefined` means uncontrolled. */
  columnWidths?: DataTableColumnWidths;
  defaultColumnWidths?: DataTableColumnWidths;
  onColumnWidthsChange?: (widths: DataTableColumnWidths) => void;
  /** Controlled order, as column names. `undefined` means uncontrolled. */
  columnOrder?: string[];
  defaultColumnOrder?: string[];
  onColumnOrderChange?: (order: string[]) => void;
}

export interface UseColumnLayoutResult<TRow> {
  /** `columns`, permuted by the active order. This is what the header and the cells both iterate. */
  orderedColumns: DataTableColumn<TRow>[];
  /** The resized width of a column in px, or `undefined` when it still sizes from `column.width`. */
  widthFor: (name: string) => number | undefined;
  /** Sets one column's width, clamped and rounded. */
  setColumnWidth: (name: string, width: number) => void;
  /** Drops a column's resize, returning it to `column.width`. The handle's double-click. */
  resetColumnWidth: (name: string) => void;
  /** Moves the column at one position among the visible columns to another. */
  moveColumn: (from: number, to: number) => void;
  /** Position of a column among `orderedColumns`, or `-1`. */
  indexOf: (name: string) => number;
}

/**
 * Clamp and round a dragged width.
 *
 * `glide-data-grid/src/internal/data-grid/data-grid-dnd.ts` clamps its drag to
 * `[ceil(min), floor(max)]` and rounds, and V1's own `clampWidth`
 * (`useMobileColumnResize.ts`) is `Math.max(MIN, Math.min(MAX, Math.round(width)))`. Rounding
 * matters beyond tidiness: a fractional `<th>` width makes the browser round each column
 * independently, which is where a one-pixel gap between a sticky cell and its neighbour comes from.
 */
export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return DATA_TABLE_MIN_COLUMN_WIDTH;
  return Math.max(
    DATA_TABLE_MIN_COLUMN_WIDTH,
    Math.min(DATA_TABLE_MAX_COLUMN_WIDTH, Math.round(width)),
  );
}

/**
 * Whether two column lists are the same *structure* — the same names in the same positions.
 *
 * `useColumnManagement.ts:36-38` asks exactly this question and uses the answer to decide whether a
 * new `columns` prop invalidates the order. Metadata changing (a header, a footer, a renderer) must
 * not: a table that re-derives its columns every render — which a `useMemo`-less call site does —
 * would otherwise snap the operator's column order back on every keystroke elsewhere in the app.
 */
function sameStructure(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((name, index) => name === b[index]);
}

/**
 * Column widths and column order for one mounted table.
 *
 * Ported from `widgets/dataTables/dataTableContext/hooks/useColumnManagement.ts`, which is where V1
 * keeps both. Its three decisions are reproduced here, and they are decisions rather than accidents:
 *
 * 1. **A resized width survives a re-render.** `initializeColumnWidths` opens with
 *    `if (Object.keys(prevWidths).length > 0) return prevWidths;` (`:75-79`) — once the operator has
 *    dragged anything, the computed defaults never run again. Here the same thing falls out of
 *    holding the overrides in state and letting `column.width` be the fallback: a re-render with
 *    fresh column objects cannot disturb a width that is not stored on them.
 * 2. **Order survives a metadata change but resets on a structural one** (`:36-48`).
 * 3. **Neither survives a remount.** V1 holds both in `useState` and there is not one
 *    `localStorage`, `sessionStorage` or `persist` reference anywhere under `widgets/dataTables/`.
 *    So this does not persist either — inventing persistence would make V2 behave differently from
 *    the thing the user asked it to match, and would silently resurrect a layout for a table whose
 *    columns had since changed meaning.
 *
 * Widths are keyed by column *name* rather than by V1's numeric index (`:142-145`). The name is the
 * stable key everywhere else in this primitive — `columnVisibility`, sorting, `data-column` — and an
 * index key breaks under the very reordering this same hook provides.
 */
export function useColumnLayout<TRow>({
  columns,
  allowColumnResizing,
  allowColumnReordering,
  columnWidths: controlledWidths,
  defaultColumnWidths,
  onColumnWidthsChange,
  columnOrder: controlledOrder,
  defaultColumnOrder,
  onColumnOrderChange,
}: UseColumnLayoutOptions<TRow>): UseColumnLayoutResult<TRow> {
  const isWidthsControlled = controlledWidths !== undefined;
  const [internalWidths, setInternalWidths] = React.useState<DataTableColumnWidths>(
    defaultColumnWidths ?? {},
  );
  const widths = isWidthsControlled ? controlledWidths : internalWidths;

  const isOrderControlled = controlledOrder !== undefined;
  const [internalOrder, setInternalOrder] = React.useState<string[] | null>(
    defaultColumnOrder ?? null,
  );
  const order = isOrderControlled ? controlledOrder : internalOrder;

  const columnNames = React.useMemo(() => columns.map((column) => column.name), [columns]);

  /*
   * `useColumnManagement.ts:31-49` (`syncColumns`), as an effect on the *names* rather than on the
   * column objects: a call site that builds its columns inline produces a new array identity every
   * render, and keying off identity would reset the order on each one.
   *
   * Only the uncontrolled order is reset. A controlled caller owns its order and gets told nothing it
   * did not ask for.
   */
  const structureKey = columnNames.join("\u0000");
  const lastStructure = React.useRef(structureKey);
  React.useEffect(() => {
    if (lastStructure.current === structureKey) return;
    lastStructure.current = structureKey;
    if (!isOrderControlled) setInternalOrder(null);
  }, [isOrderControlled, structureKey]);

  /**
   * The columns in their effective order.
   *
   * An order naming columns that no longer exist is *filtered*, not discarded, and any column the
   * order does not mention is appended in declaration order. Between them these two rules mean a
   * stale order can never drop a column out of the table — the failure mode that would make a column
   * simply vanish after a hide/show, with no affordance to bring it back.
   */
  const orderedColumns = React.useMemo(() => {
    if (!order || order.length === 0) return columns;
    if (sameStructure(order, columnNames)) return columns;

    const byName = new Map(columns.map((column) => [column.name, column]));
    const result: DataTableColumn<TRow>[] = [];
    const seen = new Set<string>();
    for (const name of order) {
      const column = byName.get(name);
      if (column && !seen.has(name)) {
        result.push(column);
        seen.add(name);
      }
    }
    for (const column of columns) {
      if (!seen.has(column.name)) result.push(column);
    }
    return result;
  }, [columnNames, columns, order]);

  const commitWidths = React.useCallback(
    (next: DataTableColumnWidths) => {
      if (!isWidthsControlled) setInternalWidths(next);
      onColumnWidthsChange?.(next);
    },
    [isWidthsControlled, onColumnWidthsChange],
  );

  const widthsRef = React.useRef(widths);
  widthsRef.current = widths;

  const setColumnWidth = React.useCallback(
    (name: string, width: number) => {
      // `useColumnManagement.ts:133-136`: the resize handler returns early when resizing is off, so
      // the gate lives with the state rather than only on the affordance.
      if (!allowColumnResizing) return;
      commitWidths({ ...widthsRef.current, [name]: clampColumnWidth(width) });
    },
    [allowColumnResizing, commitWidths],
  );

  const resetColumnWidth = React.useCallback(
    (name: string) => {
      if (!allowColumnResizing) return;
      if (widthsRef.current[name] === undefined) return;
      const next = { ...widthsRef.current };
      delete next[name];
      commitWidths(next);
    },
    [allowColumnResizing, commitWidths],
  );

  const orderedNames = React.useMemo(
    () => orderedColumns.map((column) => column.name),
    [orderedColumns],
  );
  const orderedNamesRef = React.useRef(orderedNames);
  orderedNamesRef.current = orderedNames;

  const moveColumn = React.useCallback(
    (from: number, to: number) => {
      // `useColumnManagement.ts:152-189`, reduced to what a DOM table needs. V1 has to splice
      // *visible* positions and then rebuild a full index array around the hidden columns, because
      // its order is indices into the unfiltered column list; here the order is names and hidden
      // columns are simply absent, so the splice is the whole operation.
      if (!allowColumnReordering) return;
      const names = orderedNamesRef.current;
      if (from === to || from < 0 || to < 0 || from >= names.length || to >= names.length) return;
      const next = [...names];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      if (!isOrderControlled) setInternalOrder(next);
      onColumnOrderChange?.(next);
    },
    [allowColumnReordering, isOrderControlled, onColumnOrderChange],
  );

  const widthFor = React.useCallback((name: string) => widths[name], [widths]);

  const indexOf = React.useCallback((name: string) => orderedNames.indexOf(name), [orderedNames]);

  return { orderedColumns, widthFor, setColumnWidth, resetColumnWidth, moveColumn, indexOf };
}
