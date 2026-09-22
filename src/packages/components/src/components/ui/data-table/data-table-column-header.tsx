import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTranslation, type TFunction } from "@/i18n/uiCommon";
import { TableHead, type TableHeadProps } from "@/components/ui/table";
import { tableHeadGripOffsetVariant } from "@/components/ui/table/table-variant";
import { useTableScale } from "@/components/ui/table/useTableSize";
import { DataTableColumnResizer } from "./data-table-column-resizer";
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

  /** Renders the trailing resize handle. */
  resizable?: boolean;
  /**
   * The width the resize handle reports and steps from.
   *
   * The resolved width in px — the live override if there is one, else the declared `column.width`,
   * else the measured `<th>`. A resize has to start from what the column *is*, or the first keyboard
   * step would jump it to some default first.
   */
  resizeWidth?: number;
  onResize?: (width: number) => void;
  onResetWidth?: () => void;

  /** Renders the leading reorder grip. */
  reorderable?: boolean;
  /** True while this column is the one being dragged. */
  dragging?: boolean;
  /** True while a drop here is what would happen on release. */
  dropTarget?: boolean;
  onReorderStart?: () => void;
  onReorderOver?: () => void;
  /** Moves this column one position left (`-1`) or right (`1`) — the grip's keyboard equivalent. */
  onReorderNudge?: (direction: -1 | 1) => void;
  /** Position among the visible columns and their count, for the grip's accessible name. */
  columnPosition?: number;
  columnTotal?: number;
}

function sortActionLabel(
  t: TFunction,
  label: string,
  direction: DataTableSortDirection | null,
): string {
  const next = nextSortDirection(direction);
  if (next === "Ascending") return t("dataTable.columnHeader.sortAscending", { column: label });
  if (next === "Descending") return t("dataTable.columnHeader.sortDescending", { column: label });
  return t("dataTable.columnHeader.clearSort", { column: label });
}

/**
 * A single `<th>`. Sortable headers wrap their label in a real `<button>` so Enter and Space
 * activate natively and the header joins the tab order; non-sortable headers render plain text and
 * carry no `aria-sort` at all.
 *
 * With `resizable` or `reorderable` the cell also hosts a trailing resize separator and a leading
 * drag grip. Both are real focusable controls with keyboard equivalents rather than mouse-only
 * affordances, and both `stopPropagation` so neither can be mistaken for a sort click.
 */
