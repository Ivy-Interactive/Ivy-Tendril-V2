import { describe, expect, it } from "vite-plus/test";

import {
  filterExpressionColumns,
  filterExpressionPlaceholder,
  parseFilterExpression,
} from "./filter-expression";
import type { DataTableColumn } from "./types";

/**
 * The filter expression's grammar and, more importantly, the *payload* it produces.
 *
 * The front end onto the daemon's filter changed — a control per column became one expression, which is
 * where the framework's grid has always had it — but the wire filter did not. So these are the same
 * claims `column-filters.test.ts` makes about `columnFiltersToRemoteFilter`, retargeted at the parser:
 * a set is one `inSet`, free text is `contains`, columns AND together, and every column name is
 * translated to what the *server* calls it before it leaves.
 */

interface Row {
  id: string;
  status: string;
  planId: string;
  prompt: string;
  cost: number | null;
  statusMessage: string;
}

const columns: DataTableColumn<Row>[] = [
  // `.Filterable(t => t.Id, false)`: named in an expression, this is an error rather than a filter.
  { name: "id", header: "Id" },
  {
    name: "status",
    header: "Status",
    filter: { kind: "select", options: [{ value: "Running" }, { value: "Completed" }] },
  },
  // Displayed as one thing, stored as another — the rename the daemon's schema requires.
  { name: "planId", header: "Plan Id", filter: { kind: "text", column: "planFile" } },
  { name: "prompt", header: "Prompt", filter: { kind: "text", column: "reportedPlanTitle" } },
  { name: "cost", header: "Cost", filter: { kind: "text" } },
  { name: "statusMessage", header: "Status Message", filter: { kind: "text" } },
];

function parse(text: string) {
  return parseFilterExpression(columns, text);
}

describe("filterExpressionColumns", () => {
  it("lists only the filterable columns, with the label typed and the name sent", () => {
    expect(filterExpressionColumns(columns)).toEqual([
      { name: "status", label: "Status", column: "status" },
      { name: "planId", label: "Plan Id", column: "planFile" },
      { name: "prompt", label: "Prompt", column: "reportedPlanTitle" },
      { name: "cost", label: "Cost", column: "cost" },
      { name: "statusMessage", label: "Status Message", column: "statusMessage" },
    ]);
  });

  it("builds the placeholder from the table's own first filterable column", () => {
    expect(filterExpressionPlaceholder(columns)).toBe('[Status] contains "…"');
    expect(filterExpressionPlaceholder([{ name: "id" }])).toBe("No filterable columns");
  });
});

