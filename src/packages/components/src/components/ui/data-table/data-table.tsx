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
import { DataTableFilterExpression } from "./data-table-filter-expression";
import { DataTableColumnOptions } from "./data-table-column-options";
import { DataTablePagination, DEFAULT_PAGE_SIZE_OPTIONS } from "./data-table-pagination";
import { DataTableRowActions } from "./data-table-row-actions";
import { DataTableToolbar } from "./data-table-toolbar";
import type { RemoteTableFilter } from "./remote-query";
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
import {
  DATA_TABLE_LOAD_MORE_THRESHOLD_ROWS,
  useDataTableInfiniteScroll,
} from "./use-data-table-infinite-scroll";
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
import {
  getCellValue,
  getRenderableActions,
  isRowIdentityAppend,
  rowIdentity,
  toDisplayString,
} from "./utils";
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

  /**
   * The filter control at the top-left of the toolbar — the legacy `config.AllowFiltering`. Defaults to
   * false.
   *
   * One expression over every column that declares `column.filter`, which is where the framework's grid
   * puts its only filter affordance (`widgets/dataTables/DataTableWidget.tsx` renders it as the first
   * child of the header's left group) and what `.Filterable(column, false)` opts a column out of. See
   * `data-table-filter-expression.tsx` for the control and `filter-expression.ts` for the grammar.
   *
   * The table never filters `rows` itself. It reports the expression and the filter it parsed to, and
   * the caller decides what that means — which for a server-paged table is the only correct answer:
   * with rows arriving a window at a time, a client-side predicate would filter the fifty rows on
   * screen and quietly claim the rest of the table matched nothing.
   */
  showFilter?: boolean;
  /** Controlled filter expression. `""` means no filter. */
  filterExpression?: string;
  defaultFilterExpression?: string;
  /**
   * Called on a committed expression, with the text and the wire filter it parsed to (`null` when the
   * box was cleared). An expression that does not parse is never committed, so this never reports one.
   */
  onFilterExpressionChange?: (expression: string, filter: RemoteTableFilter | null) => void;

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
   * Infinite scroll: called when the viewport comes within `loadMoreThreshold` rows of the end and
   * `hasMore` is true. Absent means the table does not scroll-load.
   *
   * This is the framework's row-loading model rather than a pager
   * (`widgets/dataTables/hooks/useDataLoading.ts`), and V1's Jobs table is one of its users —
   * `c.BatchSize = 50` with no `LoadAllRows`, so rows arrive fifty at a time as the operator scrolls
   * and the table never holds a history it has not been asked for. Pair it with
   * `useRemoteDataTable({ infinite: true })`, whose `tableProps` supply all three props below.
   *
   * Windowing (`virtualized`) and this are independent and complementary: windowing bounds what is in
   * the *DOM*, this bounds what is in *memory*. A table wants both.
   */
  onLoadMore?: () => void;
  /** Whether a further window exists. Without it `onLoadMore` is never called. */
  hasMore?: boolean;
  /** True while an appended window is in flight. Renders a "loading more" row and guards re-entry. */
  loadingMore?: boolean;
  /** Rows from the end at which `onLoadMore` fires. Defaults to 10, the framework's threshold. */
  loadMoreThreshold?: number;
  /**
   * Makes the table fill its parent's height, scrolling its own body, instead of growing to fit its
   * rows. Defaults to false.
   *
   * This is what "sticky header" means in practice, and it is the layout the framework's widget uses:
   * a `shrink-0` toolbar above a `flex: 1; min-height: 0; overflow: hidden` grid
   * (`widgets/dataTables/DataTableHeader.tsx`, `styles/style.ts`), which is why V1's filter row,
   * status progress bar and header menu stay put while rows scroll under them. Without it the whole
   * table scrolls inside the page and the header scrolls away with it, however sticky the `<th>` is —
   * `position: sticky` pins an element inside *its* scroll container, and if that container is the
   * page there is nothing to pin against.
   *
   * Requires the parent to be a bounded flex column (`flex h-full min-h-0 flex-col` or similar). It
   * also replaces `maxBodyHeight`, since the bound comes from the parent rather than a fixed pixel
   * height.
   */
  fillHeight?: boolean;
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
    showFilter = false,
    filterExpression,
    defaultFilterExpression,
    onFilterExpressionChange,
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
    onLoadMore,
    hasMore = false,
    loadingMore = false,
    loadMoreThreshold = DATA_TABLE_LOAD_MORE_THRESHOLD_ROWS,
    fillHeight = false,
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

  /* Controlled-or-not, the same shape as `columnVisibility` above it. The expression is read against
     *every* declared column rather than the visible ones: hiding a column is about what is on screen,
     and a filter that stopped applying because a column was hidden would change which rows exist. */
  const isFilterControlled = filterExpression !== undefined;
  const [internalFilter, setInternalFilter] = React.useState(defaultFilterExpression ?? "");
  const activeFilterExpression = isFilterControlled ? filterExpression : internalFilter;
  const commitFilterExpression = (next: string, filter: RemoteTableFilter | null) => {
    if (!isFilterControlled) setInternalFilter(next);
    onFilterExpressionChange?.(next, filter);
  };

  const filterControl = showFilter ? (
    <DataTableFilterExpression
      columns={columns}
      value={activeFilterExpression}
      onCommit={commitFilterExpression}
      density={density}
    />
  ) : null;

  const showToolbar = Boolean(
    toolbar?.left || toolbar?.right || showColumnOptions || filterControl,
  );

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
   * A *replaced* row set returns the scroll viewport to the top; an appended one does not.
   *
   * Windowing already does this through the virtualizer, which is the only correct way to do it while
   * active. This covers the unwindowed case, and it is not cosmetic under infinite scroll: a filter
   * that drops forty accumulated rows back to twenty leaves the viewport scrolled past the new end, so
   * the load-more check reads "at the bottom" and immediately re-requests the windows the filter just
   * discarded.
   */
  const currentRowIdentity = rowIdentity(pageRowIds);
  const lastRowIdentity = React.useRef(currentRowIdentity);
  const virtualizationActiveRef = React.useRef(virtualization.active);
  virtualizationActiveRef.current = virtualization.active;
  React.useEffect(() => {
    const previous = lastRowIdentity.current;
    lastRowIdentity.current = currentRowIdentity;
    if (previous === currentRowIdentity || isRowIdentityAppend(previous, currentRowIdentity))
      return;
    // While windowed, assigning `scrollTop` would leave the virtualizer's own offset stale; its effect
    // has already run `scrollToOffset(0)` for exactly this case.
    if (virtualizationActiveRef.current) return;
    const container = scrollContainerRef.current;
    if (container && container.scrollTop !== 0) container.scrollTop = 0;
  }, [currentRowIdentity]);

  useDataTableInfiniteScroll({
    containerRef: scrollContainerRef,
    hasMore,
    // The skeleton body and an appended window are both "a request is in flight"; neither may trigger
    // a second one.
    loading: loading || loadingMore,
    onLoadMore,
    thresholdRows: loadMoreThreshold,
    rowHeight: estimateRowHeight ?? DATA_TABLE_ROW_HEIGHT_ESTIMATES[density],
    rowCount: pageRows.length,
  });

  /**
   * The selection and row-action columns' width.
   *
   * A real width, always — never the `w-0` shrink-to-fit this used to be outside the windowed variant.
   * Under `table-layout: fixed` (the windowed variant sets it, and a call site can set it too, as V1's
   * Jobs table does with `table-fixed` so its declared column widths bind) `width: 0` is taken
   * literally: the cell collapses, and its `justify-end` flex row then lays its buttons out *ending* at
   * x = 0, i.e. overflowing leftwards across the previous cell. A ghost button has no fill, so the
   * neighbouring cell's text reads straight through the row actions — which is what "the row actions
   * render under the row" looks like. See `data-table.css` for the widths and for the stacking rule
   * that keeps the controls above any content that does overflow.
   */
  const fitColumnClass = (kind: "select" | "actions") => `ivy-data-table-fit-${kind}`;

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
                // `cellContent.ts:583`: a cell with a click handler is drawn with `cursor: pointer`.
                column.clickable && "cursor-pointer",
              )}
              data-clickable={column.clickable ? "true" : undefined}
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

  /**
   * The tail of an infinite-scroll body while the next window is in flight.
   *
   * The framework shows nothing here — rows past the loaded count are blank filler cells
   * (`dataTableEditor/hooks/useCellContent.ts`), so a slow window looks like the end of the table.
   * A skeleton row says "there is more, it is coming", which is the one thing a reader at the bottom of
   * an infinite list needs to know. `aria-live` rather than `aria-busy`: the table itself is not busy,
   * every row it claims to have is present and readable.
   */
  const loadMoreRow =
    loadingMore && pageRows.length > 0 ? (
      <TableRow key="data-table-load-more" data-slot="data-table-load-more" aria-live="polite">
        <TableCell colSpan={Math.max(1, columnCount)}>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 flex-1" />
            <span className="shrink-0 text-xs text-muted-foreground">Loading more…</span>
          </div>
        </TableCell>
      </TableRow>
    ) : null;

  return (
    <div className={cn("flex w-full flex-col gap-2", fillHeight && "min-h-0", className)}>
      {/* `shrink-0`, so the toolbar — the filters, the progress bar, the header menu — is the part of
          the table that does not scroll. This is `DataTableHeader.tsx`'s own class list. */}
      {showToolbar ? (
        <DataTableToolbar
          className={fillHeight ? "shrink-0" : undefined}
          density={density}
          // The filter first, then the caller's own content — the framework's own left-group order
          // (`DataTableWidget.tsx`: the filter option, then `slots.HeaderLeft`).
          left={
            <>
              {filterControl}
              {toolbar?.left}
            </>
          }
          right={
            <>
              {toolbar?.right}
              {columnOptionsControl}
            </>
          }
        />
      ) : null}

      <div
        className={cn(
          "rounded-box border border-border bg-background",
          // The chain a bounded scroll viewport needs: this box takes the remaining height, and
          // `min-h-0` is what stops a flex item from refusing to shrink below its content.
          fillHeight && "flex min-h-0 flex-1 flex-col overflow-hidden",
        )}
      >
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
          containerClassName={fillHeight ? "min-h-0 flex-1" : undefined}
          // `fillHeight` takes its bound from the parent, so a fixed `max-height` on top of it would
          // be a second, smaller bound and the table would stop short of the pane it was told to fill.
          containerStyle={fillHeight ? undefined : virtualization.containerStyle}
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
            {/* One header row, always. The filter is a toolbar affordance rather than a band of
                per-column controls, which is where the framework's grid puts its only one — see
                `showFilter`. */}
          </TableHeader>

          <TableBody>
            {body}
            {loadMoreRow}
          </TableBody>

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
