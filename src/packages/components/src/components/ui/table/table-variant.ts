import { cva } from "class-variance-authority";
import { densityHeight, densityText } from "../density-scale";

// Size variants for TableHead padding
export const tableHeadSizeVariant = cva("", {
  variants: {
    density: {
      Small: `${densityHeight.Small} px-1 ${densityText.Small}`,
      Medium: `${densityHeight.Medium} px-2 ${densityText.Medium}`,
      Large: `${densityHeight.Large} px-3 ${densityText.Large}`,
    },
  },
  defaultVariants: {
    density: "Medium",
  },
});

// Size variants for TableCell padding
export const tableCellSizeVariant = cva("align-middle", {
  variants: {
    /* Vertical padding is deliberately much smaller than the horizontal, and deliberately *below*
       Framework. Rows were `p-N` on all four sides: 25 / 37 / 49px, which matched Framework's canvas
       grid almost exactly (`DENSITY_CONFIG.rowHeight` = 30 / 38 / 48). Shorter rows were asked for
       repeatedly, so these are now 17 / 25 / 33 — the line box plus the row border plus a hair.
       Framework is therefore *not* the target here; it is the ceiling this sits under.

       The floor is the text line box: `text-xs`/`text-sm`/`text-base` are 16 / 20 / 24px, so with the
       1px `border-b` the tightest possible rows are 17 / 21 / 25. Small is already at that floor.
       Going below any of these means changing the font scale, not the padding.

       `DATA_TABLE_ROW_HEIGHT_ESTIMATES` in `data-table/use-data-table-virtualization.ts` must follow
       any change here, or the virtualizer's scrollbar lies and load-more fires early.
       `data-table/row-height.test.ts` derives one from the other and fails if they drift. */
    density: {
      Small: `px-1 py-0 ${densityText.Small}`,
      Medium: `px-2 py-0.5 ${densityText.Medium}`,
      Large: `px-3 py-1 ${densityText.Large}`,
    },
  },
  defaultVariants: {
    density: "Medium",
  },
});

export const tableSizeVariant = cva("", {
  variants: {
    density: {
      Small: densityText.Small,
      Medium: densityText.Medium,
      Large: densityText.Large,
    },
  },
  defaultVariants: {
    density: "Medium",
  },
});
