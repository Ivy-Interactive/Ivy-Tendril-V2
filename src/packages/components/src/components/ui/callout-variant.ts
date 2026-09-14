import { cva } from "class-variance-authority";

export const calloutVariant = cva(
  "relative flex items-start rounded-box border transition-colors",
  {
    variants: {
      variant: {
        info: "border-info/20 bg-info/10 text-foreground",
        success: "border-success/20 bg-success/10 text-foreground",
        warning: "border-warning/20 bg-warning/10 text-foreground",
        error: "border-destructive/20 bg-destructive/10 text-foreground",
        neutral: "border-border bg-muted text-foreground",
      },
      density: {
        Small: "px-3 py-2.5",
        Medium: "p-4",
        Large: "p-6",
      },
    },
    defaultVariants: {
      variant: "info",
      density: "Medium",
    },
  },
);

/** Per-variant tint for the leading icon. */
export const calloutIconVariant = cva("", {
  variants: {
    variant: {
      info: "text-info",
      success: "text-success",
      warning: "text-warning",
      error: "text-destructive",
      neutral: "text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

/** Leading icon pixel size per density — mirrors the legacy 20/24/28 scale. */
export const calloutIconSize = {
  Small: 20,
  Medium: 24,
  Large: 28,
} as const;

/** Title line height per density, matched to {@link calloutIconSize} so titled callouts align. */
export const calloutTitleLeading = {
  Small: "leading-5",
  Medium: "leading-6",
  Large: "leading-7",
} as const;
