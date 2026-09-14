import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { TableHead, type TableHeadProps } from "@/components/ui/table";
import type { DataTableColumn, DataTableSortDirection } from "./types";
import { ariaSortValue, nextSortDirection } from "./utils";
import { dataTableCellAlignVariant } from "./variant";

export interface DataTableColumnHeaderProps<TRow> extends Omit<
  TableHeadProps,
  "children" | "onClick"
> {
  column: DataTableColumn<TRow>;
  /** Whether this header is an activatable sort control (global gate ∧ `column.sortable`). */
  sortable?: boolean;
  /** The active sort direction for this column, or `null` when it is not the sorted column. */
  direction?: DataTableSortDirection | null;
  onToggleSort?: (name: string) => void;
}

function sortActionLabel(label: string, direction: DataTableSortDirection | null): string {
  const next = nextSortDirection(direction);
  if (next === "Ascending") return `Sort by ${label} ascending`;
  if (next === "Descending") return `Sort by ${label} descending`;
  return `Clear sort on ${label}`;
}

/**
 * A single `<th>`. Sortable headers wrap their label in a real `<button>` so Enter and Space
 * activate natively and the header joins the tab order; non-sortable headers render plain text and
 * carry no `aria-sort` at all.
 */
function DataTableColumnHeaderInner<TRow>(
  {
    column,
    sortable = false,
    direction = null,
    onToggleSort,
    className,
    style,
    ...props
  }: DataTableColumnHeaderProps<TRow>,
  ref: React.ForwardedRef<HTMLTableCellElement>,
) {
  const label = column.header ?? column.name;

  const indicator =
    direction === "Ascending" ? (
      <ArrowUp aria-hidden="true" className="size-3.5 shrink-0" />
    ) : direction === "Descending" ? (
      <ArrowDown aria-hidden="true" className="size-3.5 shrink-0" />
    ) : (
      <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/60" />
    );

  return (
    <TableHead
      ref={ref}
      aria-sort={ariaSortValue(sortable, direction)}
      title={column.help}
      style={{ ...style, width: column.width ?? style?.width }}
      className={cn(dataTableCellAlignVariant({ align: column.align ?? "Left" }), className)}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          aria-label={sortActionLabel(label, direction)}
          onClick={() => onToggleSort?.(column.name)}
          className="inline-flex max-w-full items-center gap-1 rounded-field font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="truncate">{label}</span>
          {indicator}
        </button>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </TableHead>
  );
}

/** `forwardRef` erases the generic, so the row type is restored by the callable cast below. */
export interface DataTableColumnHeaderComponent {
  <TRow>(
    props: DataTableColumnHeaderProps<TRow> & { ref?: React.Ref<HTMLTableCellElement> },
  ): React.ReactElement;
  displayName?: string;
}

const DataTableColumnHeader = React.forwardRef(
  DataTableColumnHeaderInner,
) as DataTableColumnHeaderComponent;
DataTableColumnHeader.displayName = "DataTableColumnHeader";

export { DataTableColumnHeader };
