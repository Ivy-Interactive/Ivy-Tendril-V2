import * as React from "react";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { DataTableColumn, DataTableColumnVisibility } from "./types";
import { isColumnVisible } from "./utils";

export interface DataTableColumnOptionsProps {
  columns: DataTableColumn<never>[];
  /** Visibility overrides; an absent key falls back to the column's own `hidden` flag. */
  visibility: DataTableColumnVisibility;
  onToggle: (name: string, visible: boolean) => void;
  className?: string;
}

/**
 * The column-visibility checklist. Exported separately from the table so it can be rendered and
 * tested on its own. The last remaining visible column is disabled, so the table can never be
 * emptied of columns.
 */
const DataTableColumnOptions = React.forwardRef<HTMLDivElement, DataTableColumnOptionsProps>(
  ({ columns, visibility, onToggle, className }, ref) => {
    const idPrefix = React.useId();
    const visibleCount = columns.filter((column) => isColumnVisible(column, visibility)).length;

    return (
      <div ref={ref} className={cn("flex flex-col gap-2", className)}>
        {columns.map((column) => {
          const visible = isColumnVisible(column, visibility);
          const id = `${idPrefix}-${column.name}`;

          return (
            <div key={column.name} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={visible}
                disabled={visible && visibleCount <= 1}
                onCheckedChange={(checked) => onToggle(column.name, checked === true)}
              />
              <Label htmlFor={id} className="cursor-pointer font-normal">
                {column.header ?? column.name}
              </Label>
            </div>
          );
        })}
      </div>
    );
  },
);
DataTableColumnOptions.displayName = "DataTableColumnOptions";

export { DataTableColumnOptions };
