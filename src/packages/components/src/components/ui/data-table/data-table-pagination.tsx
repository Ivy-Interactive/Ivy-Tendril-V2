import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { densityToIconButtonSize } from "@/components/ui/density-scale";
import { useDensity } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import { useTranslation } from "@/i18n/uiCommon";

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
    const { t } = useTranslation("uiCommon");
    const contextDensity = useDensity();
    const density = propDensity ?? contextDensity;
    const iconSize = densityToIconButtonSize(density);
    const pageSizeId = React.useId();

    const atFirst = page <= 1;
    const atLast = page >= pageCount;

    return (
      <nav
        ref={ref}
        aria-label={t("dataTable.pagination.ariaLabel")}
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-t border-border px-2 py-2",
          className,
        )}
        {...props}
      >
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {total === 0
            ? t("dataTable.pagination.noRows")
            : t("dataTable.pagination.showing", { start: rangeStart, end: rangeEnd, total })}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size={iconSize}
              aria-label={t("dataTable.pagination.firstPage")}
              disabled={atFirst}
              onClick={() => onPageChange(1)}
            >
              <ChevronsLeft aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size={iconSize}
              aria-label={t("dataTable.pagination.previousPage")}
              disabled={atFirst}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
          </div>

          <span className="text-sm text-muted-foreground">
            {t("dataTable.pagination.page", { page, pageCount })}
          </span>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size={iconSize}
              aria-label={t("dataTable.pagination.nextPage")}
              disabled={atLast}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size={iconSize}
              aria-label={t("dataTable.pagination.lastPage")}
              disabled={atLast}
              onClick={() => onPageChange(pageCount)}
            >
              <ChevronsRight aria-hidden="true" />
            </Button>
          </div>

          <label className="flex items-center gap-2" htmlFor={pageSizeId}>
            <span className="text-sm text-muted-foreground">
              {t("dataTable.pagination.rowsPerPage")}
            </span>
            {/*
              Deliberately a native <select> rather than the Radix `Select` primitive: Radix needs
              `hasPointerCapture`/`scrollIntoView` polyfills that tests/setup.ts does not install,
              and a native select is keyboard- and screen-reader-operable with no extra work.
              `NativeSelect` is the shared styling for exactly that case, so this reads as one
              control set with every other native select in the product.
            */}
            <NativeSelect
              id={pageSizeId}
              density={density}
              wrapperClassName="w-auto"
              className="w-auto"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      </nav>
    );
  },
);
DataTablePagination.displayName = "DataTablePagination";

export { DataTablePagination, DEFAULT_PAGE_SIZE_OPTIONS };
