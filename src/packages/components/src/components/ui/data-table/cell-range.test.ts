import { describe, expect, it } from "vite-plus/test";

import {
  cellRangeContains,
  cellRangeRect,
  cellRangeSize,
  cellRangeToHtml,
  cellRangeToText,
  escapeClipboardValue,
} from "./cell-range";

/**
 * The clipboard buffer, asserted against the framework grid's own.
 *
 * Every expectation here is `@glideapps/glide-data-grid/src/data-editor/copy-paste.ts` behaviour,
 * which is what V1's tables copy with. jsdom ships no `ClipboardEvent` and no `DataTransfer`, so the
 * only way to know a paste into Excel is right is for the buffer to be correct by construction and
 * pinned here.
 */
describe("the copy buffer", () => {
  it("joins cells with tabs and rows with newlines, with no trailing newline", () => {
    // `copy-paste.ts:137-153` (`createTextBuffer`).
    expect(
      cellRangeToText([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a\tb\nc\td");
  });

  it("copies no header row", () => {
    // `data-editor.tsx:846` defaults `copyHeaders` to false and V1 never overrides it. A header row
    // pasted into the middle of a spreadsheet is the failure mode that default exists to avoid, so
    // this is pinned rather than left to chance.
    const text = cellRangeToText([["Running"], ["Failed"]]);
    expect(text).toBe("Running\nFailed");
    expect(text).not.toContain("Status");
  });

  it("quotes only the values that would otherwise break the format", () => {
    // `copy-paste.ts:130-135`: the predicate is `/[\t\n"]/` — and deliberately not commas, which
    // only the array-cell path escapes.
    expect(escapeClipboardValue("plain")).toBe("plain");
    expect(escapeClipboardValue("a,b")).toBe("a,b");
    expect(escapeClipboardValue("has\ttab")).toBe('"has\ttab"');
    expect(escapeClipboardValue("has\nnewline")).toBe('"has\nnewline"');
    expect(escapeClipboardValue('say "hi"')).toBe('"say ""hi"""');
  });

  it("escapes inside the rows it emits, not only on its own", () => {
    expect(cellRangeToText([['a"b', "c\td"]])).toBe('"a""b"\t"c\td"');
  });

  it("emits a table for the spreadsheets that prefer text/html", () => {
    // `copy-paste.ts:180-216`. Without this a paste into Sheets lands as one string of
    // tab-separated text in a single cell.
    const html = cellRangeToHtml([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(html).toContain("mso-data-placement:same-cell");
    expect(html).toContain("<table><tbody>");
    expect(html).toContain("<tr><td>a</td><td>b</td></tr>");
    expect(html).toContain("<tr><td>c</td><td>d</td></tr>");
  });

  it("escapes HTML rather than letting a cell's angle brackets become markup", () => {
    expect(cellRangeToHtml([["<b>&</b>"]])).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("turns tabs into spaces in the HTML flavour, which Sheets refuses inside a cell", () => {
    // `copy-paste.ts:155-162`: a tab becomes four spaces, and a run of spaces is wrapped one per
    // element because a browser collapses a bare run of them on paste.
    const html = cellRangeToHtml([["a\tb"]]);
    expect(html).toContain(`<td>a${"<span> </span>".repeat(4)}b</td>`);
    expect(html).not.toContain("\t");
  });
});

describe("the selected rectangle", () => {
  it("covers the same cells dragged up-left as down-right", () => {
    // `data-editor.tsx:1958-1961` normalises with min/max on both axes.
    const down = cellRangeRect({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 4 } });
    const up = cellRangeRect({ anchor: { row: 3, column: 4 }, focus: { row: 1, column: 1 } });
    expect(down).toEqual({ top: 1, left: 1, bottom: 3, right: 4 });
    expect(up).toEqual(down);
  });

  it("counts inclusively, so one cell is one cell", () => {
    expect(cellRangeSize({ anchor: { row: 2, column: 2 }, focus: { row: 2, column: 2 } })).toBe(1);
    expect(cellRangeSize({ anchor: { row: 0, column: 0 }, focus: { row: 2, column: 1 } })).toBe(6);
  });

  it("knows which cells are inside it", () => {
    const range = { anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } };
    expect(cellRangeContains(range, 1, 1)).toBe(true);
    expect(cellRangeContains(range, 2, 2)).toBe(true);
    expect(cellRangeContains(range, 0, 1)).toBe(false);
    expect(cellRangeContains(range, 1, 3)).toBe(false);
  });
});
