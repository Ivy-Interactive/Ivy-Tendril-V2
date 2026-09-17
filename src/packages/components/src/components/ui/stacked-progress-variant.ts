import { cva } from "class-variance-authority";

export const stackedProgressLabelVariant = cva("flex flex-wrap min-w-0", {
  variants: {
    density: {
      Small: "text-2xs gap-2",
      Medium: "text-xs gap-3",
      Large: "text-sm gap-4",
    },
  },
  defaultVariants: {
    density: "Medium",
  },
});

/** Legend swatch size per density. */
export const stackedProgressDotSize = {
  Small: "6px",
  Medium: "8px",
  Large: "10px",
} as const;

/**
 * Replaces the legacy `var(--${segment.color.toLowerCase()})` interpolation, which silently
 * produced an invalid custom property for any unknown name. A colour outside this union goes
 * through `segment.className` instead.
 */
export const stackedProgressSegmentColor = {
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
} as const;

export type StackedProgressColor = keyof typeof stackedProgressSegmentColor;
