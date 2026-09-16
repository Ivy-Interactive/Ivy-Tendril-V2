import * as React from "react";

/**
 * Rows from the bottom at which the next window is requested.
 *
 * The framework's number, verbatim: `widgets/dataTables/hooks/useDataLoading.ts:12`
 * `const scrollThreshold = 10;`, checked against glide's visible region as
 * `bottomRow >= visibleRows - scrollThreshold`. Ten rows of lead time is what makes the next window
 * arrive before the user reaches the end of the current one, so scrolling never stops on a gap.
 */
export const DATA_TABLE_LOAD_MORE_THRESHOLD_ROWS = 10;

export interface UseDataTableInfiniteScrollOptions {
  /** The `overflow-auto` wrapper `Table` puts around every table — the element that scrolls. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether a further window exists. `false` detaches the listener entirely. */
  hasMore: boolean;
  /** True while a window is already in flight. The single in-flight guard. */
  loading: boolean;
  /** Requests the next window. Absent means this table does not scroll-load. */
  onLoadMore?: () => void;
  /** Rows from the bottom at which to request. Defaults to ten, the framework's threshold. */
  thresholdRows?: number;
  /** Row height used to turn `thresholdRows` into pixels. */
  rowHeight: number;
  /** Rows currently held. Re-checks whenever it changes, which is what chains one window to the next. */
  rowCount: number;
}

export interface UseDataTableInfiniteScrollResult {
  /** Whether scroll-loading is wired up. `false` when there is no `onLoadMore`. */
  active: boolean;
}

/**
 * Scroll-driven paging for `DataTable`'s body: the "infinite scroll" half of a server-paged table.
 *
 * The framework reaches this from glide-data-grid's `onVisibleRegionChanged`, which reports the
 * visible *row range* of a canvas grid. A `<table>` has no such callback, so the same question is
 * asked of the scroll container in pixels: `scrollHeight - scrollTop - clientHeight` is the distance
 * to the end, and `thresholdRows × rowHeight` is ten rows of it.
 *
 * Two checks, not one, because a scroll event is not the only way to reach the end of a table:
 *
 * 1. **On scroll.** Passive, so it never delays a frame.
 * 2. **Whenever the row count changes** — which also covers the case a scroll listener alone gets
 *    wrong, a window that does not fill the viewport. A 50-row page in a tall pane leaves the
 *    container unscrollable, so no scroll event can ever fire and the table would sit half-empty
 *    against a table of millions. The framework has the same loop for the same reason
 *    (`useDataLoading.ts:26-41`, "keep loading while the container is taller than the rows").
 *
 * The `loading` guard is what keeps that from becoming a request storm: each window's arrival
 * re-checks once, and the chain stops the moment the viewport is covered or `hasMore` goes false.
 */
export function useDataTableInfiniteScroll({
  containerRef,
  hasMore,
  loading,
  onLoadMore,
  thresholdRows = DATA_TABLE_LOAD_MORE_THRESHOLD_ROWS,
  rowHeight,
  rowCount,
}: UseDataTableInfiniteScrollOptions): UseDataTableInfiniteScrollResult {
  const active = Boolean(onLoadMore);

  /* Read through a ref so the effect below does not re-attach its listener every time the callback's
     identity changes — a caller passing an inline arrow would otherwise detach and reattach on every
     render, losing any scroll event that landed in between. */
  const loadMoreRef = React.useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !active || !hasMore || loading) return;

    const threshold = Math.max(1, thresholdRows) * Math.max(1, rowHeight);

    const check = () => {
      // jsdom reports every dimension as 0, which reads as "at the end" — correct, as it happens: a
      // container of no height is not covered, so more rows are exactly what it needs.
      const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (remaining > threshold) return;
      loadMoreRef.current?.();
    };

    container.addEventListener("scroll", check, { passive: true });
    // The unscrollable-viewport case, and the "did this window cover the gap" question after each
    // append. `rowCount` in the dependency list is what makes the latter happen.
    check();
    return () => {
      container.removeEventListener("scroll", check);
    };
  }, [active, containerRef, hasMore, loading, rowCount, rowHeight, thresholdRows]);

  return { active };
}
