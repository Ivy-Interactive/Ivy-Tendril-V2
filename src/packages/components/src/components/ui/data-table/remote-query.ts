/**
 * The query a server-paged table sends, and the page it gets back.
 *
 * This mirrors the daemon's `TableQuery`/`QueryPage` (`tendril-core/src/db/query.rs`), which in turn
 * mirrors the Ivy Framework's `datatable.proto`. It is deliberately transport-free: no `fetch`, no
 * URL, no Tauri. `useRemoteDataTable` takes a function that performs the request, so the same hook
 * serves the desktop app over Tauri IPC, a browser over HTTP and a test with a stub.
 *
 * Nothing here mentions Arrow, and that is the point. A page is `{ rows, totalRows, … }` whatever
 * encoded it; swapping the body for an Arrow IPC stream is a change inside the fetch function that
 * decodes it, not a change to this contract or to any call site. The app's `api/tableQuery.ts`
 * documents that change step by step.
 */

/** A sort key. `Ascending`/`Descending` matches `DataTableSort`, which is what the header emits. */
export interface RemoteTableSort {
  column: string;
  direction: "Ascending" | "Descending";
}

/**
 * The comparison vocabulary the daemon accepts, which is the framework's.
 *
 * `inSet`/`notInSet` are the multi-select facet form; `blank`/`notBlank` cover "unset or empty".
 * Spelling is normalised server-side, so `greaterThan` and `greater_than` are the same function.
 */
export type RemoteTableFilterFunction =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "inSet"
  | "notInSet"
  | "isNull"
  | "isNotNull"
  | "blank"
  | "notBlank"
  | "inRange";

/** A scalar filter argument. Sets are expressed as several args to `inSet`, not as a nested array. */
export type RemoteTableFilterArg = string | number | boolean | null;

export interface RemoteTableCondition {
  column: string;
  function: RemoteTableFilterFunction;
  args?: RemoteTableFilterArg[];
}

export interface RemoteTableFilterGroup {
  op: "and" | "or";
  filters: RemoteTableFilter[];
}

/**
 * One node of the recursive filter: a leaf condition or a group, either optionally negated.
 *
 * The two shapes are exclusive, matching the proto's `oneof`. Build them with [`whereColumn`],
 * [`allOf`], [`anyOf`] and [`not`] rather than by hand.
 */
export type RemoteTableFilter = { negate?: boolean } & (
  | { condition: RemoteTableCondition; group?: never }
  | { group: RemoteTableFilterGroup; condition?: never }
);

export interface RemoteTableAggregation {
  column: string;
  function: "sum" | "avg" | "min" | "max" | "count";
}

/** What the hook asks the transport for. Every field is already resolved — no defaults to apply. */
export interface RemoteTableRequest {
  /** First row of the window, 0-based. */
  offset: number;
  limit: number;
  sort: RemoteTableSort[];
  filter?: RemoteTableFilter | null;
  /** Response fields to keep. Empty or absent means all of them. */
  selectColumns?: string[];
  aggregations?: RemoteTableAggregation[];
  /** The token from the last page this table saw, so the daemon can report a shifted window. */
  versionToken?: string;
  /** Aborted when a newer request supersedes this one. Honour it if the transport can. */
  signal?: AbortSignal;
}

export interface RemoteTableAggregationResult {
  column: string;
  function: string;
  value: number | string | null;
}

/** One window of a table. `totalRows` is the filtered total, which is what a footer needs. */
export interface RemoteTablePage<TRow> {
  rows: TRow[];
  /** Rows matching the filter across the whole table, not the length of `rows`. */
  totalRows: number;
  offset?: number;
  rowCount?: number;
  limit?: number;
  versionToken?: string;
  /** The daemon's answer to "has the window I am paging through moved?" */
  stale?: boolean;
  aggregations?: RemoteTableAggregationResult[];
}

/** Performs one request. The hook owns when to call it; this owns how to reach the server. */
export type RemoteTableFetcher<TRow> = (
  request: RemoteTableRequest,
) => Promise<RemoteTablePage<TRow>>;

/** A leaf condition. `whereColumn("status", "inSet", ["Running", "Queued"])`. */
export function whereColumn(
  column: string,
  fn: RemoteTableFilterFunction,
  args: RemoteTableFilterArg[] = [],
): RemoteTableFilter {
  return { condition: { column, function: fn, args } };
}

/**
 * ANDs its children, dropping empty ones.
 *
 * Returning `null` for "nothing to filter on" rather than an empty group is what keeps a half-built
 * filter from narrowing anything: the daemon reads an empty `and` as "every row" and an empty `or` as
 * "no rows", and a table whose facets are all cleared means the former.
 */
export function allOf(
  ...filters: (RemoteTableFilter | null | undefined)[]
): RemoteTableFilter | null {
  const present = filters.filter((filter): filter is RemoteTableFilter => Boolean(filter));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return { group: { op: "and", filters: present } };
}

/** ORs its children. An `anyOf` of nothing is `null`, i.e. no constraint — not "no rows". */
export function anyOf(
  ...filters: (RemoteTableFilter | null | undefined)[]
): RemoteTableFilter | null {
  const present = filters.filter((filter): filter is RemoteTableFilter => Boolean(filter));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return { group: { op: "or", filters: present } };
}

/**
 * Negates a filter.
 *
 * Beware the three-valued logic this inherits from SQL: `not(whereColumn("cost", "greaterThan", [5]))`
 * does not match rows whose cost is unset, because `NOT NULL` is NULL, not true. Use `anyOf` with an
 * explicit `isNull` when unset rows belong in the result.
 */
export function not(filter: RemoteTableFilter | null | undefined): RemoteTableFilter | null {
  if (!filter) return null;
  return { ...filter, negate: !filter.negate } as RemoteTableFilter;
}

/** `DataTableSort | null` — what the table's header emits — as the wire's sort list. */
export function sortToRemote(
  sort: { column: string; direction: "Ascending" | "Descending" } | null | undefined,
): RemoteTableSort[] {
  return sort ? [{ column: sort.column, direction: sort.direction }] : [];
}

/**
 * The subset of a column declaration that says what the server calls it.
 *
 * A `DataTableColumn` satisfies this, and so does a bare `{ name, sortColumn }` list — which is what a
 * view wants when the mapping belongs next to its column declarations but the fetcher is built before
 * them.
 */
export interface RemoteSortColumn {
  name: string;
  sortColumn?: string;
  filter?: { column?: string };
}

/**
 * A sort list with each column renamed to what the *server* calls it.
 *
 * A header emits `column.name`, which is a key in the row type the table renders — and a row type is
 * not a schema. `sortColumn ?? filter.column ?? name` is the chain, so a column that already declared a
 * rename for filtering needs nothing further, and only a genuinely derived column (a timer counting up
 * from a start time, ordered by the recorded duration) has to say so twice.
 *
 * Apply it in the fetcher, not in the hook: the hook has no columns, and a table whose transport is a
 * stub in a test should see exactly what the header emitted.
 */
export function resolveRemoteSort(
  columns: readonly RemoteSortColumn[],
  sort: readonly RemoteTableSort[],
): RemoteTableSort[] {
  return sort.map((entry) => {
    const column = columns.find((candidate) => candidate.name === entry.column);
    const resolved = column?.sortColumn ?? column?.filter?.column ?? entry.column;
    return resolved === entry.column ? entry : { ...entry, column: resolved };
  });
}
