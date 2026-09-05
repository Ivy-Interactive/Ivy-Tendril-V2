import type { Densities } from "../src/types/density";

/** Themes offered by the `theme` toolbar global in `preview.tsx`. */
export type StorybookTheme = "light" | "dark";

/** Densities offered by the `density` toolbar global, derived from the enum so the two cannot drift. */
export type StorybookDensity = `${Densities}`;

export interface StorybookGlobals {
  theme?: StorybookTheme;
  density?: StorybookDensity;
}

/**
 * `getStoryContext()` is declared as `StoryContextForEnhancers`, which omits `globals` even though the
 * runner returns the full story context, and a `preview.tsx` decorator receives them as
 * `Record<string, any>`. Narrow both to `StorybookGlobals` here, in one place.
 */
export function readStoryGlobals(context: unknown): StorybookGlobals {
  return (context as { globals?: StorybookGlobals }).globals ?? {};
}
