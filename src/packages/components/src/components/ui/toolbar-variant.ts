import { cva } from "class-variance-authority";

export const toolbarVariant = cva("flex items-center bg-background border rounded-box", {
  variants: {
    density: {
      Small: "gap-1 p-1",
      Medium: "gap-2 p-2",
      Large: "gap-3 p-3",
    },
    orientation: {
      horizontal: "flex-row",
      vertical: "flex-col items-stretch",
    },
  },
  defaultVariants: {
    density: "Medium",
    orientation: "horizontal",
  },
});

/** `orientation` is the *toolbar's* orientation; the separator itself runs perpendicular to it. */
export const toolbarSeparatorVariant = cva("shrink-0 bg-border", {
  variants: {
    density: {
      Small: "",
      Medium: "",
      Large: "",
    },
    orientation: {
      horizontal: "w-px",
      vertical: "h-px",
    },
  },
  compoundVariants: [
    { orientation: "horizontal", density: "Small", class: "h-4 mx-0.5" },
    { orientation: "horizontal", density: "Medium", class: "h-6 mx-1" },
    { orientation: "horizontal", density: "Large", class: "h-8 mx-1.5" },
    { orientation: "vertical", density: "Small", class: "w-4 my-0.5" },
    { orientation: "vertical", density: "Medium", class: "w-6 my-1" },
    { orientation: "vertical", density: "Large", class: "w-8 my-1.5" },
  ],
  defaultVariants: {
    density: "Medium",
    orientation: "horizontal",
  },
});

export const toolbarGroupVariant = cva("flex items-center", {
  variants: {
    density: {
      Small: "gap-0.5",
      Medium: "gap-1",
      Large: "gap-1.5",
    },
    orientation: {
      horizontal: "flex-row",
      vertical: "flex-col items-stretch",
    },
  },
  defaultVariants: {
    density: "Medium",
    orientation: "horizontal",
  },
});
