import type {
  DataTableColumn,
  DataTableColumnVisibility,
  DataTableRowAction,
  DataTableSortDirection,
} from "./types";
import { i18n } from "@/i18n/uiCommon";

const isNil = (value: unknown): boolean => value === null || value === undefined;

/**
 * Effective visibility for a column: an explicit entry in the visibility map wins, otherwise the
 * column's own `hidden` flag (which defaults to visible).
 */
export function isColumnVisible<TRow>(
  column: DataTableColumn<TRow>,
  visibility: DataTableColumnVisibility = {},
): boolean {
  return visibility[column.name] ?? !column.hidden;
}

/**
 * Visible columns in render order. Ported from the legacy widget's
 * `getOrderedVisibleDataColumns`: hidden columns drop out, and the remainder are sorted by `order`
 * only when at least one of them declares one (columns without an `order` sort last, ties keeping
 * declaration order).
 */
export function getVisibleColumns<TRow>(
  columns: DataTableColumn<TRow>[],
  visibility: DataTableColumnVisibility = {},
): DataTableColumn<TRow>[] {
  const visible = columns.filter((column) => isColumnVisible(column, visibility));

  if (!visible.some((column) => column.order !== undefined)) {
    return visible;
  }

  return visible
    .map((column, index) => ({ column, index }))
    .sort((a, b) => {
      const orderA = a.column.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.column.order ?? Number.MAX_SAFE_INTEGER;
      return orderA === orderB ? a.index - b.index : orderA - orderB;
    })
    .map((entry) => entry.column);
}

/** The value a column reads out of a row: its `accessor`, or the row property named after it. */
export function getCellValue<TRow>(column: DataTableColumn<TRow>, row: TRow): unknown {
  if (column.accessor) {
    return column.accessor(row);
  }
  return (row as Record<string, unknown> | null | undefined)?.[column.name];
}

/**
 * Text for a cell value: what the default cell renderer prints and what the inline editor starts
 * from. Objects fall back to JSON so nothing renders as `[object Object]`.
 */
export function toDisplayString(value: unknown): string {
  if (isNil(value)) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? "";
}

/**
 * The collator text cells sort with: numeric-aware, case- and accent-insensitive, in the UI's
 * language rather than the operating system's. One per language, because building a collator per
 * comparison is what makes sorting a large table slow.
 */
const collators = new Map<string, Intl.Collator>();
function collator(): Intl.Collator {
  const language = i18n.language;
  let existing = collators.get(language);
  if (!existing) {
    existing = new Intl.Collator(language, { numeric: true, sensitivity: "base" });
    collators.set(language, existing);
  }
  return existing;
}

/**
 * Default comparator for two non-nullish cell values: numbers numerically, dates by time, booleans
 * false before true, everything else by a numeric-aware locale compare.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return collator().compare(toDisplayString(a), toDisplayString(b));
}

/**
 * Stable sort of `rows` by one column. `null`/`undefined` values sort last in *both* directions, so
 * the nullish check happens before the direction is applied.
 */
export function sortRows<TRow>(
  rows: TRow[],
  column: DataTableColumn<TRow>,
  direction: DataTableSortDirection,
): TRow[] {
  const compare = column.compare ?? compareValues;

  return rows
    .map((row, index) => ({ row, index, value: getCellValue(column, row) }))
    .sort((a, b) => {
      const aNil = isNil(a.value);
      const bNil = isNil(b.value);
      if (aNil && bNil) return a.index - b.index;
      if (aNil) return 1;
      if (bNil) return -1;

      const result = compare(a.value, b.value);
      if (result !== 0) {
        return direction === "Descending" ? -result : result;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** The sort state a column moves to when its header is activated (single-column cycle). */
export function nextSortDirection(
  current: DataTableSortDirection | null,
): DataTableSortDirection | null {
  if (current === null) return "Ascending";
  if (current === "Ascending") return "Descending";
  return null;
}

/** `aria-sort` value for a header: `undefined` on columns that cannot be sorted at all. */
export function ariaSortValue(
  sortable: boolean,
  direction: DataTableSortDirection | null,
): "ascending" | "descending" | "none" | undefined {
  if (!sortable) return undefined;
  if (direction === "Ascending") return "ascending";
  if (direction === "Descending") return "descending";
  return "none";
}

/** Row actions that actually render: separators are dropped, as in the legacy `ActionRenderer`. */
export function getRenderableActions<TRow>(
  actions: DataTableRowAction<TRow>[] | undefined,
): DataTableRowAction<TRow>[] {
  return (actions ?? []).filter((action) => action.variant !== "separator");
}

/** Inclusive 1-based row range shown on the current page; `[0, 0]` when there are no rows. */
export function getPageRange(
  page: number,
  pageSize: number,
  total: number,
): { start: number; end: number } {
  if (total <= 0) {
    return { start: 0, end: 0 };
  }
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return { start, end };
}

/** Clamp a page number into `[1, pageCount]`. */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(1, pageCount));
}

/** Number of pages for `total` rows at `pageSize` per page; never less than one. */
export function getPageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * The separator between row ids in a [`rowIdentity`] string.
 *
 * NUL, because it cannot occur in a row id. That is what makes [`isRowIdentityAppend`]'s prefix test
 * exact rather than a guess about where one id ends and the next begins.
 */
const ROW_IDENTITY_SEPARATOR = "\u0000";

/** The rows currently rendered, in order, as one comparable string. */
export function rowIdentity(rowIds: readonly string[]): string {
  return rowIds.join(ROW_IDENTITY_SEPARATOR);
}

/**
 * Whether `next` is `previous` with rows added to the end, rather than a different set of rows.
 *
 * This is the question a scroll position depends on. A re-sort, a filter or a page change *replaces*
 * the rows, and the viewport belongs at the top of the new ones. An appended window under infinite
 * scroll replaces nothing, and returning to the top there would undo the very scroll that asked for
 * it — which is the difference between infinite scroll working and being unusable.
 *
 * Growing from *no* rows counts as an append, because nothing was replaced. Treating it as a
 * replacement looks harmless — an empty table is already at the top — but the reset it triggers runs
 * in an effect, one commit after the rows themselves render. A scroll that lands in that gap is
 * silently rewound to zero, and under infinite scroll that also swallows the window it asked for: the
 * load-more check then reads the distance to the end from the top of the table and declines.
 */
export function isRowIdentityAppend(previous: string, next: string): boolean {
  if (previous.length === 0) return next.length > 0;
  return next.startsWith(`${previous}${ROW_IDENTITY_SEPARATOR}`);
}
