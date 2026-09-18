import * as React from "react";

import type {
  RemoteTableAggregation,
  RemoteTableAggregationResult,
  RemoteTableFetcher,
  RemoteTableFilter,
} from "./remote-query";
import { sortToRemote } from "./remote-query";
import type { DataTableSort } from "./types";
import { getPageCount } from "./utils";

/**
 * Server-paged rows for [`DataTable`], from a table's own query API.
 *
 * `DataTable` has taken `manualPagination` + `rowCount` + `onPageChange` since it was written, so any
 * call site *could* page from a server — by owning page state, page-size state, sort state, a fetch,
 * a loading flag, an error, a race guard and a "the filter narrowed the result, clamp the page" rule.
 * That is roughly eighty lines per table, and the parts that are easy to get wrong (the race, the
 * clamp) are invisible until a user is on page nine of a filtered table. This is those eighty lines,
 * once.
 *
 * What it does *not* do is hold the table. In the default (paged) mode `rows` is one page, replaced on
 * every fetch, which is what makes a table of any size cost the same. Under [`infinite`] it holds the
 * windows the user has actually scrolled through and nothing beyond them, which is the same claim with
 * a different upper bound. It is also why this hook is the answer to "millions of rows" and Arrow is
 * not: Arrow would make each window's bytes smaller and faster to decode, but a client that pages this
 * way over plain JSON already never touches row a million.
 */
export interface UseRemoteDataTableOptions<TRow> {
  /** Performs one request. Injected, so this hook knows nothing about HTTP, Tauri or encodings. */
  fetchPage: RemoteTableFetcher<TRow>;
  /** Rows per page. Also the initial page size; the footer's picker changes it from there. */
  pageSize?: number;
  /** Initial sort. `null` means the server's default order. */
  initialSort?: DataTableSort | null;
  /**
   * The active filter, owned by the caller — facets, search boxes and toolbars live in the view.
   * Changing it resets to page 1, because page 9 of the old result set means nothing in the new one.
   */
  filter?: RemoteTableFilter | null;
  /** Fields to keep in each row. Fewer fields, smaller pages. */
  selectColumns?: string[];
  /** Aggregates over the filtered set, for a footer. */
  aggregations?: RemoteTableAggregation[];
  /** `false` holds off fetching — for a table behind a tab that has not been opened. */
  enabled?: boolean;
  /** Called on a failed fetch. The error is also exposed as `error`. */
  onError?: (error: unknown) => void;

  /**
   * Infinite scroll rather than pages.
   *
   * The request discipline is identical — the same windows, the same offsets, the same race guard —
   * and the only difference is what happens to the window that arrives: a paged table replaces its
   * rows with it, an infinite one appends. So a page number stops being something a user picks and
   * becomes "how far down have I scrolled", which is what [`loadMore`] advances and what
   * [`UseRemoteDataTableResult.hasMore`] answers.
   *
   * The framework's grid reaches the same place from the other side: it keeps a sparse, LRU-evicted
   * cache of chunks because its grid asks for arbitrary cell ranges. A `<table>` windowed by
   * `useDataTableVirtualization` only ever renders a contiguous run, so a dense append is the same
   * behaviour without the cache — and, unlike an LRU, it cannot evict a row the user is looking at.
   */
  infinite?: boolean;
  /**
   * Row identity, used only to drop a row an appended window repeats.
   *
   * A live table shifts under a reader: a job finishing while page two is in flight moves a row from
   * one window into the next, and the same row would arrive twice. Without this the duplicate reaches
   * React as a duplicate key; with it, the first sighting wins. Optional because a static table cannot
   * shift, but pass it for anything the server is still writing to.
   */
  getRowKey?: (row: TRow) => string;
}