describe("parseFilterExpression", () => {
  it("reads an empty expression as no constraint, never as 'matches nothing'", () => {
    // The distinction `allOf` is careful about: clearing the box has to restore the whole table.
    expect(parse("")).toEqual({ filter: null });
    expect(parse("   ")).toEqual({ filter: null });
  });

  it("reads one equality, without wrapping it in a group", () => {
    expect(parse('[Status] = "Running"')).toEqual({
      filter: { condition: { column: "status", function: "equals", args: ["Running"] } },
    });
  });

  it("translates the column to what the server calls it", () => {
    // The whole reason `filter.column` exists: `Plan Id` is a display column over `PlanFile`, and a
    // filter naming the display column would be a 400 from the daemon.
    expect(parse('[Plan Id] contains "00638"')).toEqual({
      filter: { condition: { column: "planFile", function: "contains", args: ["00638"] } },
    });
  });

  it("accepts a column by header, by name, by wire name and in any case", () => {
    for (const written of [
      "[Status Message]",
      "[statusMessage]",
      "statusmessage",
      "Status_Message",
    ]) {
      expect(parse(`${written} is blank`), written).toEqual({
        filter: { condition: { column: "statusMessage", function: "blank", args: [] } },
      });
    }
  });

  it("reads the framework's whole comparison vocabulary", () => {
    const cases: [string, string, unknown[]][] = [
      ['[Status] = "x"', "equals", ["x"]],
      ['[Status] == "x"', "equals", ["x"]],
      ['[Status] != "x"', "notEquals", ["x"]],
      ['[Status] <> "x"', "notEquals", ["x"]],
      ['[Status] contains "x"', "contains", ["x"]],
      ['[Status] not contains "x"', "notContains", ["x"]],
      ['[Status] starts with "x"', "startsWith", ["x"]],
      ['[Status] ends with "x"', "endsWith", ["x"]],
      ["[Status] is blank", "blank", []],
      ["[Status] is not blank", "notBlank", []],
      ["[Status] is null", "isNull", []],
      ["[Status] is not null", "isNotNull", []],
      ["[Cost] > 5", "greaterThan", [5]],
      ["[Cost] >= 5", "greaterThanOrEqual", [5]],
      ["[Cost] < 5", "lessThan", [5]],
      ["[Cost] <= 5.5", "lessThanOrEqual", [5.5]],
    ];
    for (const [text, fn, args] of cases) {
      expect(parse(text), text).toEqual({
        filter: {
          condition: { column: text.startsWith("[Cost]") ? "cost" : "status", function: fn, args },
        },
      });
    }
  });

  it("is case-insensitive about keywords, as the framework's editor is", () => {
    expect(parse('[Status] CONTAINS "x" AND [Cost] > 1').filter).toEqual(
      parse('[Status] contains "x" and [Cost] > 1').filter,
    );
    expect(parse("[Status] IS NOT BLANK").filter).toEqual(parse("[status] is not blank").filter);
  });

  it("sends a set as one `inSet`, not a tree of ORed equalities", () => {
    // The daemon expands this into an `IN (…)`, so the narrowing happens in SQLite's index.
    expect(parse('[Status] in ("Running", "Queued")')).toEqual({
      filter: { condition: { column: "status", function: "inSet", args: ["Running", "Queued"] } },
    });
    expect(parse('[Status] not in ("Failed")')).toEqual({
      filter: { condition: { column: "status", function: "notInSet", args: ["Failed"] } },
    });
  });

  it("ANDs conditions, which is what a row of independent controls used to mean", () => {
    expect(parse('[Status] = "Running" AND [Prompt] contains "rebuild"')).toEqual({
      filter: {
        group: {
          op: "and",
          filters: [
            { condition: { column: "status", function: "equals", args: ["Running"] } },
            { condition: { column: "reportedPlanTitle", function: "contains", args: ["rebuild"] } },
          ],
        },
      },
    });
  });

  it("ORs across columns — the thing per-column controls could not express at all", () => {
    expect(parse('[Status] = "Failed" OR [Status] = "Timeout"')).toEqual({
      filter: {
        group: {
          op: "or",
          filters: [
            { condition: { column: "status", function: "equals", args: ["Failed"] } },
            { condition: { column: "status", function: "equals", args: ["Timeout"] } },
          ],
        },
      },
    });
  });

  it("binds AND tighter than OR, and lets parentheses override it", () => {
    const loose = parse('[Status] = "a" OR [Status] = "b" AND [Cost] > 1');
    expect(loose.filter).toEqual({
      group: {
        op: "or",
        filters: [
          { condition: { column: "status", function: "equals", args: ["a"] } },
          {
            group: {
              op: "and",
              filters: [
                { condition: { column: "status", function: "equals", args: ["b"] } },
                { condition: { column: "cost", function: "greaterThan", args: [1] } },
              ],
            },
          },
        ],
      },
    });

    const grouped = parse('([Status] = "a" OR [Status] = "b") AND [Cost] > 1');
    expect(grouped.filter).toEqual({
      group: {
        op: "and",
        filters: [
          {
            group: {
              op: "or",
              filters: [
                { condition: { column: "status", function: "equals", args: ["a"] } },
                { condition: { column: "status", function: "equals", args: ["b"] } },
              ],
            },
          },
          { condition: { column: "cost", function: "greaterThan", args: [1] } },
        ],
      },
    });
  });

  it("negates a group with NOT", () => {
    expect(parse('NOT [Status] = "Running"')).toEqual({
      filter: {
        condition: { column: "status", function: "equals", args: ["Running"] },
        negate: true,
      },
    });
  });

  it("reads numbers, booleans and null unquoted, and everything else quoted", () => {
    expect(parse("[Cost] > 5").filter).toMatchObject({ condition: { args: [5] } });
    expect(parse("[Cost] = -2.5").filter).toMatchObject({ condition: { args: [-2.5] } });
    expect(parse("[Cost] = null").filter).toMatchObject({ condition: { args: [null] } });
    expect(parse("[Cost] = true").filter).toMatchObject({ condition: { args: [true] } });
    // A bare word is the commonest mistake, so the message says what to do about it.
    expect(parse("[Status] = Running").error).toMatch(/quoted value/);
  });

  it("keeps quotes and escapes inside a value", () => {
    expect(parse('[Prompt] contains "a \\"quoted\\" word"').filter).toMatchObject({
      condition: { args: ['a "quoted" word'] },
    });
    // Single quotes work too, which is what someone reaching for a shell habit will type.
    expect(parse("[Prompt] contains 'rebuild'").filter).toMatchObject({
      condition: { args: ["rebuild"] },
    });
  });

  it("refuses a column that is not filterable, naming the ones that are", () => {
    // `.Filterable(t => t.Id, false)`: `Id` has no filter declaration, so it is not in the vocabulary.
    const refused = parse('[Id] = "00021"');
    expect(refused.filter).toBeNull();
    expect(refused.error).toMatch(/Unknown column 'Id'/);
    expect(refused.error).toMatch(/\[Status\]/);
    expect(refused.error).toMatch(/\[Status Message\]/);
  });

  it("reports what is wrong rather than throwing, so the text can be corrected in place", () => {
    for (const text of [
      '[Status] "Running"',
      "[Status] =",
      '[Status] = "x" [Cost] > 1',
      '([Status] = "x"',
      '[Status] = "x)',
      "[Status] wibbles 3",
      "[Status] is wibbly",
      '[Status] in "Running"',
      "[Status] $ 3",
    ]) {
      const result = parse(text);
      expect(result.filter, text).toBeNull();
      expect(typeof result.error, text).toBe("string");
      expect(result.error, text).not.toBe("");
    }
  });

  it("cannot be used to inject: a column name is only ever one the table declared", () => {
    // The daemon validates identifiers too, but the first gate is here: nothing a user types reaches
    // the wire as a column name unless it resolved to a declared column.
    const injected = parse('[Status; DROP TABLE Jobs] = "x"');
    expect(injected.filter).toBeNull();
    expect(injected.error).toMatch(/Unknown column/);

    // A value, by contrast, is passed through untouched — it is bound as a parameter server-side.
    expect(parse('[Status] = "x\'; DROP TABLE Jobs --"').filter).toEqual({
      condition: { column: "status", function: "equals", args: ["x'; DROP TABLE Jobs --"] },
    });
  });
});
