import * as React from "react";
import { Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { densityToIconButtonSize } from "@/components/ui/density-scale";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDensity } from "@/contexts/density-context";
import type { Densities } from "@/types/density";

import "./data-table.css";

import { DataTableCellEditor } from "./data-table-cell-editor";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableColumnOptions } from "./data-table-column-options";
import { DataTablePagination, DEFAULT_PAGE_SIZE_OPTIONS } from "./data-table-pagination";
import { DataTableRowActions } from "./data-table-row-actions";
import { DataTableToolbar } from "./data-table-toolbar";
import type {
  DataTableCellCommitEvent,
  DataTableColumn,
  DataTableColumnVisibility,
  DataTableRowAction,
  DataTableRowActionEvent,
  DataTableSort,
  DataTableToolbarSlots,
  DataTableVirtualized,
} from "./types";
import { useColumnVisibility } from "./use-column-visibility";
import { useDataTablePagination } from "./use-data-table-pagination";
import { useDataTableRowFocus } from "./use-data-table-row-focus";
import { useDataTableSort } from "./use-data-table-sort";
import {
  DATA_TABLE_MAX_BODY_HEIGHT,
  DATA_TABLE_OVERSCAN,
  DATA_TABLE_ROW_HEIGHT_ESTIMATES,
  DATA_TABLE_VIRTUALIZATION_THRESHOLD,
  useDataTableVirtualization,
} from "./use-data-table-virtualization";
import { useInlineCellEdit } from "./use-inline-cell-edit";
import { getCellValue, getRenderableActions, toDisplayString } from "./utils";
import { dataTableCellAlignVariant, dataTableRowVariant } from "./variant";

export interface DataTableProps<TRow> extends Omit<
  React.HTMLAttributes<HTMLTableElement>,
  "children" | "className"
> {
  columns: DataTableColumn<TRow>[];
  /** The full row set, unless `manualPagination` — then the current page only. */
  rows: TRow[];
  /**
   * Row key, selection key, and the id handed to callbacks. `index` is the row's position among the
   * rows currently rendered (i.e. within the page under client-side pagination).
   */
  getRowId: (row: TRow, index: number) => string;

  /** Controlled sort; `null` means unsorted. */
  sort?: DataTableSort | null;
  defaultSort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  /** Global sort gate, matching the legacy `config.AllowSorting`. Defaults to true. */
  allowSorting?: boolean;
  /** When true `rows` is assumed pre-sorted; the header still cycles and reports. */
  manualSorting?: boolean;

  /** Controlled 1-based page. */
  page?: number;
  defaultPage?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  defaultPageSize?: number;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  /** `false` hides the pagination footer and renders every row. Defaults to true. */
  paginated?: boolean;
  /** Server-side paging: `rows` is the current page and `rowCount` the total. */
  manualPagination?: boolean;
  rowCount?: number;

  columnVisibility?: DataTableColumnVisibility;
  defaultColumnVisibility?: DataTableColumnVisibility;
  onColumnVisibilityChange?: (visibility: DataTableColumnVisibility) => void;
  /** Renders the column-options trigger in the toolbar. Defaults to false. */
  showColumnOptions?: boolean;

  /** Row selection with a header select-all checkbox. Defaults to false. */
  selectable?: boolean;
  selectedRowIds?: string[];
  defaultSelectedRowIds?: string[];
  onSelectedRowIdsChange?: (ids: string[]) => void;

  /** The function form covers the legacy widget's `rowActions` *and* `perRowActions`. */
  rowActions?: DataTableRowAction<TRow>[] | ((row: TRow) => DataTableRowAction<TRow>[]);
  onRowAction?: (event: DataTableRowActionEvent<TRow>) => void;

  /** Inline editing gate. A cell is editable only when `editable && column.editable`. */
  editable?: boolean;
  /**
   * Called when an inline edit is committed with a changed value. The table never mutates `rows` —
   * update your own data here and pass the new rows back in.
   */
  onCellCommit?: (event: DataTableCellCommitEvent<TRow>) => void | Promise<void>;

  /** Optional row activation. Row actions, selection and the inline editor never trigger it. */
  onRowClick?: (row: TRow, id: string) => void;

  /**
   * Row windowing. `"auto"` (the default) engages only above `virtualizationThreshold` rendered
   * rows, so a default `paginated` call site renders every one of its 10 rows exactly as before.
   *
   * While windowing is active:
   * - Only the visible slice plus `overscan` is in the DOM, padded by two `aria-hidden` spacer rows
   *   so the scrollbar reports the true height. `aria-rowcount`/`aria-rowindex` keep reporting the
   *   real row count and each row's absolute position regardless.
   * - **Text selection cannot extend past the rendered rows.** Rendered rows stay in `<tbody>`
   *   document order so selection across them works normally, but a row that is not mounted cannot
   *   be selected. This is inherent to windowing.
   * - The table switches to `table-layout: fixed`, so column widths stay put instead of twitching
   *   as longer content scrolls in. Zero-width selection and row-action columns get real widths;
   *   override the latter with the `--ivy-data-table-actions-width` custom property.
   */
  virtualized?: DataTableVirtualized;
  /** Rendered-row count above which `virtualized="auto"` engages. Defaults to 50. */
  virtualizationThreshold?: number;
  /**
   * `max-height` of the table's scroll container while windowing is active (a number is px).
   * Defaults to 480. Windowing needs a bounded viewport — without one every row is "visible".
   */
  maxBodyHeight?: number | string;
  /** First-paint row-height estimate in px. Defaults per density (Small 36, Medium 44, Large 52). */
  estimateRowHeight?: number;
  /** Rows rendered beyond the visible range while windowing. Defaults to 8. */
  overscan?: number;

  /** Skeleton body. Defaults to false. */
  loading?: boolean;
  /** Replaces the default muted "No results." row. */
  emptyState?: React.ReactNode;
  /** Header slot above the table for filters and toolbar content. */
  toolbar?: DataTableToolbarSlots;
  caption?: React.ReactNode;
  density?: Densities;
  /** Applied to the wrapper around the toolbar, table and pagination footer. */
  className?: string;
  "data-testid"?: string;
}