/** Props to spread onto [`DataTable`], plus the state a view needs around it. */
export interface UseRemoteDataTableResult<TRow> {
  /**
   * Spread these onto `DataTable`. `columns`, `getRowId` and everything presentational stay the call
   * site's business.
   *
   * The infinite-scroll props are present in both modes rather than in a second, narrower object: a
   * paged table gets `paginated: true`, `hasMore: false` and no `onLoadMore`, which is exactly what
   * `DataTable` defaults to, so one spread serves both and switching `infinite` on needs no change at
   * the call site.
   */
  tableProps: {
    rows: TRow[];
    rowCount: number;
    manualPagination: true;
    manualSorting: true;
    page: number;
    pageSize: number;
    sort: DataTableSort | null;
    loading: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    onSortChange: (sort: DataTableSort | null) => void;
    /** `false` under `infinite`: scrolling replaces the footer's pager. */
    paginated: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore?: () => void;
  };
  /** The rows the table holds: one page, or every window scrolled through under `infinite`. */
  rows: TRow[];
  /** Rows matching the filter across the whole table. */
  total: number;
  page: number;
  pageSize: number;
  sort: DataTableSort | null;
  /**
   * True while a request is in flight. The rows already fetched stay visible underneath — which is
   * what `tableProps.loading` narrows to "and there are none yet", so appending a window never
   * replaces the table with a skeleton.
   */
  loading: boolean;
  /** True while an *appended* window is in flight, i.e. `infinite` and past the first one. */
  loadingMore: boolean;
  /** Whether a further window exists. Always false when not `infinite`. */
  hasMore: boolean;
  /** `undefined` once a fetch succeeds. */
  error: unknown;
  /** The daemon's "rows moved under you" flag for the last response. */
  stale: boolean;
  aggregations: RemoteTableAggregationResult[];
  /**
   * Refetches, without moving the reader.
   *
   * In paged mode that is the current page. Under `infinite` it is every window scrolled through, as
   * one request for `page * pageSize` rows from offset 0, and the result replaces `rows` wholesale.
   *
   * This used to drop back to the first window, on the reasoning that refetching the whole span is a
   * burst of requests nobody asked for. It is one request, not a burst — and dropping the windows is
   * what made a live table blank mid-scroll: the rows collapse from (say) 200 to 50 in the same
   * commit that leaves `scrollTop` where it was, so the viewport is scrolled past the end of the new
   * content and paints an empty body until the clamp lands. Re-fetching the held span avoids that by
   * construction, because the new rows are a superset with the same leading ids: the offset stays
   * valid, `isRowIdentityAppend` stays true, and the measurement cache survives. It also stops the
   * infinite-scroll watcher immediately re-requesting the windows the collapse had just discarded.
   *
   * The cost is bounded by what the user actually scrolled through, which is the set already held in
   * memory and in the DOM, so a refresh is the same order of bytes as the table it is refreshing.
   */
  refresh: () => void;
  /** Requests the next window. No-op unless `infinite`, and while one is already in flight. */
  loadMore: () => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: DataTableSort | null) => void;
}

export const DEFAULT_REMOTE_PAGE_SIZE = 50;

