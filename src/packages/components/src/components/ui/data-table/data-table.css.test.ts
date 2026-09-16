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

  it("pins the whole header section, so the filter row travels with the labels", () => {
    // The section rather than its cells: two header rows of `th` each stuck at `top: 0` would stack on
    // top of one another, and no per-density offset can be written down here.
    const block = ruleBody(".ivy-data-table thead {");
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/top:\s*0/);
    expect(block).toMatch(/background:\s*var\(--background\)/);
  });

  it("keeps the filter row's cells unstuck, so they cannot pin over the labels", () => {
    const block = ruleBody('.ivy-data-table thead tr[data-slot="data-table-filter-row"] th');
    expect(block).toMatch(/position:\s*static/);
  });

  it("pins column widths while windowed, so scrolling does not resize columns", () => {
    const block = ruleBody(".ivy-data-table.ivy-data-table-virtualized");
    expect(block).toMatch(/table-layout:\s*fixed/);
  });

  it("gives the zero-width selection and action columns real widths under fixed layout", () => {
    expect(ruleBody("th.ivy-data-table-fit-select")).toMatch(/width:/);
    expect(ruleBody("th.ivy-data-table-fit-actions")).toMatch(
      /width:\s*var\(--ivy-data-table-actions-width/,
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
