/**
 * A column's filter declaration, and two readings of a filter that is not an expression.
 *
 * ## Where the filter UI actually is
 *
 * In the toolbar, as one expression — see `filter-expression.ts`, which is the front end the framework's
 * grid has (`widgets/dataTables/options/DataTableFilterOption.tsx`) and the one `DataTable` renders. This
 * module is what survives from the per-column controls that briefly stood in for it, and all of it is
 * still load-bearing:
 *
 * 1. **[`DataTableColumnFilter`]** — the *declaration* on a column: whether it is filterable at all
 *    (`.Filterable(column, false)` is the absence of it), what the server calls it, which condition it
 *    means by default, and, for a closed set, which values it can hold. The expression parser resolves
 *    names through this, and the editor's help lists those values.
 * 2. **[`columnFiltersToRemoteFilter`]** — the payload builder for a facet-shaped front end: `Record<
 *    column, values[]>` to the daemon's recursive `Filter`. A second front end onto the same
 *    [`RemoteTableFilter`] costs nothing to keep and is what a toolbar of dropdowns would use.
 * 3. **[`matchesColumnFilters`]** — the same filter evaluated *in the client*, with the daemon's own
 *    case sensitivity. For a table whose rows the client already holds, which is not the server-paged
 *    case and must not be confused with it.
 *
 * ## The vocabulary is fixed, and it is the server's
 *
 * Because every `JobItemRow` property is a string, the framework's editor offers a Jobs column exactly
 * `equals`, `contains`, `starts with`, `ends with`, `IS BLANK` and `IS NOT BLANK`
 * (`lib/filter-query-editor/components/extensions/autocomplete.ts`), and conditions combine with
 * `AND`/`OR`. So the conditions here are the framework's conditions; only the control that produces them
 * differs. `inSet` is the one addition — `[Status] = "a" OR [Status] = "b"` as a single indexed `IN`,
 * which the proto has always had and the editor cannot type.
 */

import type {
  RemoteTableFilter,
  RemoteTableFilterFunction,
  RemoteTableFilterArg,
} from "./remote-query";
import { allOf, whereColumn } from "./remote-query";
import type { DataTableColumn } from "./types";
import { getCellValue, toDisplayString } from "./utils";

/** One choice in a `"select"` filter. `label` falls back to `value`. */
export interface DataTableFilterOption {
  value: string;
  label?: string;
}

/**
 * What kind of value a column holds, which decides the condition a filter means by default.
 *
 * - `"text"` — free text. `contains`, which compiles to SQLite `LIKE`.
 * - `"select"` — a closed set. `inSet` when `multiple` (the default) and `equals` otherwise, and the
 *   `options` are the values the filter editor can offer. Jobs' columns are all typed as strings in the
 *   framework, so V1 gets a value list for none of them and V2 gets one for the three whose values are a
 *   closed set — read from `POST /api/tables/{table}/values`, not from the rows on screen.
 */
export type DataTableFilterKind = "text" | "select";

export interface DataTableColumnFilter {
  kind: DataTableFilterKind;
  /** `"select"` only: the values this column can hold, for the filter editor's vocabulary. */
  options?: DataTableFilterOption[];
  /** `"select"` only. Defaults to true. */
  multiple?: boolean;
  placeholder?: string;
  /**
   * Overrides the emitted function. Use it where the default lies about the data: a column holding a
   * *joined list* ("web, api") is not equal to any one project, so its facet emits `contains`.
   */
  function?: RemoteTableFilterFunction;
  /**
   * Column to filter on, where the display column is not the stored one. Defaults to `column.name`.
   * The daemon resolves camelCase against the live schema, so `planId` reaches `PlanId`.
   */
  column?: string;
  /**
   * Further columns that hold the same fact, matched as an OR beside {@link column}.
   *
   * For a cell whose value can come from more than one place. The Jobs table's Plan Id is the case it
   * exists for: what it *shows* is `ReportedPlanId` when the promptware reported one, and the id read
   * off `PlanFile` otherwise — so filtering either column alone silently misses whichever jobs took
   * the other route, and `[Plan Id] = "00681"` matched nothing at all against a folder path.
   */
  alsoColumns?: readonly string[];
}

/**
 * Facet state: column `name` → the values selected for it.
 *
 * One shape for both kinds — a text box is a single-valued list — so a view owns one object, persists
 * one object, and clearing everything is `{}`. An empty or absent list is *no constraint*, never
 * "matches nothing"; see [`allOf`] for why that distinction is load-bearing.
 */
export type DataTableColumnFilters = Record<string, string[]>;

/** Whether anything is actually constraining the table. */
export function hasActiveColumnFilters(filters: DataTableColumnFilters): boolean {
  return Object.values(filters).some((values) => values.some((value) => value.length > 0));
}

/** `filters` without `name`, so a cleared control leaves no empty key behind. */
export function clearColumnFilter(
  filters: DataTableColumnFilters,
  name: string,
): DataTableColumnFilters {
  if (!(name in filters)) return filters;
  const next = { ...filters };
  delete next[name];
  return next;
}

