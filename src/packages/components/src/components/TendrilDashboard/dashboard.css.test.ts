import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "dashboard.css");
const css = readFileSync(cssPath, "utf-8");

/** Every `.tdb-kpis { ... }` declaration block, base rule and container overrides alike. */
const kpiGridBlocks = [...css.matchAll(/\.tdb-kpis\s*\{([^}]*)\}/g)].map((m) => m[1]);

describe("dashboard.css KPI grid", () => {
  it("lays four cards out across four columns when full width", () => {
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
  });

  it("folds to a balanced 2x2 grid on narrower containers", () => {
    expect(kpiGridBlocks.length).toBeGreaterThan(1);
    const twoColBlocks = kpiGridBlocks.filter((block) => block.includes("repeat(2,"));
    expect(twoColBlocks.length).toBeGreaterThanOrEqual(1);
  });

  it("never falls back to a three column grid, which would leave the fourth card alone", () => {
    for (const block of kpiGridBlocks) {
      expect(block).not.toContain("repeat(3,");
    }
  });

  it("styles the hint as a footnote under the value", () => {
    // opacity 0.7 == var(--opacity-subtle) (tokens.css); the computed value is unchanged.
    expect(css).toContain(".tdb-kpi-hint {");
    expect(css).toMatch(/\.tdb-kpi-hint\s*\{[^}]*opacity: var\(--opacity-subtle\);/);
  });

  it("styles the subvalue alongside the primary value", () => {
    // font-size 13px == var(--text-sm-tight) (tokens.css); the computed value is unchanged.
    expect(css).toContain(".tdb-kpi-subvalue {");
    expect(css).toMatch(/\.tdb-kpi-subvalue\s*\{[^}]*font-size:\s*var\(--text-sm-tight\);/);
    expect(css).toMatch(/\.tdb-kpi-subvalue\s*\{[^}]*opacity:\s*var\(--opacity-subtle\);/);
  });

  it("defines cursor pointer, transition, hover, and focus-visible on .tdb-kpi", () => {
    expect(css).toMatch(/\.tdb-kpi\s*\{[^}]*cursor:\s*pointer;/);
    expect(css).toMatch(/\.tdb-kpi\s*\{[^}]*transition:\s*[^;]*transform/);
    expect(css).toContain(".tdb-kpi:hover");
    expect(css).toContain(".tdb-kpi:focus-visible");
  });
});

/**
 * The Forecast card's value is a *range* (`$1.2k – $3.4k`), roughly twice as wide as every other KPI
 * figure, and a KPI card's content box shrinks to about 137px — four cards across a full-width main
 * column at a ~870px container, and again just above the 1260px fold. It used to run past the card
 * and get quietly clipped by `.tdb-root { overflow-x: hidden }`, which is the bad failure: a cost with
 * its last digits removed still reads as a cost.
 *
 * The app narrows the figures (`dashboardMetrics.formatCurrencyCompact`); these rules are the other
 * half, and each is load-bearing rather than tidy. jsdom lays nothing out, so the rules themselves are
 * what gets pinned.
 */
describe("dashboard.css KPI value wrapping", () => {
  const valueBlocks = [...css.matchAll(/\.tdb-kpi-value\s*\{([^}]*)\}/g)].map((m) => m[1]);

  it("lets the value shrink below its content instead of holding the row open", () => {
    // A flex item defaults to `min-width: auto`, i.e. min-content, and so refuses to shrink below its
    // widest unbreakable run. The same omission has been the cause here twice before.
    expect(valueBlocks).toHaveLength(1);
    expect(valueBlocks[0]).toMatch(/min-width:\s*0;/);
  });

  it("wraps the value rather than running it past the card", () => {
    // This was `nowrap`. With the separator's non-breaking space there is exactly one break
    // opportunity in a range, so it either fits on one line or sets as `$1.2k –` / `$3.4k`.
    expect(valueBlocks[0]).toMatch(/white-space:\s*normal;/);
    expect(valueBlocks[0]).not.toMatch(/white-space:\s*nowrap;/);
    // The floor under that: a figure too wide for even its own line breaks instead of being cut off.
    expect(valueBlocks[0]).toMatch(/overflow-wrap:\s*break-word;/);
  });

  it("never hides or ellipsizes the figure, which would misreport it", () => {
    // A clipped or ellipsized cost is indistinguishable from a smaller cost, so a tall card is the
    // correct trade and these two declarations are forbidden here, not merely absent.
    for (const block of valueBlocks) {
      expect(block).not.toMatch(/overflow:\s*hidden/);
      expect(block).not.toMatch(/text-overflow/);
    }
  });

  it("lets the value and its delta wrap onto two lines when they cannot share one", () => {
    const rowBlocks = [...css.matchAll(/\.tdb-kpi-row\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rowBlocks).toHaveLength(1);
    expect(rowBlocks[0]).toMatch(/flex-wrap:\s*wrap;/);
  });
});

