import React from "react";
import "./ui.css";

export type SpinnerSize = "xs" | "sm" | "md" | "lg" | "xl";
export type SpinnerTone = "current" | "border";

const SIZE_PX: Record<SpinnerSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Diameter in pixels, or one of the preset sizes. Defaults to "sm" (14px). */
  size?: SpinnerSize | number;
  /** Duration of one full rotation. Defaults to "0.8s". */
  duration?: string;
  /** Border thickness. Defaults to "2px". */
  borderWidth?: string;
  /**
   * Color of the spinning arc: "current" resolves to `currentColor`, "border" resolves to the
   * shared `--tui-fg` token. Ignored when `color` is set. Defaults to "current".
   */
  tone?: SpinnerTone;
  /** Exact CSS color for the spinning arc, overriding `tone` (e.g. a caller's own theme var). */
  color?: string;
  /** Track (unfilled ring) color. Defaults to the shared `--tui-border` token. */
  trackColor?: string;
  className?: string;
}

/**
 * The bundle's one border-ring spinner. A plain `<span>` with an animated top-color border,
 * sized and colored via CSS custom properties so every caller renders the same rotating ring.
 */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  {
    size = "sm",
    duration,
    borderWidth,
    tone = "current",
    color,
    trackColor,
    className = "",
    style,
    ...rest
  },
  ref,
) {
  const sizePx = typeof size === "number" ? size : SIZE_PX[size];
  const arcColor = color ?? (tone === "current" ? "currentColor" : "var(--tui-fg)");

  return (
    <span
      {...rest}
      ref={ref}
      className={`tui-spinner ${className}`.trim()}
      style={{
        ["--tui-spinner-size" as string]: `${sizePx}px`,
        ...(duration ? { ["--tui-spinner-duration" as string]: duration } : {}),
        ...(borderWidth ? { ["--tui-spinner-border-width" as string]: borderWidth } : {}),
        ["--tui-spinner-color" as string]: arcColor,
        ...(trackColor ? { ["--tui-spinner-track" as string]: trackColor } : {}),
        ...style,
      }}
    />
  );
});
