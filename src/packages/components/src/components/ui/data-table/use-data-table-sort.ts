import * as React from "react";

import type { DataTableColumn, DataTableSort, DataTableSortDirection } from "./types";
import { nextSortDirection, sortRows } from "./utils";

export interface UseDataTableSortOptions<TRow> {
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  /** Controlled sort. `null` means unsorted; `undefined` means uncontrolled. */
  sort?: DataTableSort | null;
  defaultSort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  /** Global gate, matching the legacy `config.AllowSorting`. Defaults to true. */
  allowSorting?: boolean;
  /** When true `rows` is assumed pre-sorted; the header still cycles and reports. */
  manualSorting?: boolean;
}

export interface UseDataTableSortResult<TRow> {
  sort: DataTableSort | null;
  /** `rows`, sorted — or `rows` untouched under `manualSorting`. */
  sortedRows: TRow[];
  /** Whether a column's header is an activatable sort control. */
  isSortable: (column: DataTableColumn<TRow>) => boolean;
  /** The active direction for a column, or `null` when it is not the sorted column. */
  directionFor: (column: DataTableColumn<TRow>) => DataTableSortDirection | null;
  /** Advance the sort cycle for a column: none → Ascending → Descending → none. */
  toggleSort: (name: string) => void;
}

/**
 * Single-column sort, ported from the legacy `useSorting` hook: activating a new column sorts it
 * ascending and replaces any existing sort, activating the ascending column makes it descending,
 * and activating the descending column clears the sort entirely.
 */
export function useDataTableSort<TRow>({
  columns,
  rows,
  sort: controlledSort,
  defaultSort = null,
  onSortChange,
  allowSorting = true,
  manualSorting = false,
}: UseDataTableSortOptions<TRow>): UseDataTableSortResult<TRow> {
  const isControlled = controlledSort !== undefined;
  const [internalSort, setInternalSort] = React.useState<DataTableSort | null>(defaultSort);
  const sort = isControlled ? controlledSort : internalSort;

  const isSortable = React.useCallback(
    (column: DataTableColumn<TRow>) => allowSorting && (column.sortable ?? true),
    [allowSorting],
  );

  const directionFor = React.useCallback(
    (column: DataTableColumn<TRow>) => (sort?.column === column.name ? sort.direction : null),
    [sort],
  );

  const toggleSort = React.useCallback(
    (name: string) => {
      const column = columns.find((candidate) => candidate.name === name);
      if (!column || !allowSorting || (column.sortable ?? true) === false) {
        return;
      }

      const current = sort?.column === name ? sort.direction : null;
      const direction = nextSortDirection(current);
      const next: DataTableSort | null = direction === null ? null : { column: name, direction };

      if (!isControlled) {
        setInternalSort(next);
      }
      onSortChange?.(next);
    },
    [allowSorting, columns, isControlled, onSortChange, sort],
  );

  const sortedRows = React.useMemo(() => {
    if (manualSorting || !sort) {
      return rows;
    }
    const column = columns.find((candidate) => candidate.name === sort.column);
    if (!column) {
      return rows;
    }
    return sortRows(rows, column, sort.direction);
  }, [columns, manualSorting, rows, sort]);

  return { sort, sortedRows, isSortable, directionFor, toggleSort };
}