describe("dashboard.css side block and git activity layout", () => {
  it("constrains side block contents within container bounds with overflow: hidden", () => {
    expect(css).toMatch(/\.tdb-side-block\s*\{[^}]*overflow:\s*hidden;/);
  });

  it("bottom-anchors side body and tip wrap with justify-content: flex-end", () => {
    const sideBodyBlocks = [...css.matchAll(/\.tdb-side-body\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(sideBodyBlocks.length).toBeGreaterThanOrEqual(1);
    for (const block of sideBodyBlocks) {
      expect(block).toContain("justify-content: flex-end;");
    }

    const tipWrapBlocks = [...css.matchAll(/\.tdb-tip-wrap\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(tipWrapBlocks.length).toBeGreaterThanOrEqual(1);
    for (const block of tipWrapBlocks) {
      expect(block).toContain("justify-content: flex-end;");
    }
  });

  it("no longer carries the activity metrics summary row", () => {
    expect(css).not.toContain(".tdb-activity-metrics");
    expect(css).not.toContain(".tdb-activity-wrap");
  });

  it("stacks monthly activity columns from the bottom", () => {
    expect(css).toMatch(/\.tdb-activity-col\s*\{[^}]*flex-direction:\s*column-reverse;/);
    expect(css).toMatch(/\.tdb-activity\s*\{[^}]*align-items:\s*flex-end;/);
  });

  it("no longer carries the daily contribution heatmap classes", () => {
    expect(css).not.toContain(".tdb-activity-weekdays");
    expect(css).not.toContain(".tdb-activity-months-row");
  });

  it("constrains width on side body and tip wrap with min-width: 0 and max-width: 100%", () => {
    expect(css).toMatch(/\.tdb-side-body\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.tdb-side-body\s*\{[^}]*max-width:\s*100%;/);
    expect(css).toMatch(/\.tdb-tip-wrap\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.tdb-tip-wrap\s*\{[^}]*max-width:\s*100%;/);
  });

  it("constrains scroll container with min-width: 0 and overflow-x: auto", () => {
    expect(css).toMatch(/\.tdb-activity-scroll\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.tdb-activity-scroll\s*\{[^}]*max-width:\s*100%;/);
    expect(css).toMatch(/\.tdb-activity-scroll\s*\{[^}]*overflow-x:\s*auto;/);
  });

  it("allows activity columns to shrink flexibly to fit 16 months", () => {
    expect(css).toMatch(/\.tdb-activity-col\s*\{[^}]*flex:\s*1\s+1\s+0;/);
    expect(css).toMatch(/\.tdb-activity-col\s*\{[^}]*min-width:\s*9px;/);
    expect(css).toMatch(/\.tdb-activity\s*\{[^}]*gap:\s*5px;/);
  });

  // Issue #2593: the trailing label's text is wider than its column, and an
  // overflowing line is pinned to its inline start edge, so text-align alone
  // cannot keep it inside the card. direction: rtl moves that start edge to the
  // right, which is what actually prevents the clipping; measured 0px clipped at
  // 280px, 360px and 600px card widths.
  it("keeps the trailing activity label inside the card by flipping its inline direction", () => {
    const rule = css.slice(
      css.indexOf(".tdb-activity-label:last-child {"),
      css.indexOf("}", css.indexOf(".tdb-activity-label:last-child {")),
    );
    expect(rule).toMatch(/direction:\s*rtl;/);
    expect(rule).toMatch(/text-align:\s*right;/);
  });
});

describe("dashboard.css rolling average curve and legend", () => {
  it("defines the dashed muted average legend indicator", () => {
    expect(css).toContain(".tdb-legend-line-avg {");
    expect(css).toMatch(
      /\.tdb-legend-line-avg\s*\{[^}]*border-top:\s*1\.5px dashed var\(--tdb-muted\)/,
    );
  });

  it("strokes the rolling curve with dashed pattern without filling it", () => {
    expect(css).toContain(".tdb-trend-avg-curve {");
    expect(css).toMatch(/\.tdb-trend-avg-curve\s*\{[^}]*fill:\s*none;/);
    expect(css).toMatch(/\.tdb-trend-avg-curve\s*\{[^}]*stroke:\s*var\(--tdb-muted\);/);
    expect(css).toMatch(/\.tdb-trend-avg-curve\s*\{[^}]*stroke-dasharray:\s*4 4;/);
  });

  it("no longer carries the constant horizontal reference line", () => {
    expect(css).not.toContain(".tdb-trend-avg-line");
    expect(css).not.toContain(".tdb-legend-dash-avg");
    expect(css).not.toContain(".tdb-trend-compare");
    expect(css).not.toContain(".tdb-legend-dash {");
  });

  it("no longer carries granularity toggle styles", () => {
    expect(css).not.toContain(".tdb-granularity-toggle");
    expect(css).not.toContain(".tdb-granularity-btn");
  });
});

describe("dashboard.css side tabs", () => {
  it("defines compact tab controls for side card headers", () => {
    // font-size 12px == var(--text-xs), border-radius 6px == var(--radius-md) (tokens.css); the
    // computed values are unchanged.
    expect(css).toContain(".tdb-side-tabs {");
    expect(css).toContain(".tdb-side-tab {");
    expect(css).toMatch(/\.tdb-side-tab\s*\{[^}]*font-size:\s*var\(--text-xs\);/);
    expect(css).toMatch(/\.tdb-side-tab\s*\{[^}]*padding:\s*3px 8px;/);
    expect(css).toMatch(/\.tdb-side-tab\s*\{[^}]*border-radius:\s*var\(--radius-md\);/);
  });
});

describe("dashboard.css pull request bars layout and alignment", () => {
  it("defines centered text alignment, controlled line height, and consistent min-height for bar labels", () => {
    expect(css).toContain(".tdb-bar-label {");
    expect(css).toMatch(/\.tdb-bar-label\s*\{[^}]*text-align:\s*center;/);
    expect(css).toMatch(/\.tdb-bar-label\s*\{[^}]*line-height:\s*1\.2;/);
    expect(css).toMatch(/\.tdb-bar-label\s*\{[^}]*min-height:\s*28px;/);
    expect(css).toMatch(/\.tdb-bar-label\s*\{[^}]*white-space:\s*pre-line;/);
  });

  it("uses a compact gap on .tdb-bars-plot to prevent horizontal overflow", () => {
    expect(css).toContain(".tdb-bars-plot {");
    expect(css).toMatch(/\.tdb-bars-plot\s*\{[^}]*gap:\s*8px;/);
  });

  it("sets min-width 0 on .tdb-bar-item and aligns Y-axis zero tick with 36px padding-bottom", () => {
    expect(css).toMatch(/\.tdb-bar-item\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.tdb-bars-y\s*\{[^}]*padding-bottom:\s*36px;/);
  });

  /**
   * The month range's horizontal fit.
   *
   * A flex item defaults to `min-width: auto`, which refuses to shrink below its content — so the
   * bar track sized itself to the labels it contained and pushed past the side card, whose
   * `overflow: hidden` then cut the right-hand bars off. `min-width: 0` on every level between the
   * card and a bar is what lets the track take the width the card actually has. Clipping with
   * `overflow-x: hidden` would have hidden the same data more quietly, which is why neither the track
   * nor its items may declare one.
   */
  it("lets the bar track shrink to the card's width rather than to its content", () => {
    expect(css).toMatch(/\.tdb-bars-plot\s*\{[^}]*min-width:\s*0;/);

    const barBlocks = [
      ...css.matchAll(/\.tdb-bars-plot\s*\{([^}]*)\}/g),
      ...css.matchAll(/\.tdb-bar-item\s*\{([^}]*)\}/g),
    ].map((m) => m[1]);
    expect(barBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of barBlocks) {
      expect(block).not.toMatch(/overflow-x:\s*hidden/);
    }
  });
});

describe("dashboard.css loading skeletons", () => {
  it("sizes the KPI placeholders to the metrics they stand in for, so nothing shifts on arrival", () => {
    // .tdb-kpi-label is a 14px line with a 10px gap under it.
    expect(css).toMatch(/\.tdb-skel-kpi-label\s*\{[^}]*height:\s*14px;/);
    expect(css).toMatch(/\.tdb-skel-kpi-label\s*\{[^}]*margin-bottom:\s*10px;/);
    // .tdb-kpi-value is a 30px glyph on a 36px line.
    expect(css).toMatch(/\.tdb-skel-kpi-value\s*\{[^}]*height:\s*30px;/);
    // .tdb-kpi-hint is an 11px footnote 8px below the value.
    expect(css).toMatch(/\.tdb-skel-kpi-hint\s*\{[^}]*height:\s*11px;/);
    expect(css).toMatch(/\.tdb-skel-kpi-hint\s*\{[^}]*margin-top:\s*8px;/);
  });

  it("makes the chart placeholder as flexible as the chart, so it cannot overflow either", () => {
    expect(css).toMatch(/\.tdb-skel-chart\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.tdb-skel-chart-bar\s*\{[^}]*flex:\s*1\s+1\s+0;/);
    expect(css).toMatch(/\.tdb-skel-chart-bar\s*\{[^}]*min-width:\s*0;/);
  });

  it("leaves the tint and the pulse to the shared Skeleton primitive", () => {
    // Sizing only: a background or an animation here would be a second skeleton implementation.
    const skeletonBlocks = [...css.matchAll(/\.tdb-skel[\w-]*\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(skeletonBlocks.length).toBeGreaterThan(0);
    for (const block of skeletonBlocks) {
      expect(block).not.toContain("background");
      expect(block).not.toContain("animation");
    }
  });
});
