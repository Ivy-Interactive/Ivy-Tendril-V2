import type * as React from "react";

import type { DataTableColumnFilter } from "./column-filters";

export type DataTableAlign = "Left" | "Center" | "Right";
export type DataTableSortDirection = "Ascending" | "Descending";

export interface DataTableSort {
  column: string;
  direction: DataTableSortDirection;
}

export interface DataTableColumn<TRow> {
  /** Stable key. Also the sort key and the `columnVisibility` map key. */
  name: string;
  /** Header text. Falls back to `name`. */
  header?: string;
  /** Cell value used for sorting, default rendering and the inline editor's initial value. */
  accessor?: (row: TRow) => unknown;
  /** Custom cell renderer. Receives the accessor value and the row. */
  cell?: (value: unknown, row: TRow, rowIndex: number) => React.ReactNode;
  /** Defaults to true. */
  sortable?: boolean;
  /** Defaults to "Left". Applies to both header and cells. */
  align?: DataTableAlign;
  /** CSS width for the <th>, e.g. "110px" or "auto". */
  width?: string;
  /** Defaults to false. Hidden columns are absent from the DOM. */
  hidden?: boolean;
  /** Ascending sort position among visible columns; ties keep declaration order. */
  order?: number;
  /** Tooltip on the header. */
  help?: string;
  /** Aggregate footer value for this column (legacy `footer`). */
  footer?: React.ReactNode;
  /** Defaults to false — cells truncate with an ellipsis unless set. */
  wrapText?: boolean;
  /** Cell becomes editable when the table is `editable`. Defaults to false. */
  editable?: boolean;
  /** Comparator override; defaults to the shared value comparator in utils.ts. */
  compare?: (a: unknown, b: unknown) => number;
  /**
   * Header filter for this column, rendered in the table's filter row when `showColumnFilters`.
   *
   * Absent means unfilterable, which is the legacy `.Filterable(false)` — V1's Jobs table applies it
   * to the hidden `Id` and `ErrorContext` columns and to nothing else.
   */
  filter?: DataTableColumnFilter;
}

export interface DataTableRowAction<TRow> {
  /** Stable id, passed to onRowAction. */
  tag: string;
  label: string;
  icon?: React.ReactNode;
  tooltip?: string;
  variant?: "default" | "destructive" | "separator";
  disabled?: boolean;
  children?: DataTableRowAction<TRow>[];
}

/** Payload handed to `onRowAction` when a row action is invoked. */
export interface DataTableRowActionEvent<TRow> {
  /** `getRowId(row, index)` for the row the action belongs to. */
  id: string;
  /** The invoked action's `tag`. */
  tag: string;
  row: TRow;
}

/** Payload handed to `onCellCommit` when an inline edit is committed. */
export interface DataTableCellCommitEvent<TRow> {
  /** `getRowId(row, index)` for the edited row. */
  id: string;
  row: TRow;
  /** The edited column's `name`. */
  column: string;
  /** The editor's text value. */
  value: string;
  /** The accessor value the editor started from. */
  previousValue: unknown;
}

/** Left/right content slots rendered above the table. */
export interface DataTableToolbarSlots {
  left?: React.ReactNode;
  right?: React.ReactNode;
}

/** `Record<string, boolean>` keyed by column `name`; an absent key means "use `column.hidden`". */
export type DataTableColumnVisibility = Record<string, boolean>;

/**
 * Row-windowing mode.
 *
 * - `"auto"` (the default) windows only once the rendered row count exceeds
 *   `virtualizationThreshold`. Because `paginated` defaults to true with a 10-row page, a default
 *   call site never windows and renders exactly as it did before virtualization existed.
 * - `true` forces windowing.
 * - `false` disables it.
 */
export type DataTableVirtualized = boolean | "auto";
