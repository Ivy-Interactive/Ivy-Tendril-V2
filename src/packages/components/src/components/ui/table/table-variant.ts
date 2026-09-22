import { cva } from "class-variance-authority";
import { densityHeight, densityText } from "../density-scale";

/* Size variants for TableHead.

   Header height is `densityHeight` — h-8 / h-10 / h-12 = 32 / 40 / 48px — and it does *not* track the
   row height: it is a fixed step per density, so changing the row padding moves the rows and leaves
   the header where it is. `h-*` is a `min-height` in a table cell, so the padding below only wins
   where it would make the cell taller than that floor (it does not at any density here).

   The horizontal padding matches the body cell of the same density, or the label sits out of line
   with the column it names. The label text is a step below the body text at Medium and Large; at
   Small it is already `text-xs`, the floor of the scale, so there the header reads as a caption
   through weight and colour alone. */
export const tableHeadSizeVariant = cva("", {
  variants: {
    density: {
      Small: `${densityHeight.Small} px-2 py-1.5 ${densityText.Small}`,
      Medium: `${densityHeight.Medium} px-3 py-2 ${densityText.Small}`,
      Large: `${densityHeight.Large} px-4 py-2 ${densityText.Medium}`,
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
       height. Rows are 29 / 37 / 41px: the deployments-list reference reads as a list of rows rather
       than a grid of cells, and that needs air around the line box rather than a taller font.

       Framework remains the ceiling, not the target (`DENSITY_CONFIG.rowHeight` = 30 / 38 / 48): these
       sit under it at every density, so the table is still no taller than the canvas grid it replaced.

       The floor is the text line box: `text-xs`/`text-sm`/`text-base` are 16 / 20 / 24px, so with the
       1px `border-b` the tightest possible rows are 17 / 21 / 25.

       `DATA_TABLE_ROW_HEIGHT_ESTIMATES` in `data-table/use-data-table-virtualization.ts` must follow
       any change here, or the virtualizer's scrollbar lies and load-more fires early.
       `data-table/row-height.test.ts` derives one from the other and fails if they drift. */
    density: {
      Small: `px-2 py-1.5 ${densityText.Small}`,
      Medium: `px-3 py-2 ${densityText.Medium}`,
      Large: `px-4 py-2 ${densityText.Large}`,
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
