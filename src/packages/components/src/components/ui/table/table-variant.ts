import { cva } from "class-variance-authority";
import { densityText } from "../density-scale";

/* Size variants for TableHead.

   Header height is the *row's* height at the same density, not `densityHeight`'s 32 / 40 / 48: the
   header and the rows should read as one grid, and a header a step taller than every row below it
   reads as chrome sitting on top of the table. So the vertical padding is the body cell's and no
   `h-*` floor is set — the two are laid out by the same rule and cannot drift apart.

   The header's own text is a step smaller than the body's at Medium and Large, which is why its line
   box is shorter and it still resolves a pixel or two under the row; at Small both are already
   `text-xs`, the floor of the scale, so there the header reads as a caption through weight and colour
   alone and the two heights match exactly.

   The horizontal padding matches the body cell of the same density, or the label sits out of line
   with the column it names. */
export const tableHeadSizeVariant = cva("", {
  variants: {
    density: {
      Small: `px-2 py-1 ${densityText.Small}`,
      Medium: `px-3 py-1 ${densityText.Small}`,
      Large: `px-4 py-1.5 ${densityText.Medium}`,
    },
  },
  defaultVariants: {
    density: "Medium",
  },
});

// Size variants for TableCell padding
/* The header's out-of-flow reorder grip: offset by exactly the header's own horizontal padding, and
   sized to fit inside it. Declared here, beside the `px-*` both have to match, because a fixed offset
   against a per-density gutter overhangs the previous column at one end of the scale and sits well
   inside the label at the other. Small's gutter is 8px, so the icon is 8px there; Medium and Large
   both take 12px, which is the smallest the glyph stays legible at. */
export const tableHeadGripOffsetVariant = cva("", {
  variants: {
    density: {
      Small: "-left-2 size-2",
      Medium: "-left-3 size-3",
      Large: "-left-4 size-3",
    },
  },
  defaultVariants: {
    density: "Medium",
  },
});

export const tableCellSizeVariant = cva("align-middle", {
  variants: {
    /* Vertical padding is set separately from the horizontal, because only the vertical half sets row
       height. Rows are 25 / 29 / 37px — compact, which deliberately walks back the "generous row
       height" the restyle first took from the reference: more of the list fits on screen, which is
       what a job list is read for.

       Framework remains the ceiling, not the target (`DENSITY_CONFIG.rowHeight` = 30 / 38 / 48), and
       these now sit well under it at every density.

       The floor is the text line box: `text-xs`/`text-sm`/`text-base` are 16 / 20 / 24px, so with the
       1px `border-b` the tightest possible rows are 17 / 21 / 25. Small is at that floor + 8.

       `DATA_TABLE_ROW_HEIGHT_ESTIMATES` in `data-table/use-data-table-virtualization.ts` must follow
       any change here, or the virtualizer's scrollbar lies and load-more fires early.
       `data-table/row-height.test.ts` derives one from the other and fails if they drift. */
    density: {
      Small: `px-2 py-1 ${densityText.Small}`,
      Medium: `px-3 py-1 ${densityText.Medium}`,
      Large: `px-4 py-1.5 ${densityText.Large}`,
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
