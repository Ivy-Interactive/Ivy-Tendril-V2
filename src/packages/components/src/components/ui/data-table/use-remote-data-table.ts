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
 * What it does *not* do is hold rows. `rows` is one page, replaced on every fetch, which is what makes
 * a table of any size cost the same. It is also why this hook is the answer to "millions of rows" and
 * Arrow is not: Arrow would make each page's bytes smaller and faster to decode, but a client that
 * paged this way over plain JSON already never touches row a million.
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
}

/** Props to spread onto [`DataTable`], plus the state a view needs around it. */
export interface UseRemoteDataTableResult<TRow> {
  /**
   * Spread these onto `DataTable`. `columns`, `getRowId` and everything presentational stay the call
   * site's business.
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
  };
  /** The current page's rows. Same array as `tableProps.rows`. */
  rows: TRow[];
  /** Rows matching the filter across the whole table. */
  total: number;
  page: number;
  pageSize: number;
  sort: DataTableSort | null;
  /** True while a request is in flight. The previous page stays visible underneath. */
  loading: boolean;
  /** `undefined` once a fetch succeeds. */
  error: unknown;
  /** The daemon's "rows moved under you" flag for the last response. */
  stale: boolean;
  aggregations: RemoteTableAggregationResult[];
  /** Refetches the current page. */
  refresh: () => void;
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
  const latest = React.useRef({ fetchPage, filter, selectColumns, aggregations, onError });
  latest.current = { fetchPage, filter, selectColumns, aggregations, onError };

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const seq = ++requestSeq.current;
    const controller = new AbortController();
    setLoading(true);

    const run = async () => {
      const {
        fetchPage: fetcher,
        filter: activeFilter,
        selectColumns: columns,
        aggregations: aggs,
        onError: reportError,
      } = latest.current;
      try {
        const result = await fetcher({
          offset: (page - 1) * pageSize,
          limit: pageSize,
          sort: sortToRemote(sort),
          filter: activeFilter ?? null,
          selectColumns: columns,
          aggregations: aggs,
          versionToken: versionTokenRef.current,
          signal: controller.signal,
        });
        if (seq !== requestSeq.current) return;

        versionTokenRef.current = result.versionToken;
        setRows(result.rows);
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
  }, [enabled, page, pageSize, requestKey, reloadNonce, sort]);

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
    setReloadNonce((nonce) => nonce + 1);
  }, []);

  return {
    tableProps: {
      rows,
      rowCount: total,
      manualPagination: true,
      manualSorting: true,
      page,
      pageSize,
      sort,
      loading,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
      onSortChange: setSort,
    },
    rows,
    total,
    page,
    pageSize,
    sort,
    loading,
    error,
    stale,
    aggregations: aggregationResults,
    refresh,
    setPage,
    setPageSize,
    setSort,
  };
}
