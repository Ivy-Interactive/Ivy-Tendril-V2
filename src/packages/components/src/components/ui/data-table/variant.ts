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

/** Row affordances: clickable rows get a pointer, selected rows get the muted surface. */
export const dataTableRowVariant = cva("", {
  variants: {
    interactive: {
      true: "cursor-pointer",
      false: "",
    },
    selected: {
      true: "bg-muted",
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