export function useRemoteDataTable<TRow>({
  fetchPage,
  pageSize: initialPageSize = DEFAULT_REMOTE_PAGE_SIZE,
  initialSort = null,
  filter = null,
  selectColumns,
  aggregations,
  enabled = true,
  onError,
  infinite = false,
  getRowKey,
}: UseRemoteDataTableOptions<TRow>): UseRemoteDataTableResult<TRow> {
  const [page, setPageState] = React.useState(1);
  const [pageSize, setPageSizeState] = React.useState(initialPageSize);
  const [sort, setSortState] = React.useState<DataTableSort | null>(initialSort);

  const [rows, setRows] = React.useState<TRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(enabled);
  const [error, setError] = React.useState<unknown>(undefined);
  const [stale, setStale] = React.useState(false);
  const [aggregationResults, setAggregationResults] = React.useState<
    RemoteTableAggregationResult[]
  >([]);
  const [reloadNonce, setReloadNonce] = React.useState(0);

  /* The last `versionToken` seen, sent back so the daemon can say whether the window moved. A ref
     rather than state: it must not be a fetch dependency, or every response would trigger another
     fetch. */
  const versionTokenRef = React.useRef<string | undefined>(undefined);

  /* Race guard. Responses to a filter typed quickly, or to sort clicks in a row, can arrive out of
     order, and the last one to *arrive* is not the last one asked for. Only the newest sequence
     number may write state — without this a table settles on whichever server response was slowest.
     The framework's client has no equivalent, and its own comments note stale responses overwriting
     the table. */
  const requestSeq = React.useRef(0);

  /* Which effect run a `refresh()` is asking to serve, so the fetch below can tell "reload the span
     the reader has scrolled through" from "advance to the next window" - both leave `page` alone
     from the effect's point of view, and only the first replaces the rows.

     Keyed on the nonce *and* the page rather than a boolean the effect clears: a flag read-and-
     cleared inside an effect body is wrong under StrictMode's double invocation, where the second
     run would see it already spent. Matching on both values is idempotent, and the page half expires
     the request as soon as a `loadMore` moves on. */
  const nonceRef = React.useRef(0);
  const pageRef = React.useRef(page);
  pageRef.current = page;
  const spanReload = React.useRef<{ nonce: number; page: number } | null>(null);

  /* Serialized, so a caller passing a fresh object literal every render does not refetch forever.
     `filter` in particular is almost always rebuilt inline from facet state. */
  const requestKey = JSON.stringify({
    filter: filter ?? null,
    selectColumns: selectColumns ?? [],
    aggregations: aggregations ?? [],
    sort: sortToRemote(sort),
  });

  /* A changed query resets the page, and it does so *during* render rather than in an effect: an
     effect would let one fetch go out for page 9 of a result set that no longer exists, only to abort
     it a render later. React re-renders before committing effects when state is set here, so the fetch
     below sees page 1 the first time it runs. */
  const previousRequestKey = React.useRef(requestKey);
  if (previousRequestKey.current !== requestKey) {
    previousRequestKey.current = requestKey;
    if (page !== 1) {
      setPageState(1);
    }
  }

  /* Latest values, read inside the effect. Keeping them out of the dependency list is what lets
     `requestKey` be the single source of "the query changed". */
  const latest = React.useRef({
    fetchPage,
    filter,
    selectColumns,
    aggregations,
    onError,
    getRowKey,
  });
  latest.current = { fetchPage, filter, selectColumns, aggregations, onError, getRowKey };

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const seq = ++requestSeq.current;
    const controller = new AbortController();
    setLoading(true);
    /* A `refresh()` for exactly this state: re-read every window held, as one request from offset 0,
       and replace the rows with the result. See {@link UseRemoteDataTableResult.refresh}. */
    const pending = spanReload.current;
    const reloadSpan = infinite && pending?.nonce === reloadNonce && pending.page === page;
    /* Page 1 is otherwise the only window that *replaces* the rows, in either mode. Under `infinite`
       that makes one rule cover the two remaining ways a table starts over — a new filter and a new
       sort — and nothing else has to know it happened, because both reset the page first. */
    const append = infinite && page > 1 && !reloadSpan;

    const run = async () => {
      const {
        fetchPage: fetcher,
        filter: activeFilter,
        selectColumns: columns,
        aggregations: aggs,
        onError: reportError,
        getRowKey: rowKey,
      } = latest.current;
      try {
        const result = await fetcher({
          offset: reloadSpan ? 0 : (page - 1) * pageSize,
          limit: reloadSpan ? page * pageSize : pageSize,
          sort: sortToRemote(sort),
          filter: activeFilter ?? null,
          selectColumns: columns,
          aggregations: aggs,
          versionToken: versionTokenRef.current,
          signal: controller.signal,
        });
        if (seq !== requestSeq.current) return;

        versionTokenRef.current = result.versionToken;
        setRows((previous) => (append ? appendRows(previous, result.rows, rowKey) : result.rows));
        setTotal(result.totalRows);
        setStale(Boolean(result.stale));
        setAggregationResults(result.aggregations ?? []);
        setError(undefined);
        setLoading(false);
      } catch (caught) {
        if (seq !== requestSeq.current || controller.signal.aborted) return;
        setError(caught);
        setLoading(false);
        reportError?.(caught);
      }
    };

    void run();
    return () => {
      controller.abort();
    };
  }, [enabled, infinite, page, pageSize, requestKey, reloadNonce, sort]);

  /* The page a filter left behind. Narrowing a result set while the user is on page nine asks the
     server for an offset past the end, and the honest answer is an empty page — so the table would
     show "no results" for a filter that matches plenty. Clamping here, after the response, rather than
     when the filter changes, is deliberate: only the server knows the new total. */
  const pageCount = getPageCount(total, pageSize);
  React.useEffect(() => {
    if (loading || total === 0 || page <= pageCount) return;
    setPageState(pageCount);
  }, [loading, page, pageCount, total]);

  const setPage = React.useCallback((next: number) => {
    setPageState(Math.max(1, Math.trunc(next)));
  }, []);

  const setPageSize = React.useCallback((next: number) => {
    setPageSizeState(Math.max(1, Math.trunc(next)));
    // A page number means a different window at a different size, so the only stable answer is the
    // first one. This matches what the table's own footer does under client-side pagination.
    setPageState(1);
  }, []);

  const setSort = React.useCallback((next: DataTableSort | null) => {
    setSortState(next);
    setPageState(1);
  }, []);

  const refresh = React.useCallback(() => {
    const nonce = nonceRef.current + 1;
    nonceRef.current = nonce;
    /* Under `infinite` the page is where the reader is, not a window index to reset - the fetch
       effect reads this and asks for the whole span instead. A paged table has one window either
       way, so recording the request is harmless there and the branch stays out of the fetch. */
    spanReload.current = { nonce, page: pageRef.current };
    if (!infinite) {
      setPageState(1);
    }
    setReloadNonce(nonce);
  }, [infinite]);

  /* `loadMore` fires from a scroll handler, which can run several times between two renders, so its
     guards read a ref rather than the closed-over render values. Two calls in the same frame both
     compute the same next page, so the extra one is a no-op rather than a skipped window. */
  const loadMoreState = React.useRef({ infinite, loading, page, pageSize, total });
  loadMoreState.current = { infinite, loading, page, pageSize, total };

  const loadMore = React.useCallback(() => {
    const state = loadMoreState.current;
    if (!state.infinite || state.loading) return;
    if (state.page * state.pageSize >= state.total) return;
    setPageState(state.page + 1);
  }, []);

  /* Measured against windows requested rather than rows held: a live table can hand back a window
     whose rows `getRowKey` already de-duplicated away, and `rows.length < total` would then read as
     "more to come" forever, re-requesting the same tail. */
  const hasMore = infinite && total > 0 && page * pageSize < total;
  const loadingMore = infinite && loading && page > 1;

  return {
    tableProps: {
      rows,
      rowCount: total,
      manualPagination: true,
      manualSorting: true,
      page,
      pageSize,
      sort,
      // The skeleton body replaces the table, so it is only honest before there is a table to
      // replace. An appended window shows `loadingMore` under the rows already on screen instead.
      loading: infinite ? loading && rows.length === 0 : loading,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
      onSortChange: setSort,
      paginated: !infinite,
      hasMore,
      loadingMore,
      onLoadMore: infinite ? loadMore : undefined,
    },
    rows,
    total,
    page,
    pageSize,
    sort,
    loading,
    loadingMore,
    hasMore,
    error,
    stale,
    aggregations: aggregationResults,
    refresh,
    loadMore,
    setPage,
    setPageSize,
    setSort,
  };
}

/**
 * `previous` followed by the rows of `next` it does not already hold.
 *
 * Without `key` this is a plain concatenation, which is the framework's behaviour
 * (`useDataLoading.ts` appends record batches unconditionally). The de-duplication is the addition:
 * the framework's grid addresses rows by index and tolerates a repeat, a keyed `<tbody>` does not.
 */
function appendRows<TRow>(
  previous: TRow[],
  next: TRow[],
  key: ((row: TRow) => string) | undefined,
): TRow[] {
  if (next.length === 0) return previous;
  if (!key) return [...previous, ...next];
  const seen = new Set(previous.map(key));
  const added = next.filter((row) => !seen.has(key(row)));
  return added.length === 0 ? previous : [...previous, ...added];
}
