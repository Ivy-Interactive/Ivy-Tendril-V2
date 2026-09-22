import { cva } from "class-variance-authority";

/** Text alignment shared by a column's header and its cells. */
export const dataTableCellAlignVariant = cva("", {
  variants: {
    align: {
      Left: "text-left",
      Center: "text-center",
      Right: "text-right",
    },
  },
  defaultVariants: {
    align: "Left",
  },
});

/**
 * A cell that *navigates*, as the framework draws one: blue text with an underline.
 *
 * `widgets/dataTables/utils/customRenderers.ts:526` builds a link cell with a custom renderer whose
 * comment is exactly "blue text + underline", and `utils/canvasText.ts:103-109` draws the underline. On a
 * canvas that is a literal colour; here it is `--info`, the semantic token for blue, so a link is the
 * same blue as everything else informational and follows the theme.
 *
 * Underlined always rather than on hover: an affordance nobody can see until they are already pointing at
 * it is not an affordance. The framework draws the underline unconditionally for the same reason.
 */
export const dataTableLinkClass =
  "text-info underline decoration-info/40 underline-offset-2 hover:decoration-info";

/** Row affordances: clickable rows get a pointer, selected rows get the secondary surface. */
export const dataTableRowVariant = cva("", {
  variants: {
    interactive: {
      true: "cursor-pointer",
      false: "",
    },
    selected: {
      /* The same token `TableRow`'s own `data-[state=selected]` paints, and the same one the sticky
         actions cell re-applies in `data-table.css`. Three places, one surface. */
      true: "bg-secondary",
      false: "",
    },
  },
  defaultVariants: {
    interactive: false,
    selected: false,
  },
});

/** Toolbar gaps, mirroring the legacy widget's density-keyed `spacing` map. */
export const dataTableToolbarVariant = cva("flex flex-wrap items-center", {
  variants: {
    density: {
      Small: "gap-1",
      Medium: "gap-2",
      Large: "gap-3",
    },
  },
  defaultVariants: {
    density: "Medium",
  },
});
