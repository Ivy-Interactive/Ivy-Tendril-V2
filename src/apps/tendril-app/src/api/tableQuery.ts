/**
 * The transport half of the server-paged table: it turns a `RemoteTableRequest` from
 * `useRemoteDataTable` into a request to the daemon's query API and its reply into a
 * `RemoteTablePage`.
 *
 * Two routes, both `POST` with a JSON body:
 *
 * - `/api/jobs/query` — the Jobs table, rows in the same `Job` shape `GET /api/jobs` returns, so a
 *   view moving onto it needs no second DTO. [`queryJobsPage`].
 * - `/api/tables/{table}/query` — the generic form, rows as JSON objects keyed by camelCased column
 *   name. [`createTableFetcher`]. `plans` is registered; anything else is a 404 naming what is.
 *
 * The body is the daemon's `TableQuery`, which is the Ivy Framework's `datatable.proto`
 * `DataTableQuery` adapted to HTTP: `sort`, a recursive `filter`, `offset`, `limit`, `selectColumns`,
 * `aggregations`, `versionToken`. Build filters with `whereColumn`/`allOf`/`anyOf`/`not` from
 * `@ivy-interactive/components/ui`.
 *
 * ## Where Arrow would go
 *
 * Exactly here, and nowhere else. The daemon already negotiates on `Accept` and answers 406 for
 * `application/vnd.apache.arrow.stream`. When `apache-arrow` and the Rust `arrow-*` crates land, the
 * change on this side is:
 *
 * 1. `apache-arrow` in `packages/components`' dependencies (it is a peer of the table, not of the
 *    app's transport, so the decoder can live beside the hook if the row mapping needs to be shared).
 * 2. In [`queryTablePath`], send `Accept: application/vnd.apache.arrow.stream`, read
 *    `response.arrayBuffer()` instead of `response.json()`, and build `rows` with
 *    `tableFromIPC(bytes)` — column-wise, one `getChildAt(j).get(i)` per cell.
 * 3. Read the counters (`totalRows`, `offset`, `rowCount`, `versionToken`, `stale`) from response
 *    headers, because the body is no longer JSON. [`toPage`] is the only function that has to know.
 * 4. Convert what Arrow hands back: Int64 columns arrive as `BigInt` and decimals as a scaled
 *    integer, so a job's `tokens` and `cost` need converting where today they are already numbers.
 *
 * `useRemoteDataTable`, `DataTable` and every call site are untouched, because a page is
 * `{ rows, totalRows }` either way. Nothing about the query — sort, filter, offset, limit, totals —
 * changes at all; that is the part that makes a million-row table work, and it works now.
 */

import type {
  RemoteTableFetcher,
  RemoteTablePage,
  RemoteTableRequest,
} from "@ivy-interactive/components/ui";
import { invoke } from "@tauri-apps/api/core";

import type { Job } from "../types/api";

/**
 * The daemon's `TableQuery`. `signal` and other client-only concerns are stripped before sending.
 *
 * A type alias rather than an interface so it is assignable to the transport's `Record<string,
 * unknown>` body without a cast.
 */
export type TableQueryBody = {
  sort?: { column: string; direction: string }[];
  filter?: unknown;
  offset?: number;
  limit?: number;
  selectColumns?: string[];
  aggregations?: { column: string; function: string }[];
  versionToken?: string;
};

/**
 * Request → body.
 *
 * Empty collections are omitted rather than sent as `[]`: the daemon's defaults *are* the empty
 * cases (no sort means its own order, no filter means unfiltered), so an omitted field and an empty
 * one mean the same thing and the smaller body is the honest one.
 */
export function toTableQueryBody(request: RemoteTableRequest): TableQueryBody {
  const body: TableQueryBody = {};
  if (request.sort.length > 0) body.sort = request.sort;
  if (request.filter) body.filter = request.filter;
  if (request.offset > 0) body.offset = request.offset;
  body.limit = request.limit;
  if (request.selectColumns?.length) body.selectColumns = request.selectColumns;
  if (request.aggregations?.length) body.aggregations = request.aggregations;
  if (request.versionToken) body.versionToken = request.versionToken;
  return body;
}

