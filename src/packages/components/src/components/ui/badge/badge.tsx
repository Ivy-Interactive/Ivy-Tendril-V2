import * as React from "react";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { ivyColorVar } from "@/lib/ivy-color";
import { badgeVariant } from "./variant";
import { useDensity } from "@/contexts/density-context";

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariant> {
  /**
   * An Ivy `Colors` name — `"Blue"`, `"Amber"`, `"Slate"` — which tints the badge and takes precedence
   * over `variant`.
   *
   * This is the framework's `BadgeColorMapping`: a table column maps its values to colour *names* and
   * the badge resolves them, which is how V1 colours Jobs' Status from `Constants.JobStatusColors` and
   * its Type from `JobTypeColors` without either knowing about a design token. Use it where the value
   * set is categorical and larger than the semantic variants; use `variant` where the meaning is
   * semantic (a destructive action, a success).
   */
  color?: string;
}

/** The mix that turns one hue into a legible fill and text, matching `TuiBadge`'s `data-kind="color"`. */
function tintStyle(color: string): React.CSSProperties {
  const hue = ivyColorVar(color);
  return {
    // Against `--card` rather than a literal white, so one expression serves both themes: the card is
    // pale in light mode and near-black in dark, and the same 18%/28% mix reads as a pale or a deep
    // tint accordingly. The text keeps 60% of the hue in both, which is what holds contrast.
    "--badge-tint-bg-light": `color-mix(in srgb, ${hue} 18%, var(--card, #ffffff))`,
    "--badge-tint-fg-light": `color-mix(in srgb, ${hue} 60%, var(--foreground, #000000))`,
    "--badge-tint-bg-dark": `color-mix(in srgb, ${hue} 28%, var(--card, #000000))`,
    "--badge-tint-fg-dark": `color-mix(in srgb, ${hue} 60%, var(--foreground, #ffffff))`,
  } as React.CSSProperties;
}

function Badge({ className, variant, density, color, style, ...props }: BadgeProps) {
  const contextDensity = useDensity();
  return (
    <div
      className={cn(
        badgeVariant({
          variant: color ? "tinted" : variant,
          density: density ?? contextDensity,
        }),
        className,
      )}
      style={color ? { ...tintStyle(color), ...style } : style}
      {...props}
    />
  );
}

export { Badge };
