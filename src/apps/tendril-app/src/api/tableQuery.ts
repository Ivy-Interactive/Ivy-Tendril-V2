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

import type { RemoteTablePage, RemoteTableRequest } from "@ivy-interactive/components/ui";
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