const LOADING_ROW_CAP = 5;

function defaultCellContent(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return toDisplayString(value);
}

function DataTableInner<TRow>(
  {
    columns,
    rows,
    getRowId,
    sort,
    defaultSort = null,
    onSortChange,
    allowSorting = true,
    manualSorting = false,
    page,
    defaultPage = 1,
    onPageChange,
    pageSize,
    defaultPageSize = 10,
    onPageSizeChange,
    pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
    paginated = true,
    manualPagination = false,
    rowCount,
    columnVisibility,
    defaultColumnVisibility,
    onColumnVisibilityChange,
    showColumnOptions = false,
    selectable = false,
    selectedRowIds,
    defaultSelectedRowIds,
    onSelectedRowIdsChange,
    rowActions,
    onRowAction,
    editable = false,
    onCellCommit,
    onRowClick,
    virtualized = "auto",
    virtualizationThreshold = DATA_TABLE_VIRTUALIZATION_THRESHOLD,
    maxBodyHeight = DATA_TABLE_MAX_BODY_HEIGHT,
    estimateRowHeight,
    overscan = DATA_TABLE_OVERSCAN,
    loading = false,
    emptyState,
    toolbar,
    caption,
    density: propDensity,
    className,
    ...tableProps
  }: DataTableProps<TRow>,
  ref: React.ForwardedRef<HTMLTableElement>,
) {
  const contextDensity = useDensity();
  const density = propDensity ?? contextDensity;
  const iconButtonSize = densityToIconButtonSize(density);
  const selectionIdPrefix = React.useId();

  const { resolvedVisibility, visibleColumns, setColumnVisible } = useColumnVisibility({
    columns,
    columnVisibility,
    defaultColumnVisibility,
    onColumnVisibilityChange,
  });

  const { sortedRows, isSortable, directionFor, toggleSort } = useDataTableSort({
    columns,
    rows,
    sort,
    defaultSort,
    onSortChange,
    allowSorting,
    manualSorting,
  });

  const total = manualPagination ? (rowCount ?? rows.length) : sortedRows.length;
  const pagination = useDataTablePagination({
    total,
    page,
    defaultPage,
    onPageChange,
    pageSize,
    defaultPageSize,
    onPageSizeChange,
  });

  const pageRows = React.useMemo(() => {
    if (!paginated || manualPagination) return sortedRows;
    const start = (pagination.page - 1) * pagination.pageSize;
    return sortedRows.slice(start, start + pagination.pageSize);
  }, [manualPagination, pagination.page, pagination.pageSize, paginated, sortedRows]);

  const pageRowIds = React.useMemo(
    () => pageRows.map((row, index) => getRowId(row, index)),
    [getRowId, pageRows],
  );

  const isSelectionControlled = selectedRowIds !== undefined;
  const [internalSelected, setInternalSelected] = React.useState<string[]>(
    defaultSelectedRowIds ?? [],
  );
  const selectedIds = isSelectionControlled ? selectedRowIds : internalSelected;
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  const commitSelection = (next: string[]) => {
    if (!isSelectionControlled) {
      setInternalSelected(next);
    }
    onSelectedRowIdsChange?.(next);
  };

  const allPageSelected = pageRowIds.length > 0 && pageRowIds.every((id) => selectedSet.has(id));

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const next = [...selectedIds];
      for (const id of pageRowIds) {
        if (!selectedSet.has(id)) next.push(id);
      }
      commitSelection(next);
      return;
    }
    const pageSet = new Set(pageRowIds);
    commitSelection(selectedIds.filter((id) => !pageSet.has(id)));
  };

  const toggleRowSelected = (id: string, checked: boolean) => {
    commitSelection(checked ? [...selectedIds, id] : selectedIds.filter((other) => other !== id));
  };

  const { isEditing, beginEdit, endEdit, registerCell } = useInlineCellEdit({ editable });

  const resolveActions = React.useCallback(
    (row: TRow): DataTableRowAction<TRow>[] =>
      typeof rowActions === "function" ? rowActions(row) : (rowActions ?? []),
    [rowActions],
  );

  const hasActionsColumn = React.useMemo(() => {
    if (!rowActions) return false;
    if (typeof rowActions !== "function") {
      return getRenderableActions(rowActions).length > 0;
    }
    return pageRows.some((row) => getRenderableActions(rowActions(row)).length > 0);
  }, [pageRows, rowActions]);

  const hasFooter = visibleColumns.some((column) => column.footer !== undefined);
  const columnCount = visibleColumns.length + (selectable ? 1 : 0) + (hasActionsColumn ? 1 : 0);
  const showToolbar = Boolean(toolbar?.left || toolbar?.right || showColumnOptions);

  // Windowing and roving row focus are mutually dependent — the virtualizer pins the focused row
  // into its rendered range, and moving focus scrolls through the virtualizer — so the scroll
  // container ref lives here and `scrollToIndex` is reached through a ref rather than a closure.
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const scrollToIndexRef = React.useRef<(index: number) => void>(() => undefined);
  const scrollToIndex = React.useCallback((index: number) => {
    scrollToIndexRef.current(index);
  }, []);

  const rowFocus = useDataTableRowFocus({
    count: pageRows.length,
    containerRef: scrollContainerRef,
    scrollToIndex,
    estimatedRowHeight: estimateRowHeight ?? DATA_TABLE_ROW_HEIGHT_ESTIMATES[density],
  });

  const virtualization = useDataTableVirtualization({
    containerRef: scrollContainerRef,
    rowIds: pageRowIds,
    virtualized,
    virtualizationThreshold,
    maxBodyHeight,
    estimateRowHeight,
    overscan,
    density,
    pinnedIndex: rowFocus.pinnedIndex,
    enabled: !loading,
  });
  scrollToIndexRef.current = virtualization.scrollToIndex;

  /**
   * Under `table-layout: fixed` a `w-0` utility is taken literally, collapsing the selection and
   * row-action columns and painting their controls over the neighbouring cell. Swap in real widths
   * for the windowed variant; auto layout keeps `w-0`'s shrink-to-fit behaviour.
   */
  const fitColumnClass = (kind: "select" | "actions") =>
    virtualization.active ? `ivy-data-table-fit-${kind}` : "w-0";

  /** 1-based absolute position, so paging and windowing both report true `aria-rowindex` values. */
  const absoluteRowIndex = (rowIndex: number) =>
    manualPagination || !paginated
      ? rowIndex + 1
      : (pagination.page - 1) * pagination.pageSize + rowIndex + 1;

  const spacerRow = (key: string, height: number) => (
    <tr key={key} aria-hidden="true" data-slot="data-table-spacer">
      <td colSpan={Math.max(1, columnCount)} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );

  const columnOptionsControl = showColumnOptions ? (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size={iconButtonSize} aria-label="Column options">
          <Settings2 aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <DataTableColumnOptions
          columns={columns}
          visibility={resolvedVisibility}
          onToggle={setColumnVisible}
        />
      </PopoverContent>
    </Popover>
  ) : null;

  const renderCellContent = (
    column: DataTableColumn<TRow>,
    row: TRow,
    rowId: string,
    rowIndex: number,
  ): React.ReactNode => {
    const value = getCellValue(column, row);
    const rendered = column.cell ? column.cell(value, row, rowIndex) : defaultCellContent(value);
    const label = column.header ?? column.name;
    const cellEditable = editable && (column.editable ?? false);

    if (!cellEditable) {
      return rendered;
    }

    if (isEditing(rowId, column.name)) {
      const previous = toDisplayString(value);
      return (
        <div
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <DataTableCellEditor
            aria-label={`Edit ${label}`}
            value={previous}
            onCommit={(next) => {
              endEdit();
              if (next === previous) return;
              void onCellCommit?.({
                id: rowId,
                row,
                column: column.name,
                value: next,
                previousValue: value,
              });
            }}
            onCancel={endEdit}
          />
        </div>
      );
    }

    return (
      <div
        ref={registerCell(rowId, column.name)}
        role="button"
        tabIndex={0}
        aria-label={`Edit ${label}`}
        className="w-full rounded-field outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.stopPropagation();
          beginEdit(rowId, column.name);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.stopPropagation();
          beginEdit(rowId, column.name);
        }}
      >
        {rendered}
      </div>
    );
  };

  const body = (() => {
    if (loading) {
      const skeletonRows = Math.max(1, Math.min(pagination.pageSize, LOADING_ROW_CAP));
      return Array.from({ length: skeletonRows }, (_, rowIndex) => (
        <TableRow key={`skeleton-${rowIndex}`}>
          {Array.from({ length: Math.max(1, columnCount) }, (__, cellIndex) => (
            <TableCell key={`skeleton-cell-${cellIndex}`}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ));
    }

    if (pageRows.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={Math.max(1, columnCount)} className="text-center">
            {emptyState ?? <span className="text-muted-foreground">No results.</span>}
          </TableCell>
        </TableRow>
      );
    }

    const renderRow = (rowIndex: number) => {
      const row = pageRows[rowIndex];
      const rowId = pageRowIds[rowIndex];
      const rowSelected = selectedSet.has(rowId);
      const actions = hasActionsColumn ? resolveActions(row) : [];

      return (
        <TableRow
          key={rowId}
          // `data-index` is not decoration: virtual-core reads it back off the measured element and
          // warns if it is missing. `data-row-id` is the focus/query handle.
          data-index={rowIndex}
          data-row-id={rowId}
          ref={virtualization.active ? virtualization.measureRowElement : undefined}
          aria-rowindex={absoluteRowIndex(rowIndex)}
          tabIndex={rowFocus.rowTabIndex(rowIndex)}
          onFocus={() => rowFocus.handleRowFocus(rowIndex)}
          data-state={rowSelected ? "selected" : undefined}
          className={cn(
            dataTableRowVariant({ interactive: Boolean(onRowClick), selected: rowSelected }),
            "outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
          onClick={onRowClick ? () => onRowClick(row, rowId) : undefined}
        >
          {selectable ? (
            <TableCell className={fitColumnClass("select")}>
              <div
                className="flex items-center"
                onClick={(event) => event.stopPropagation()}
                role="presentation"
              >
                <Checkbox
                  id={`${selectionIdPrefix}-row-${rowId}`}
                  checked={rowSelected}
                  onCheckedChange={(checked) => toggleRowSelected(rowId, checked === true)}
                />
                <Label htmlFor={`${selectionIdPrefix}-row-${rowId}`} className="sr-only">
                  Select row {rowId}
                </Label>
              </div>
            </TableCell>
          ) : null}

          {visibleColumns.map((column) => (
            <TableCell
              key={column.name}
              className={cn(
                dataTableCellAlignVariant({ align: column.align ?? "Left" }),
                column.wrapText ? "ivy-data-table-wrap" : "ivy-data-table-nowrap",
              )}
              style={column.width ? { width: column.width } : undefined}
            >
              {renderCellContent(column, row, rowId, rowIndex)}
            </TableCell>
          ))}

          {hasActionsColumn ? (
            <TableCell className={fitColumnClass("actions")}>
              <DataTableRowActions
                actions={actions}
                row={row}
                rowId={rowId}
                onRowAction={onRowAction}
              />
            </TableCell>
          ) : null}
        </TableRow>
      );
    };

    const { virtualItems } = virtualization;
    if (!virtualItems) {
      return pageRows.map((_, rowIndex) => renderRow(rowIndex));
    }

    // Real `<tr>`/`<td>` in document order, padded by spacer rows rather than absolutely positioned:
    // absolute positioning would need `display: block` on table/tbody/tr, which destroys column
    // alignment, the sticky `<thead>` and cross-row text selection.
    const rendered: React.ReactNode[] = [];
    if (virtualization.padStart > 0) {
      rendered.push(spacerRow("virtual-pad-start", virtualization.padStart));
    }
    virtualItems.forEach((item, position) => {
      rendered.push(renderRow(item.index));
      // Non-zero only when the focused row is pinned in from outside the contiguous window, which
      // keeps padStart + rendered + gaps + padEnd equal to the true total height even then.
      const gap = virtualization.gapAfter(position);
      if (gap > 0) {
        rendered.push(spacerRow(`virtual-gap-${item.index}`, gap));
      }
    });
    if (virtualization.padEnd > 0) {
      rendered.push(spacerRow("virtual-pad-end", virtualization.padEnd));
    }
    return rendered;
  })();

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      {showToolbar ? (
        <DataTableToolbar
          density={density}
          left={toolbar?.left}
          right={
            <>
              {toolbar?.right}
              {columnOptionsControl}
            </>
          }
        />
      ) : null}

      <div className="rounded-box border border-border bg-background">
        <Table
          ref={ref}
          density={density}
          aria-busy={loading || undefined}
          // Counts data rows only, and the header row carries no `aria-rowindex`. A stricter ARIA
          // reading would include the header (N + 1); N is the convention here, applied whether or
          // not windowing is active so a screen reader always hears the true row count.
          aria-rowcount={total}
          onKeyDown={rowFocus.handleKeyDown}
          className={cn("ivy-data-table", virtualization.active && "ivy-data-table-virtualized")}
          containerRef={scrollContainerRef}
          containerStyle={virtualization.containerStyle}
          {...tableProps}
        >
          {caption ? <TableCaption>{caption}</TableCaption> : null}
          <TableHeader>
            <TableRow>
              {selectable ? (
                <TableHead className={fitColumnClass("select")}>
                  <div className="flex items-center">
                    <Checkbox
                      id={`${selectionIdPrefix}-all`}
                      checked={allPageSelected}
                      onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                    />
                    <Label htmlFor={`${selectionIdPrefix}-all`} className="sr-only">
                      Select all rows
                    </Label>
                  </div>
                </TableHead>
              ) : null}

              {visibleColumns.map((column) => (
                <DataTableColumnHeader
                  key={column.name}
                  column={column}
                  sortable={isSortable(column)}
                  direction={directionFor(column)}
                  onToggleSort={toggleSort}
                />
              ))}

              {hasActionsColumn ? (
                <TableHead aria-label="Row actions" className={fitColumnClass("actions")}>
                  <span className="sr-only">Row actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>

          <TableBody>{body}</TableBody>

          {hasFooter ? (
            <TableFooter>
              <TableRow>
                {selectable ? <TableCell /> : null}
                {visibleColumns.map((column) => (
                  <TableCell
                    key={column.name}
                    className={cn(dataTableCellAlignVariant({ align: column.align ?? "Left" }))}
                  >
                    {column.footer}
                  </TableCell>
                ))}
                {hasActionsColumn ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>

        {paginated ? (
          <DataTablePagination
            density={density}
            page={pagination.page}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            pageSizeOptions={pageSizeOptions}
            total={total}
            rangeStart={pagination.rangeStart}
            rangeEnd={pagination.rangeEnd}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * `React.forwardRef` erases the generic parameter, so the component is cast once through this
 * callable interface to keep row-type inference at the call site. Keep the cast in this one place.
 */
export interface DataTableComponent {
  <TRow>(
    props: DataTableProps<TRow> & { ref?: React.Ref<HTMLTableElement> },
  ): React.ReactElement | null;
  displayName?: string;
}

const DataTable = React.forwardRef(DataTableInner) as DataTableComponent;
DataTable.displayName = "DataTable";

export { DataTable };
