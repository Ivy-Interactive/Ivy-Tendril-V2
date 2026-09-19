import { describe, expect, it } from "vite-plus/test";

import type { DataTableColumnFilters } from "./column-filters";
import {
  clearColumnFilter,
  columnFiltersToRemoteFilter,
  hasActiveColumnFilters,
  matchesColumnFilters,
  setColumnFilter,
} from "./column-filters";
import type { DataTableColumn } from "./types";

/**
 * One filter state, two readings: the wire filter the daemon evaluates and the predicate the client
 * evaluates when it already holds the rows. They have to agree, because a table can be served either
 * way and a facet that means different things depending on the transport is a bug nobody can see.
 *
 * The semantics under test are the daemon's, from `tendril-core/src/db/query.rs` `condition_sql`:
 * `contains`/`startsWith`/`endsWith` become SQLite `LIKE` and are ASCII case-insensitive; `equals` and
 * `inSet` become `=`/`IN` and are case-sensitive under the default BINARY collation.
 */

interface Job {
  id: string;
  status: string;
  project: string;
  prompt: string;
  note: string;
}

const columns: DataTableColumn<Job>[] = [
  { name: "id", header: "Id" },
  { name: "status", header: "Status", filter: { kind: "select", options: [] } },
  {
    name: "project",
    header: "Project",
    filter: { kind: "select", options: [], function: "contains" },
  },
  { name: "prompt", header: "Prompt", filter: { kind: "text", column: "reportedPlanTitle" } },
  { name: "note", header: "Note", filter: { kind: "text", function: "startsWith" } },
];

const row = (over: Partial<Job> = {}): Job => ({
  id: "job-1",
  status: "Running",
  project: "web, api",
  prompt: "Deploy the API",
  note: "retry",
  ...over,
});

describe("column filter state", () => {
  it("treats an empty selection as no constraint rather than as a key", () => {
    expect(hasActiveColumnFilters({})).toBe(false);
    expect(hasActiveColumnFilters({ status: [] })).toBe(false);
    expect(hasActiveColumnFilters({ prompt: [""] })).toBe(false);
    expect(hasActiveColumnFilters({ status: ["Running"] })).toBe(true);
  });

  it("clears a key instead of leaving it empty", () => {
    const set = setColumnFilter({}, "status", ["Running"]);
    expect(set).toEqual({ status: ["Running"] });
    expect(setColumnFilter(set, "status", [])).toEqual({});
    expect(setColumnFilter(set, "status", [""])).toEqual({});
    expect(clearColumnFilter(set, "status")).toEqual({});
    // Nothing to clear returns the same object, so a no-op cannot trigger a refetch.
    expect(clearColumnFilter(set, "prompt")).toBe(set);
  });
});

describe("columnFiltersToRemoteFilter", () => {
  it("is null when nothing is constrained, which means every row and not none", () => {
    expect(columnFiltersToRemoteFilter(columns, {})).toBeNull();
    expect(columnFiltersToRemoteFilter(columns, { status: [] })).toBeNull();
  });

  it("sends a multi-select as one inSet rather than several ORed equals", () => {
    expect(columnFiltersToRemoteFilter(columns, { status: ["Running", "Queued"] })).toEqual({
      condition: { column: "status", function: "inSet", args: ["Running", "Queued"] },
    });
  });

  it("targets the stored column when the display column is not one", () => {
    expect(columnFiltersToRemoteFilter(columns, { prompt: ["api"] })).toEqual({
      condition: { column: "reportedPlanTitle", function: "contains", args: ["api"] },
    });
  });

  it("ORs a scalar function given several values, and ANDs across columns", () => {
    expect(
      columnFiltersToRemoteFilter(columns, { project: ["web", "api"], status: ["Running"] }),
    ).toEqual({
      group: {
        op: "and",
        filters: [
          { condition: { column: "status", function: "inSet", args: ["Running"] } },
          {
            group: {
              op: "or",
              filters: [
                { condition: { column: "project", function: "contains", args: ["web"] } },
                { condition: { column: "project", function: "contains", args: ["api"] } },
              ],
            },
          },
        ],
      },
    });
  });

  it("ignores a stale key for a column that declares no filter", () => {
    // The daemon would answer 400 for a column its schema does not have, and the user cannot see a
    // control to clear.
    expect(columnFiltersToRemoteFilter(columns, { id: ["job-1"], missing: ["x"] })).toBeNull();
  });
});

describe("matchesColumnFilters", () => {
  it("matches nothing away when nothing is constrained", () => {
    expect(matchesColumnFilters(columns, {}, row())).toBe(true);
  });

  it("reads inSet as case-sensitive membership, as IN does", () => {
    expect(matchesColumnFilters(columns, { status: ["Running"] }, row())).toBe(true);
    expect(matchesColumnFilters(columns, { status: ["Queued", "Running"] }, row())).toBe(true);
    expect(matchesColumnFilters(columns, { status: ["Completed"] }, row())).toBe(false);
    // `IN ('running')` does not match 'Running' under SQLite's default collation, so neither does this.
    expect(matchesColumnFilters(columns, { status: ["running"] }, row())).toBe(false);
  });

  it("reads contains as case-insensitive substring, as LIKE does", () => {
    expect(matchesColumnFilters(columns, { prompt: ["api"] }, row())).toBe(true);
    expect(matchesColumnFilters(columns, { prompt: ["API"] }, row())).toBe(true);
    expect(matchesColumnFilters(columns, { prompt: ["rollback"] }, row())).toBe(false);
  });

  it("finds one project inside a joined Project cell", () => {
    // The reason that column overrides its function: "web, api" is equal to neither of its projects.
    expect(matchesColumnFilters(columns, { project: ["api"] }, row())).toBe(true);
    expect(matchesColumnFilters(columns, { project: ["web"] }, row())).toBe(true);
    expect(matchesColumnFilters(columns, { project: ["docs"] }, row())).toBe(false);
    // Several values on a scalar function mean "any of them", matching the ORed group sent on the wire.
    expect(matchesColumnFilters(columns, { project: ["docs", "api"] }, row())).toBe(true);
  });

  it("honours a function override on a text column", () => {
    expect(matchesColumnFilters(columns, { note: ["ret"] }, row())).toBe(true);
    expect(matchesColumnFilters(columns, { note: ["try"] }, row())).toBe(false);
  });

  it("ANDs the columns, as the wire filter does", () => {
    const both: DataTableColumnFilters = { status: ["Running"], prompt: ["api"] };
    expect(matchesColumnFilters(columns, both, row())).toBe(true);
    expect(matchesColumnFilters(columns, both, row({ status: "Completed" }))).toBe(false);
    expect(matchesColumnFilters(columns, both, row({ prompt: "Rebuild the shell" }))).toBe(false);
  });
});
