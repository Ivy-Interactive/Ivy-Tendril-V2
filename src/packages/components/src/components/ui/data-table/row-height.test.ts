import { describe, expect, it } from "vite-plus/test";

import { tableCellSizeVariant } from "../table/table-variant";
import { Densities } from "@/types/density";
import { DATA_TABLE_ROW_HEIGHT_ESTIMATES } from "./use-data-table-virtualization";

/**
 * The virtualizer's row-height estimate has to be the height a row actually renders at.
 *
 * It is only an *estimate* — `measureElement` corrects each row as it mounts — which is exactly why an
 * estimate that stops matching the padding is invisible until someone notices the scrollbar is a lie and
 * the load-more threshold fires early. This ties the two together so a padding change that forgets the
 * estimate fails here instead.
 *
 * The framework's canvas grid has the same pair of numbers as one number, because it draws rows itself:
 * `DENSITY_CONFIG.rowHeight` of 30 / 38 / 48 at `cellVerticalPadding` of 4 / 8 / 12
 * (`widgets/dataTables/dataTableEditor/constants.ts`). V2 sits under that at every density — 25 / 29 /
 * 37 — which the second test below pins. That relationship is recorded at the variant, and this test
 * enforces the thing that matters: whatever the padding is, the estimate matches it.
 */

/** Tailwind's `py-N` scale in px. Only the *vertical* padding contributes to row height, which is
 *  why the cell variant sets `px-*` and `py-*` separately rather than one `p-*`. */
const PADDING_PX: Record<string, number> = {
  "py-0": 0,
  "py-0.5": 2,
  "py-1": 4,
  "py-1.5": 6,
  "py-2": 8,
  "py-2.5": 10,
  "py-3": 12,
};

/** Tailwind's default line-height per text size, in px. This is what fills a table row. */
const LINE_HEIGHT_PX: Record<string, number> = {
  "text-xs": 16,
  "text-sm": 20,
  "text-base": 24,
};

/** `border-b` on every `<tr>` (`TableRow`), which is part of the row's box. */
const ROW_BORDER_PX = 1;

function renderedRowHeight(density: Densities): number {
  const classes = tableCellSizeVariant({ density }).split(/\s+/);
  const padding = classes.map((name) => PADDING_PX[name]).find((value) => value !== undefined);
  const lineHeight = classes
    .map((name) => LINE_HEIGHT_PX[name])
    .find((value) => value !== undefined);
  if (padding === undefined || lineHeight === undefined) {
    throw new Error(`No padding or text size in the ${density} cell variant: ${classes.join(" ")}`);
  }
  return padding * 2 + lineHeight + ROW_BORDER_PX;
}

describe("DATA_TABLE_ROW_HEIGHT_ESTIMATES", () => {
  it("matches what a cell of that density actually renders at", () => {
    for (const density of [Densities.Small, Densities.Medium, Densities.Large]) {
      expect(DATA_TABLE_ROW_HEIGHT_ESTIMATES[density], density).toBe(renderedRowHeight(density));
    }
  });

  it("is no taller than the framework's own row, so the table is at least as compact", () => {
    // `DENSITY_CONFIG.rowHeight`.
    const framework: Record<Densities, number> = {
      [Densities.Small]: 30,
      [Densities.Medium]: 38,
      [Densities.Large]: 48,
    };
    for (const density of [Densities.Small, Densities.Medium, Densities.Large]) {
      expect(DATA_TABLE_ROW_HEIGHT_ESTIMATES[density], density).toBeLessThanOrEqual(
        framework[density],
      );
    }
  });

  it("rises with density and never collapses to nothing", () => {
    expect(DATA_TABLE_ROW_HEIGHT_ESTIMATES[Densities.Small]).toBeGreaterThan(0);
    expect(DATA_TABLE_ROW_HEIGHT_ESTIMATES[Densities.Small]).toBeLessThan(
      DATA_TABLE_ROW_HEIGHT_ESTIMATES[Densities.Medium],
    );
    expect(DATA_TABLE_ROW_HEIGHT_ESTIMATES[Densities.Medium]).toBeLessThan(
      DATA_TABLE_ROW_HEIGHT_ESTIMATES[Densities.Large],
    );
  });
});