function DataTableColumnHeaderInner<TRow>(
  {
    column,
    sortable = false,
    direction = null,
    onToggleSort,
    resizable = false,
    resizeWidth,
    onResize,
    onResetWidth,
    reorderable = false,
    dragging = false,
    dropTarget = false,
    onReorderStart,
    onReorderOver,
    onReorderNudge,
    columnPosition,
    columnTotal,
    className,
    style,
    ...props
  }: DataTableColumnHeaderProps<TRow>,
  ref: React.ForwardedRef<HTMLTableCellElement>,
) {
  const { t } = useTranslation("uiCommon");
  const label = column.header ?? column.name;
  /* The grip is positioned against this cell's own horizontal padding, which is keyed by density —
     the same source `TableHead` resolves its `px-*` from, so the two cannot drift. */
  const density = useTableScale();

  /*
   * The column's label, as an *accessible description* for the grip and the resize handle rather
   * than as part of their names.
   *
   * Two of these controls now ship on every header cell of every table in the app, and if their
   * accessible names contained the column label then "the Timer button" would name three different
   * controls — the sort button, the grip and the resizer. That is a real ambiguity for someone
   * driving by voice or by a screen reader's element list, not only for a test query; the first
   * thing it broke was `jobs-view.test.tsx:178`'s `getByRole("button", { name: /Timer/ })`, which
   * had been unambiguous since the table was written.
   *
   * `aria-describedby` is the right half of the name/description split for this: the *name* says
   * what the control does ("Reorder column"), the *description* says which one it acts on, and a
   * screen reader reads both. The `id` goes on the label text itself so there is nothing to keep in
   * sync.
   */
  const labelId = `${React.useId()}-label`;

  /* The active direction is always drawn — it is state, and a sort nobody can see is a table sorted
     for no reason. The neutral "this column sorts" chevron is an *affordance*, so it stays hidden
     until the header is hovered or the sort button focused: one per column, always painted, is a row
     of arrows competing with the labels. */
  const indicator =
    direction === "Ascending" ? (
      <ArrowUp aria-hidden="true" className="size-3.5 shrink-0" />
    ) : direction === "Descending" ? (
      <ArrowDown aria-hidden="true" className="size-3.5 shrink-0" />
    ) : (
      <ChevronsUpDown
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover/th:opacity-100 group-focus-visible/sort:opacity-100"
      />
    );

  /* A live resize override wins over the declared `column.width`, which becomes the *starting*
     width rather than a fixed one — `useColumnManagement.ts:73-79`, where an existing width is
     never recomputed from the column's declaration. */
  const width = resizeWidth !== undefined ? `${resizeWidth}px` : (column.width ?? style?.width);

  const grip =
    reorderable && onReorderStart ? (
      <button
        type="button"
        data-slot="data-table-column-grip"
        aria-label={
          columnPosition !== undefined && columnTotal !== undefined
            ? t("dataTable.columnHeader.reorderAt", {
                position: columnPosition,
                total: columnTotal,
              })
            : t("dataTable.columnHeader.reorder")
        }
        aria-describedby={labelId}
        // Not draggable-by-HTML5: the drag is tracked on the pointer (see `use-column-reorder.ts`).
        // A `<button>` so Tab reaches it and the arrow keys below are announced as its own.
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onReorderStart();
        }}
        onClick={(event) => {
          // A grip press is a drag, never a sort.
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          onReorderNudge?.(event.key === "ArrowLeft" ? -1 : 1);
        }}
        className={cn(
          "inline-flex shrink-0 cursor-grab items-center rounded-field text-muted-foreground/50",
          "opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          // Out of flow, in the cell's left padding. Hidden it must take *no* width, or every header
          // label sits indented by the grip plus the flex gap while the body cells below it do not —
          // measured at 19.4px of misalignment before this, which reads as the header being a
          // different column from its own rows. `absolute` keeps the reveal from shifting the label
          // sideways on hover, which a width-animated slot would.
          //
          // The offset and the box are the header's own `px-*` at this density (see
          // `tableHeadGripOffsetVariant`), so the icon lands in the gutter at all three rather than
          // overhanging the previous column at Small and sitting well inside the label at Large.
          "absolute top-1/2 -translate-y-1/2 justify-center",
          tableHeadGripOffsetVariant({ density }),
          // Revealed on hovering the header rather than always painted: one of these per column is a
          // row of grips competing with the labels for attention. Focus and an active drag both
          // pin it visible, so the keyboard path is never invisible to the person using it.
          "group-hover/th:opacity-100",
          dragging && "cursor-grabbing opacity-100",
        )}
      >
        <GripVertical aria-hidden="true" className="size-full" />
      </button>
    ) : null;

  return (
    <TableHead
      ref={ref}
      aria-sort={ariaSortValue(sortable, direction)}
      title={column.help}
      style={{ ...style, width }}
      data-dragging={dragging ? "true" : undefined}
      data-drop-target={dropTarget ? "true" : undefined}
      onMouseEnter={reorderable ? onReorderOver : undefined}
      className={cn(
        dataTableCellAlignVariant({ align: column.align ?? "Left" }),
        // `group/th` unconditionally: the quiet affordances below — the sort chevron as well as the
        // grip — are revealed by hovering the header, which is true of a header cell that is neither
        // resizable nor reorderable. `relative` is the containing block for both the resizer and the
        // out-of-flow grip.
        "group/th",
        (resizable || reorderable) && "relative",
        dragging && "opacity-50",
        dropTarget && !dragging && "bg-secondary",
        className,
      )}
      {...props}
    >
      <div className="relative flex min-w-0 items-center gap-1">
        {grip}
        {sortable ? (
          <button
            type="button"
            aria-label={sortActionLabel(t, label, direction)}
            onClick={() => onToggleSort?.(column.name)}
            className="group/sort inline-flex min-w-0 max-w-full items-center gap-1 rounded-field font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span id={labelId} className="truncate">
              {label}
            </span>
            {indicator}
          </button>
        ) : (
          <span id={labelId} className="truncate">
            {label}
          </span>
        )}
      </div>
      {resizable && onResize && onResetWidth ? (
        <DataTableColumnResizer
          describedBy={labelId}
          /* Passed through as `undefined` rather than defaulted, because `undefined` is the signal
             that means "not known yet": the handle then measures the rendered `<th>` at the moment
             a gesture starts. A `0` would be taken literally and the first drag would resize from
             nothing. */
          width={resizeWidth}
          onResize={onResize}
          onReset={onResetWidth}
        />
      ) : null}
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
