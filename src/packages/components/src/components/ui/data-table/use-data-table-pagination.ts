import * as React from "react";

import { clampPage, getPageCount, getPageRange } from "./utils";

export interface UseDataTablePaginationOptions {
  /** Total row count being paged over — `rowCount` under manual pagination, else `rows.length`. */
  total: number;
  /** Controlled 1-based page. `undefined` means uncontrolled. */
  page?: number;
  defaultPage?: number;
  onPageChange?: (page: number) => void;
  /** Controlled page size. `undefined` means uncontrolled. */
  pageSize?: number;
  defaultPageSize?: number;
  onPageSizeChange?: (pageSize: number) => void;
}

export interface UseDataTablePaginationResult {
  /** The effective page, always clamped into `[1, pageCount]`. */
  page: number;
  pageSize: number;
  pageCount: number;
  /** 1-based inclusive range of the current page; `0` for both when there are no rows. */
  rangeStart: number;
  rangeEnd: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

/**
 * Page/page-size state with clamping. A page beyond the end renders the last page rather than an
 * empty body, and the clamp is applied on read only — a controlled `page` is never silently
 * corrected through `onPageChange`.
 */
export function useDataTablePagination({
  total,
  page: controlledPage,
  defaultPage = 1,
  onPageChange,
  pageSize: controlledPageSize,
  defaultPageSize = 10,
  onPageSizeChange,
}: UseDataTablePaginationOptions): UseDataTablePaginationResult {
  const isPageControlled = controlledPage !== undefined;
  const isPageSizeControlled = controlledPageSize !== undefined;

  const [internalPage, setInternalPage] = React.useState(defaultPage);
  const [internalPageSize, setInternalPageSize] = React.useState(defaultPageSize);

  const pageSize = isPageSizeControlled ? controlledPageSize : internalPageSize;
  const pageCount = getPageCount(total, pageSize);
  const page = clampPage(isPageControlled ? controlledPage : internalPage, pageCount);
  const { start: rangeStart, end: rangeEnd } = getPageRange(page, pageSize, total);

  const setPage = React.useCallback(
    (next: number) => {
      const clamped = clampPage(next, pageCount);
      if (!isPageControlled) {
        setInternalPage(clamped);
      }
      onPageChange?.(clamped);
    },
    [isPageControlled, onPageChange, pageCount],
  );

  const setPageSize = React.useCallback(
    (next: number) => {
      if (!isPageSizeControlled) {
        setInternalPageSize(next);
      }
      if (!isPageControlled) {
        setInternalPage(1);
      }
      onPageSizeChange?.(next);
      onPageChange?.(1);
    },
    [isPageControlled, isPageSizeControlled, onPageChange, onPageSizeChange],
  );

  return {
    page,
    pageSize,
    pageCount,
    rangeStart,
    rangeEnd,
    canPreviousPage: page > 1,
    canNextPage: page < pageCount,
    setPage,
    setPageSize,
  };
}
