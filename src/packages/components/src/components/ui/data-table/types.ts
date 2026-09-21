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
  /**
   * This column's cells do something when clicked, so they say so.
   *
   * The framework's grid distinguishes exactly this: a cell with a click handler is drawn with
   * `cursor: "pointer"` and a plain one with `cursor: "default"`
   * (`widgets/dataTables/utils/cellContent.ts:583` and `:459`). It reserves its second treatment — blue
   * text with an underline (`customRenderers.ts:526`, `canvasText.ts:103`) — for a *link* cell, i.e. one
   * that navigates. So a cell that opens a sheet gets the cursor; a cell that goes somewhere gets
   * [`dataTableLinkClass`] as well.
   *
   * Set it on the column rather than on the element inside the cell, so the whole cell is the affordance
   * and not just the few characters the value happens to occupy.
   */
  clickable?: boolean;
  /**
   * What this column's cells do when clicked — the legacy `.OnCellAction(t => t.Column, …)`.
   *
   * V1's Jobs table is the reference: it hangs *five* separate cell actions off five columns
   * (`JobsApp.DataTable.cs:95-175`), so Plan Id navigates, Agent Output opens the output sheet, Cost
   * and Tokens both open Cost & Tokens, and Prompt opens the full prompt. A table that routed every
   * cell to one destination would be a different table.
   *
   * Declared beside {@link clickable} rather than wired inside each `cell` renderer so the *whole
   * cell* is the target, not the few characters the value occupies — which is the difference the
   * framework draws when it gives the cell `cursor: pointer`. A column that sets this and omits
   * `clickable` still gets the cursor: the handler is the affordance.
   *
   * Takes precedence over the table's `onRowClick`, which is not fired for a cell that handles its
   * own click — V1's grid dispatches a cell action *or* a row activation, never both.
   */
  onCellClick?: (row: TRow, id: string) => void;
  /** Cell becomes editable when the table is `editable`. Defaults to false. */
  editable?: boolean;
  /** Comparator override; defaults to the shared value comparator in utils.ts. */
  compare?: (a: unknown, b: unknown) => number;
  /**
   * Whether this column can appear in the table's filter expression, and what it is called on the wire
   * when it can — the legacy `.Filterable(column, …)`. V1's Jobs table opts out the hidden `Id` and
   * `ErrorContext` columns and nothing else.
   *
   * Absent means unfilterable: the expression editor refuses the name, naming the columns it does
   * accept.
   */
  filter?: DataTableColumnFilter;
  /**
   * The server's name for this column when sorting, where it differs from the displayed one.
   *
   * Only meaningful under `manualSorting`, where the sort is executed by whoever holds the rows. A
   * *derived* column is the case that needs it: V1's Jobs table shows a Timer that counts up from
   * `StartedAt`, and the closest thing the database can order by is `DurationSeconds`. Falls back to
   * `filter.column` (the same rename, already declared for filtering) and then to `name`.
   *
   * A column the server cannot order by at all should set `sortable: false` rather than a wrong name
   * here.
   */
  sortColumn?: string;
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
