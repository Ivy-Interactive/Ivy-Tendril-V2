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

/**
 * Width hints. Anything outside this set is applied as an inline CSS length instead.
 *
 * `flex` fills whatever the row has left, and must not have a say in how much that is. The row is
 * `w-max` so a stack can outgrow its pane, which makes it ask each blade how wide it would like to
 * be; a fixed hint answers with its width, but a bare `flex-1` answered with its content's
 * max-content width — every paragraph on one line. `contain-inline-size` makes the blade answer as
 * if it were empty, so the row is sized by the pane and the fixed blades alone, and `flex-1` then
 * hands the flex blade what is left. `min-w-80` is the floor under that: `sm`, the narrowest hint,
 * so a flex blade beside a wide stack keeps a usable width and the row scrolls instead of the blade
 * being squeezed to nothing.
 */
export const bladeWidthVariant = cva("", {
  variants: {
    width: {
      sm: "w-80 shrink-0",
      md: "w-104 shrink-0",
      lg: "w-136 shrink-0",
      xl: "w-176 shrink-0",
      flex: "min-w-80 flex-1 contain-inline-size",
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