/** The reply, before it is narrowed to a `RemoteTablePage`. */
interface TableQueryResponse<TRow> {
  encoding?: string;
  rows?: TRow[];
  offset?: number;
  rowCount?: number;
  totalRows?: number;
  limit?: number;
  versionToken?: string;
  stale?: boolean;
  aggregations?: { column: string; function: string; value: number | string | null }[];
}

/** Performs one request. Swapped in tests, and the seam an Arrow implementation slots into. */
export type TableQueryTransport = (
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;

/**
 * Tauri IPC when it is available, HTTP otherwise — the same rule `bridge.ts` uses, and for the same
 * reason: the daemon's bearer secret is read from `.master` natively and never enters the webview, so
 * only the Rust side can authenticate. The `fetch` path is the dev server, which proxies `/api`.
 *
 * `cmd_query_table` does not exist in `src-tauri` yet (it is not this module's file to add). Until it
 * does, `invoke` rejects and this falls through to `fetch`, which is correct in a browser and
 * unauthenticated inside the desktop shell. The command is one delegation:
 *
 * ```rust
 * #[tauri::command]
 * pub async fn cmd_query_table(path: String, body: serde_json::Value)
 *     -> Result<serde_json::Value, BridgeError> {
 *     get_client_from_master()?.post_json(&path, body).await
 * }
 * ```
 */
const httpTransport: TableQueryTransport = async (path, body, signal) => {
  try {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      return await invoke<unknown>("cmd_query_table", { path, body });
    }
  } catch {
    /* Fall through to HTTP. */
  }

  const response = await fetch(path, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      // Explicit, so the day the daemon can encode Arrow this call still gets JSON until this module
      // learns to decode it.
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // A 400 from this API names the column or function that was wrong, which is the whole value of
    // the message — surface it rather than the status code alone.
    const detail = await response
      .json()
      .then((payload: { error?: string }) => payload.error)
      .catch(() => undefined);
    throw new Error(detail ?? `Request to ${path} failed (${response.status})`);
  }
  return (await response.json()) as unknown;
};

let transport: TableQueryTransport = httpTransport;

/** Installs a transport. For tests, and for a client that is not on the daemon's machine. */
export function setTableQueryTransport(next: TableQueryTransport): void {
  transport = next;
}

export function resetTableQueryTransport(): void {
  transport = httpTransport;
}

/** Narrows a reply to a page, defaulting the counters a caller can safely assume. */
function toPage<TRow>(payload: unknown): RemoteTablePage<TRow> {
  const response = (payload ?? {}) as TableQueryResponse<TRow>;
  const rows = response.rows ?? [];
  return {
    rows,
    // `totalRows` is what the footer says; falling back to the page length keeps a table usable
    // against a reply that somehow lacks it rather than reporting zero rows for a full page.
    totalRows: response.totalRows ?? rows.length,
    offset: response.offset,
    rowCount: response.rowCount ?? rows.length,
    limit: response.limit,
    versionToken: response.versionToken,
    stale: response.stale,
    aggregations: response.aggregations,
  };
}

/** One window of a table, straight from `POST {path}`. */
export async function queryTablePath<TRow>(
  path: string,
  request: RemoteTableRequest,
): Promise<RemoteTablePage<TRow>> {
  const payload = await transport(path, toTableQueryBody(request), request.signal);
  return toPage<TRow>(payload);
}

/**
 * `POST /api/jobs/query` — one window of the Jobs table.
 *
 * Pass straight to `useRemoteDataTable`'s `fetchPage`.
 */
export function queryJobsPage(request: RemoteTableRequest): Promise<RemoteTablePage<Job>> {
  return queryTablePath<Job>("/api/jobs/query", request);
}

/** `bridge.listJobs`: "the newest `limit` jobs", optionally narrowed to one status. */
export type JobLister = (status?: string, limit?: number) => Promise<Job[]>;

