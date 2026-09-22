import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "data-table.css");
const css = readFileSync(cssPath, "utf-8");

function ruleBody(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No rule for ${selector}`);
  const open = css.indexOf("{", start);
  const end = css.indexOf("}", open);
  return css.slice(open, end + 1);
}

// jsdom applies no CSS, so the windowing tests can only assert DOM structure. These assert the
// styling half of the contract by reading the stylesheet the component ships.
describe("data-table.css", () => {
  it("keeps the header sticky, which windowing relies on rather than reimplements", () => {
    const block = ruleBody(".ivy-data-table thead th");
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/top:\s*0/);
    // Without an opaque background the windowed rows scroll visibly through the header.
    expect(block).toMatch(/background:\s*var\(--background\)/);
  });

  it("pins the whole header section as one block", () => {
    // The section rather than its cells, so the labels cannot be pinned over by anything else the
    // header grows, and no per-density offset has to be written down here.
    const block = ruleBody(".ivy-data-table thead {");
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/top:\s*0/);
    expect(block).toMatch(/background:\s*var\(--background\)/);
  });

  it("pins column widths while windowed, so scrolling does not resize columns", () => {
    const block = ruleBody(".ivy-data-table.ivy-data-table-virtualized");
    expect(block).toMatch(/table-layout:\s*fixed/);
  });

  it("gives the selection and action columns real widths whether or not windowing is active", () => {
    // Unconditional: `table-layout: fixed` takes a `width: 0` literally, and a call site can set fixed
    // layout without windowing being active (V1's Jobs table does, so its declared widths bind). A
    // collapsed action cell lays its buttons out over the previous cell, which is the "row actions
    // render under the row" bug.
    expect(css).not.toMatch(/ivy-data-table-virtualized th\.ivy-data-table-fit/);
    expect(ruleBody("th.ivy-data-table-fit-select")).toMatch(/width:/);
    expect(ruleBody("th.ivy-data-table-fit-actions")).toMatch(
      /width:\s*var\(--ivy-data-table-actions-width/,
    );
  });

  /**
   * The actions column is pinned to the right edge of the *scroll viewport*.
   *
   * A real width alone is not enough: once a call site's declared widths exceed the container — V1's
   * Jobs table declares 1130px, so any window under ~1450px — the table overflows its `overflow-auto`
   * wrapper and the last column lands past the right edge, unreachable without scrolling sideways.
   * Measured in Chromium at a 1440px window before this rule: a 1234px table in a 1148px viewport with
   * the actions cell at x = 1131…1211. This is the DOM stand-in for the framework grid's overlay, which
   * competes for no column width because it is drawn on canvas.
   */
  it("pins the actions column to the viewport's right edge, not the table's", () => {
    const block = ruleBody("th.ivy-data-table-fit-actions,");
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/right:\s*0/);
    // Opaque, or the cells scrolling underneath read through the buttons. A `<tr>` has no background of
    // its own, so `inherit` would be transparent.
    expect(block).toMatch(/background:\s*var\(--background\)/);
    // The width rides in the same rule, so a future edit cannot pin the column without reserving its
    // width or reserve the width without pinning it — either alone is a bug that has already happened.
    expect(block).toMatch(/width:\s*var\(--ivy-data-table-actions-width/);
  });

  it("stacks the row actions above the row, but below the pinned header", () => {
    expect(css).toMatch(/\.ivy-data-table td\.ivy-data-table-fit-actions \{\s*z-index:\s*1;\s*\}/);
    // The header has to stay on top of a row scrolling under it, so its level is higher.
    expect(ruleBody(".ivy-data-table thead {")).toMatch(/z-index:\s*2/);
    // And the header's own actions cell, pinned in both axes, tops `<thead>`'s stacking context.
    expect(ruleBody("thead th.ivy-data-table-fit-actions")).toMatch(/z-index:\s*2/);
  });

  it("re-applies the row's hover and selected tints over the opaque sticky cell", () => {
    // `TableRow` paints them on the `<tr>`, behind every cell, so an opaque sticky cell would stay
    // background-coloured while the rest of its row lit up — a hole in the row.
    expect(css).toMatch(
      /tr:hover > td\.ivy-data-table-fit-actions \{\s*background:\s*color-mix\([^)]*var\(--muted\) 50%/,
    );
    expect(css).toMatch(
      /tr\[data-state="selected"\] > td\.ivy-data-table-fit-actions \{\s*background:\s*var\(--muted\)/,
    );
  });

  it("tints a selected range visibly over an already-tinted row", () => {
    /*
     * A `color-mix` of `--primary`, not a second grey: this paints over a row that may already be
     * hover- or selection-tinted, and grey on grey is invisible. The framework grid resolves its
     * `accentColor` to `--primary` for the same stated reason
     * (`widgets/dataTables/hooks/useTableTheme.ts:63`, "so selection reads as deliberate").
     */
    expect(ruleBody('.ivy-data-table td[data-selected="true"]')).toMatch(
      /background:\s*color-mix\([^)]*var\(--primary\) 14%/,
    );
    // And over the opaque sticky actions cell, which would otherwise punch an unselected hole
    // through the right-hand end of a selected row.
    expect(css).toMatch(
      /tr:hover > td\[data-selected="true"\],[\s\S]{0,120}\{\s*background:\s*color-mix\([^)]*var\(--primary\) 14%/,
    );
  });

  it("suppresses text selection only while a range drag is live", () => {
    // Without this the drag paints the range *and* highlights the text under it, and the Cmd+C that
    // follows copies the text selection, which wins the `copy` event. Scoped to the drag so a
    // careful drag inside one cell can still select that cell's text.
    expect(ruleBody('.ivy-data-table[data-range-dragging="true"]')).toMatch(/user-select:\s*none/);
    expect(css).not.toMatch(/\.ivy-data-table \{\s*user-select:\s*none/);
  });

  it("marks where a dragged column would land", () => {
    // An inset border rather than a moving ghost column: a DOM table cannot reorder mid-drag without
    // re-laying out every row, which at any real row count is a visible stutter.
    expect(ruleBody('.ivy-data-table th[data-drop-target="true"]')).toMatch(
      /box-shadow:\s*inset 2px 0 0 0 var\(--primary\)/,
    );
  });

  it("keeps spacer rows visually inert", () => {
    const block = ruleBody('.ivy-data-table tr[data-slot="data-table-spacer"]');
    expect(block).toMatch(/border:\s*0/);
    expect(css).toMatch(
      /tr\[data-slot="data-table-spacer"\]:hover\s*\{\s*background:\s*transparent/,
    );
  });
});
