import { cva } from "class-variance-authority";

export const nativeSelectVariant = cva(
  "w-full cursor-pointer appearance-none truncate rounded-field border border-input bg-background text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-input",
  {
    variants: {
      density: {
        Small: "h-7 pl-2 pr-7 text-xs",
        Medium: "h-9 pl-3 pr-8 text-sm",
        Large: "h-11 pl-4 pr-9 text-base",
      },
    },
    defaultVariants: {
      density: "Medium",
    },
  },
);

export const nativeSelectChevronVariant = cva(
  "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
  {
    variants: {
      density: {
        Small: "right-1.5 size-3.5",
        Medium: "right-2 size-4",
        Large: "right-3 size-4",
      },
    },
    defaultVariants: {
      density: "Medium",
    },
  },
);