/**
 * One window of the Jobs table over `cmd_list_jobs` — the transport that is actually reachable from
 * the desktop shell today.
 *
 * ## Why this exists rather than [`queryJobsPage`]
 *
 * `POST /api/jobs/query` is the right route and it is finished server-side, but it cannot be called
 * from the packaged app: the webview has no bearer secret, so only a `#[tauri::command]` can
 * authenticate, and `cmd_query_table` does not exist yet (see the note on the transport above). A
 * relative `fetch("/api/jobs/query")` inside the shell resolves against the asset origin, not the
 * daemon. Wiring the Jobs table straight to it would leave the table permanently empty in the one
 * place it matters, which the parity contract calls out by name: wiring nobody can reach is the same
 * as the feature being absent.
 *
 * So this adapts the one jobs listing that *is* reachable to the same [`RemoteTableFetcher`] contract,
 * and every consumer — `useRemoteDataTable`, `DataTable`, the infinite scroll — is identical either
 * way. Swapping it for [`queryJobsPage`] is one line at the call site.
 *
 * ## What it gives up, precisely
 *
 * - **It re-reads from the top.** `cmd_list_jobs` takes a limit and no offset, so window *n* is
 *   `listJobs(offset + limit)` sliced. The rows come back in the daemon's own total order
 *   (`JOBS_DEFAULT_ORDER` then `Id DESC`), so the slices are consistent windows of one sequence and no
 *   row can be shown twice or skipped — but the bytes for a long scroll grow quadratically. At a jobs
 *   list's scale that is a few hundred rows; it is not a model for a million.
 * - **No server-side sort or filter.** The request's `sort` and `filter` are ignored, because the
 *   listing has nowhere to put them. A caller must therefore sort and filter client-side, over the
 *   rows it has loaded — which is exactly what V1's Jobs table does (it filters and sorts the
 *   in-memory `JobService.GetJobs()` dictionary, not the database), so no behaviour is lost relative to
 *   V1. It is lost relative to the daemon, which can do both over the whole table.
 * - **No total.** `totalRows` is a *lower bound*, inferred the way the framework infers `hasMore`
 *   (`widgets/dataTables/utils/tableDataMapper.ts`: `hasMore = numRows === requestedCount`) — a full
 *   window means at least one more row exists, a short one means these are all of them. That is enough
 *   for infinite scroll, which only ever asks "is there more", and not enough for a pager, which is
 *   part of why V1's table has none.
 * - **No cancellation.** `invoke` has no abort, so `request.signal` cannot be honoured. The hook's own
 *   sequence guard still discards a superseded response, so a stale window cannot win a race; it is
 *   only the wasted work that is unavoidable.
 *
 * @param maxRows Ceiling on how far a scroll may go, matching the daemon's own `MAX_LIMIT`. Reaching it
 *   reports no further rows rather than asking for a window the daemon would clamp anyway.
 */
export function createJobsListFetcher(
  listJobs: JobLister,
  maxRows = 5_000,
): RemoteTableFetcher<Job> {
  return async (request) => {
    const end = Math.min(request.offset + request.limit, maxRows);
    const all = await listJobs(undefined, end);
    const rows = all.slice(request.offset);
    const full = all.length >= end && end < maxRows;
    return {
      rows,
      totalRows: all.length + (full ? 1 : 0),
      offset: request.offset,
      rowCount: rows.length,
      limit: request.limit,
    };
  };
}

/**
 * A fetcher for any table the daemon exposes generically — `plans` today.
 *
 * Rows come back as JSON objects keyed by camelCased column name, so the row type is the caller's
 * claim about the projection it asked for.
 */
export function createTableFetcher<TRow>(
  table: string,
): (request: RemoteTableRequest) => Promise<RemoteTablePage<TRow>> {
  const path = `/api/tables/${encodeURIComponent(table)}/query`;
  return (request) => queryTablePath<TRow>(path, request);
}

/** What `POST /api/tables/{table}/values` answers. */
export interface TableColumnValues {
  column: string;
  values: (string | number | boolean)[];
  totalValues: number;
}

/**
 * Distinct values of one column, for a filter facet.
 *
 * A facet cannot be built from the rows on screen — the value a user wants to filter on is usually
 * not among them — so this is what keeps "the client never holds the rows" true for filter building
 * too. `search` narrows server-side, which is what makes it work on a column with a million distinct
 * values.
 */
export async function fetchTableColumnValues(
  table: string,
  column: string,
  options: { search?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<TableColumnValues> {
  const payload = await transport(
    `/api/tables/${encodeURIComponent(table)}/values`,
    { column, search: options.search, limit: options.limit },
    options.signal,
  );
  const response = (payload ?? {}) as Partial<TableColumnValues>;
  return {
    column: response.column ?? column,
    values: response.values ?? [],
    totalValues: response.totalValues ?? 0,
  };
}
