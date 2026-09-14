import { cva } from "class-variance-authority";

/** The blade panel itself. Sizing comes from `bladeWidthVariant` unless the stack is collapsed. */
export const bladeVariant = cva(
  "group/blade relative flex h-full min-h-0 flex-col bg-background border-r border-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
  {
    variants: {
      collapsed: {
        true: "w-full min-w-0 border-r-0",
        false: "",
      },
    },
    defaultVariants: {
      collapsed: false,
    },
  },
);

/** Width hints. Anything outside this set is applied as an inline CSS length instead. */
export const bladeWidthVariant = cva("", {
  variants: {
    width: {
      sm: "w-80 shrink-0",
      md: "w-104 shrink-0",
      lg: "w-136 shrink-0",
      xl: "w-176 shrink-0",
      flex: "flex-1 min-w-0",
    },
  },
  defaultVariants: {
    width: "md",
  },
});

/** The fixed-height blade header, matching the legacy 70px row. */
export const bladeHeaderVariant = cva(
  "flex h-[70px] shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4 text-foreground",
);
