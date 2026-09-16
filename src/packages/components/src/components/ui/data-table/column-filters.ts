/**
 * Per-column header filters, and how they become the wire filter the daemon already understands.
 *
 * ## What the framework does, and why this is the shape of it
 *
 * The Ivy Framework's grid has no per-column filter widgets. `AllowFiltering` renders **one** filter
 * button in the table's toolbar which expands into a CodeMirror expression editor
 * (`widgets/dataTables/options/DataTableFilterOption.tsx`), whose text is parsed by an ANTLR grammar
 * into the recursive `Filter`/`FilterGroup`/`Condition` tree of `datatable.proto` and evaluated
 * server-side (`Views/DataTables/QueryProcessor.cs`). V1's Jobs table is exactly that: `AllowFiltering
 * = true`, `ShowSearch = false` (`Apps/Jobs/JobsApp.DataTable.cs:86-94`), eleven filterable columns
 * (every one except the hidden `Id` and `ErrorContext`, `:83-84`), and typing `[Status] = "Running"`.
 *
 * Two things follow from that, and they are what this module is:
 *
 * 1. **The vocabulary is fixed and it is the server's.** Because every `JobItemRow` property is a
 *    string, the editor offers a Jobs column exactly `equals`, `contains`, `starts with`, `ends with`,
 *    `IS BLANK` and `IS NOT BLANK` (`lib/filter-query-editor/components/extensions/autocomplete.ts`),
 *    and conditions combine with `AND`/`OR`. So the *conditions* here are the framework's conditions;
 *    only the control that produces them differs.
 * 2. **The editor itself is not portable.** It is a CodeMirror language mode plus a generated parser,
 *    and the parity contract's rule is to reuse what exists rather than import a grammar. A control
 *    per column, ANDed, reaches the same payload for every filter V1's Jobs table can actually
 *    express: a closed-set column becomes a checklist (`inSet`, which is `[Status] = "a" OR [Status] =
 *    "b"` without the typing), and a free-text column becomes a text box (`contains`).
 *
 * The one thing this cannot express is a hand-written `OR` *across* columns. Nothing in V1's Jobs app
 * relies on it, and the payload it would need is already representable — [`anyOf`] exists, so an
 * expression editor could be added later as a second front end onto the same [`RemoteTableFilter`]
 * without touching the table, the hook or the route.
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
 * The control a column's header filter renders.
 *
 * - `"text"` — a text box. Commits on Enter or blur, which is the framework editor's discipline
 *   (`DataTableFilterOption.tsx` fires on Enter, never per keystroke), so a filter costs one request
 *   per intent rather than one per character. Emits `contains` by default.
 * - `"select"` — a checklist of `options`. Emits `inSet` when `multiple` (the default) and `equals`
 *   otherwise. This is the affordance the expression editor gives a column it knows to be an enum;
 *   Jobs' columns are all typed as strings there, so V1 gets it for none of them and V2 gets it for
 *   the three whose values are a closed set.
 */
export type DataTableFilterKind = "text" | "select";

export interface DataTableColumnFilter {
  kind: DataTableFilterKind;
  /** `"select"` only. An empty list renders the control disabled — there is nothing to pick. */
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
}

/**
 * Header-filter state: column `name` → the values selected for it.
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
 * The header filters as one wire filter, or `null` when nothing is constrained.
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
 * Whether one row satisfies the header filters, evaluated in the client.
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
