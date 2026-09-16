/** Heights shared by inputs, selects, and buttons at each density */
export const controlHeight = {
  Small: "h-7",
  Medium: "h-9",
  Large: "h-11",
} as const;

/** Square control size (icon-only buttons) matching {@link controlHeight} */
export const controlSize = {
  Small: "size-7",
  Medium: "size-9",
  Large: "size-11",
} as const;

/** Base density scale — used by table-head, expandable trigger, and as reference for offset scales */
export const densityHeight = {
  Small: "h-8",
  Medium: "h-10",
  Large: "h-12",
} as const;

/** One step above base — available for components needing a larger scale */
export const densityHeightLg = {
  Small: "h-10",
  Medium: "h-12",
  Large: "h-14",
} as const;

export const densityText = {
  Small: "text-xs",
  Medium: "text-sm",
  Large: "text-base",
} as const;

export const densityTreeGap = {
  Small: "gap-0.5",
  Medium: "gap-1",
  Large: "gap-1.5",
} as const;

import * as React from "react";
import { Densities } from "@/types/density";

/** Density to the {@link buttonVariant} `size` key for text buttons. */
export function densityToButtonSize(density: Densities): "sm" | "default" | "lg" {
  switch (density) {
    case Densities.Small:
      return "sm";
    case Densities.Large:
      return "lg";
    default:
      return "default";
  }
}

/** Density to the {@link buttonVariant} `size` key for icon-only buttons. */
export function densityToIconButtonSize(density: Densities): "icon-sm" | "icon" | "icon-lg" {
  switch (density) {
    case Densities.Small:
      return "icon-sm";
    case Densities.Large:
      return "icon-lg";
    default:
      return "icon";
  }
}

/** Density to the lowercase {@link badgeVariant} `density` key. */
export function densityToBadgeDensity(density: Densities): "small" | "medium" | "large" {
  switch (density) {
    case Densities.Small:
      return "small";
    case Densities.Large:
      return "large";
    default:
      return "medium";
  }
}

/**
 * The framework's `Responsive<Density?>`, as a hook.
 *
 * Ivy widgets take a density per breakpoint — V1's Jobs table is
 * `.Density(new Responsive<Density?> { Default = Density.Large, Desktop = Density.Medium })`
 * (`Apps/Jobs/JobsApp.DataTable.cs:40`): roomier where a finger is the pointer, tighter where a mouse is.
 * V2's `DensityProvider` carries one density and has no notion of a breakpoint, so this is the missing
 * half — a subscription to one media query, resolved to one of two densities.
 *
 * `query` defaults to Tailwind's `lg` (1024px), which is the breakpoint every other responsive rule in
 * these packages uses; passing a different one is how a caller expresses a different `Responsive` map.
 *
 * Outside a browser — a test, a server render — there is no `matchMedia`, and `desktop` is the honest
 * answer for a desktop shell rather than a layout nobody is looking at on a phone.
 */
export function useResponsiveDensity(
  mobile: Densities,
  desktop: Densities,
  query = "(min-width: 1024px)",
): Densities {
  const isDesktop = React.useSyncExternalStore(
    React.useCallback(
      (onChange: () => void) => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
          return () => undefined;
        }
        const media = window.matchMedia(query);
        media.addEventListener("change", onChange);
        return () => media.removeEventListener("change", onChange);
      },
      [query],
    ),
    () =>
      typeof window === "undefined" || typeof window.matchMedia !== "function"
        ? true
        : window.matchMedia(query).matches,
    () => true,
  );

  return isDesktop ? desktop : mobile;
}
