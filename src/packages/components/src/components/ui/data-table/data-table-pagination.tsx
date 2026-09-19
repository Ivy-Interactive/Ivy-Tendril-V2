import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { densityToIconButtonSize } from "@/components/ui/density-scale";
import { useDensity } from "@/contexts/density-context";
import { Densities } from "@/types/density";

export interface DataTablePaginationProps extends React.HTMLAttributes<HTMLElement> {
  /** 1-based, already clamped into `[1, pageCount]`. */
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions?: number[];
  /** Total row count across all pages. */
  total: number;
  /** 1-based inclusive range shown on this page; `0` for both when there are no rows. */
  rangeStart: number;
  rangeEnd: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  density?: Densities;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const selectDensity: Record<Densities, string> = {
  [Densities.Small]: "h-7 px-1 text-xs",
  [Densities.Medium]: "h-9 px-2 text-sm",
  [Densities.Large]: "h-11 px-3 text-base",
};

/**
 * The page navigator, rendered below the `<table>`. Boundary controls stay in the DOM disabled so
 * the control set does not reflow between pages.
 */
const DataTablePagination = React.forwardRef<HTMLElement, DataTablePaginationProps>(
  (
    {
      page,
      pageCount,
      pageSize,
      pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
      total,
      rangeStart,
      rangeEnd,
      onPageChange,
      onPageSizeChange,
      density: propDensity,
      className,
      ...props
    },
    ref,
  ) => {
    const contextDensity = useDensity();
    const density = propDensity ?? contextDensity;
    const iconSize = densityToIconButtonSize(density);
    const pageSizeId = React.useId();

    const atFirst = page <= 1;
    const atLast = page >= pageCount;

    return (
      <nav
        ref={ref}
        aria-label="Table pagination"
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-t border-border px-2 py-2",
          className,
        )}
        {...props}
      >
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {total === 0 ? "No rows" : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size={iconSize}
              aria-label="Go to first page"
              disabled={atFirst}
              onClick={() => onPageChange(1)}
            >
              <ChevronsLeft aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size={iconSize}
              aria-label="Go to previous page"
              disabled={atFirst}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
          </div>

          <span className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </span>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size={iconSize}
              aria-label="Go to next page"
              disabled={atLast}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size={iconSize}
              aria-label="Go to last page"
              disabled={atLast}
              onClick={() => onPageChange(pageCount)}
            >
              <ChevronsRight aria-hidden="true" />
            </Button>
          </div>

          <label className="flex items-center gap-2" htmlFor={pageSizeId}>
            <span className="text-sm text-muted-foreground">Rows per page</span>
            {/*
              Deliberately a native <select> rather than the Radix `Select` primitive: Radix needs
              `hasPointerCapture`/`scrollIntoView` polyfills that tests/setup.ts does not install,
              and a native select is keyboard- and screen-reader-operable with no extra work. The
              token classes below mirror `SelectTrigger` so it still looks at home.
            */}
            <select
              id={pageSizeId}
              className={cn(
                "box-border cursor-pointer rounded-field border border-input bg-transparent shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-input",
                selectDensity[density],
              )}
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </nav>
    );
  },
);
DataTablePagination.displayName = "DataTablePagination";

export { DataTablePagination, DEFAULT_PAGE_SIZE_OPTIONS };