/** `filters` with `name` set, or cleared when `values` is empty. */
export function setColumnFilter(
  filters: DataTableColumnFilters,
  name: string,
  values: string[],
): DataTableColumnFilters {
  const kept = values.filter((value) => value.length > 0);
  if (kept.length === 0) return clearColumnFilter(filters, name);
  return { ...filters, [name]: kept };
}

function defaultFunction(filter: DataTableColumnFilter): RemoteTableFilterFunction {
  if (filter.function) return filter.function;
  if (filter.kind === "text") return "contains";
  return filter.multiple === false ? "equals" : "inSet";
}

/**
 * Facet state as one wire filter, or `null` when nothing is constrained.
 *
 * Columns are ANDed, which is what a row of independent controls means and what the framework's own
 * editor produces for `[a] = x AND [b] = y`. A `"select"` with several values is one `inSet`
 * condition, not several ORed `equals` — the daemon expands it into an `IN (…)`, so the narrowing
 * happens in SQLite's index rather than in a predicate tree.
 *
 * Only columns that declare a `filter` are read. A stale key left in `filters` by a column that has
 * since become unfilterable is ignored rather than sent, because the daemon would answer 400 for a
 * column its schema does not have and the user cannot see the control to clear it.
 */
export function columnFiltersToRemoteFilter<TRow>(
  columns: readonly DataTableColumn<TRow>[],
  filters: DataTableColumnFilters,
): RemoteTableFilter | null {
  const conditions: RemoteTableFilter[] = [];

  for (const column of columns) {
    const spec = column.filter;
    if (!spec) continue;
    const values = (filters[column.name] ?? []).filter((value) => value.length > 0);
    if (values.length === 0) continue;

    const target = spec.column ?? column.name;
    const fn = defaultFunction(spec);
    const args: RemoteTableFilterArg[] = values;

    if (fn === "inSet" || fn === "notInSet" || fn === "inRange") {
      // Set and range functions take the whole list as their argument list.
      conditions.push(whereColumn(target, fn, args));
      continue;
    }
    if (values.length === 1) {
      conditions.push(whereColumn(target, fn, args));
      continue;
    }
    // A scalar function given several values means "any of them", which is the only reading that
    // keeps a multi-select honest when its function had to be overridden — a `contains` facet over a
    // joined-list column, for instance.
    conditions.push({
      group: { op: "or", filters: values.map((value) => whereColumn(target, fn, [value])) },
    });
  }

  return allOf(...conditions);
}

/**
 * Whether one row satisfies the facet state, evaluated in the client.
 *
 * The server is where filtering belongs, and [`columnFiltersToRemoteFilter`] is the path there. This
 * exists because a table whose rows the client already holds — V1's Jobs table is one: it filters the
 * in-memory `JobService.GetJobs()` dictionary, not the database — still has to mean the *same thing* by
 * a filter as the daemon would. Two independent readings of one filter state is how a facet comes to
 * show different rows depending on which transport answered.
 *
 * So the semantics are the daemon's (`tendril-core/src/db/query.rs` `condition_sql`), not JavaScript's
 * defaults:
 *
 * - `contains`, `startsWith`, `endsWith` compile to SQLite `LIKE`, which is **ASCII
 *   case-insensitive** — so they are case-insensitive here.
 * - `equals`, `notEquals`, `inSet`, `notInSet` compile to `=`/`IN`, which under SQLite's default
 *   BINARY collation are **case-sensitive** — so they are case-sensitive here.
 * - `blank`/`notBlank` treat null, undefined and the empty string alike, as `IS NULL OR = ''` does.
 *
 * A column whose `filter` names a different `column` (a display column backed by another field) is
 * matched against the *display* column's value, because that is the only value the client has.
 */
export function matchesColumnFilters<TRow>(
  columns: readonly DataTableColumn<TRow>[],
  filters: DataTableColumnFilters,
  row: TRow,
): boolean {
  for (const column of columns) {
    const spec = column.filter;
    if (!spec) continue;
    const values = (filters[column.name] ?? []).filter((value) => value.length > 0);
    if (values.length === 0) continue;

    const cell = toDisplayString(getCellValue(column, row));
    if (!matchesCondition(cell, defaultFunction(spec), values)) return false;
  }
  return true;
}

function matchesCondition(cell: string, fn: RemoteTableFilterFunction, values: string[]): boolean {
  const lower = cell.toLowerCase();
  switch (fn) {
    case "inSet":
      return values.includes(cell);
    case "notInSet":
      return !values.includes(cell);
    case "equals":
      return values.some((value) => value === cell);
    case "notEquals":
      return values.every((value) => value !== cell);
    case "contains":
      return values.some((value) => lower.includes(value.toLowerCase()));
    case "notContains":
      return values.every((value) => !lower.includes(value.toLowerCase()));
    case "startsWith":
      return values.some((value) => lower.startsWith(value.toLowerCase()));
    case "endsWith":
      return values.some((value) => lower.endsWith(value.toLowerCase()));
    case "blank":
    case "isNull":
      return cell.length === 0;
    case "notBlank":
    case "isNotNull":
      return cell.length > 0;
    default:
      // Numeric and range comparisons have no header control yet, and guessing at one here would let a
      // client-side table disagree with the daemon. Unconstrained is the honest answer.
      return true;
  }
}
