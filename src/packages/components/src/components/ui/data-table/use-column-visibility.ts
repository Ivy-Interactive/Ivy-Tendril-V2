import * as React from "react";

import type { DataTableColumn, DataTableColumnVisibility } from "./types";
import { getVisibleColumns, isColumnVisible } from "./utils";

export interface UseColumnVisibilityOptions<TRow> {
  columns: DataTableColumn<TRow>[];
  /** Controlled visibility map. `undefined` means uncontrolled. */
  columnVisibility?: DataTableColumnVisibility;
  defaultColumnVisibility?: DataTableColumnVisibility;
  onColumnVisibilityChange?: (visibility: DataTableColumnVisibility) => void;
}

export interface UseColumnVisibilityResult<TRow> {
  /** The visibility overrides as given — keys may be absent. */
  visibility: DataTableColumnVisibility;
  /** Every column resolved to a boolean, suitable for `DataTableColumnOptions`. */
  resolvedVisibility: DataTableColumnVisibility;
  /** Visible columns in render order. */
  visibleColumns: DataTableColumn<TRow>[];
  setColumnVisible: (name: string, visible: boolean) => void;
}

const EMPTY_VISIBILITY: DataTableColumnVisibility = {};

/** Column visibility overrides on top of each column's own `hidden` default. */
export function useColumnVisibility<TRow>({
  columns,
  columnVisibility: controlledVisibility,
  defaultColumnVisibility,
  onColumnVisibilityChange,
}: UseColumnVisibilityOptions<TRow>): UseColumnVisibilityResult<TRow> {
  const isControlled = controlledVisibility !== undefined;
  const [internalVisibility, setInternalVisibility] = React.useState<DataTableColumnVisibility>(
    defaultColumnVisibility ?? EMPTY_VISIBILITY,
  );
  const visibility = isControlled ? controlledVisibility : internalVisibility;

  const setColumnVisible = React.useCallback(
    (name: string, visible: boolean) => {
      const next = { ...visibility, [name]: visible };
      if (!isControlled) {
        setInternalVisibility(next);
      }
      onColumnVisibilityChange?.(next);
    },
    [isControlled, onColumnVisibilityChange, visibility],
  );

  const visibleColumns = React.useMemo(
    () => getVisibleColumns(columns, visibility),
    [columns, visibility],
  );

  const resolvedVisibility = React.useMemo(() => {
    const resolved: DataTableColumnVisibility = {};
    for (const column of columns) {
      resolved[column.name] = isColumnVisible(column, visibility);
    }
    return resolved;
  }, [columns, visibility]);

  return { visibility, resolvedVisibility, visibleColumns, setColumnVisible };
}
