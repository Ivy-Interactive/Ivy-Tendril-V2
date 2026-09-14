import type * as React from "react";

/** Named width hint, or any CSS length applied as an inline width. */
export type BladeWidth = "sm" | "md" | "lg" | "xl" | "flex" | (string & {});

/** The named hints, in the order they appear in `bladeWidthVariant`. */
export const BLADE_WIDTH_HINTS = ["sm", "md", "lg", "xl", "flex"] as const;

export type BladeWidthHint = (typeof BLADE_WIDTH_HINTS)[number];

export function isBladeWidthHint(width?: BladeWidth): width is BladeWidthHint {
  return width !== undefined && (BLADE_WIDTH_HINTS as readonly string[]).includes(width);
}

export interface BladeDescriptor {
  /** Stable identity; auto-generated from a `React.useId`-derived counter when omitted on push. */
  id?: string;
  title: string;
  subtitle?: string;
  /** Named hint, or any CSS length ("32rem", "480px") applied as an inline width. */
  width?: BladeWidth;
  /** Rendered on the right of the header, before refresh/close. */
  headerAction?: React.ReactNode;
  content: React.ReactNode;
  /** Refresh affordance is rendered only when this is supplied. */
  onRefresh?: () => void;
  /** Called after this blade (and anything deeper) is popped. */
  onClose?: () => void;
  /** Defaults to true; false pins the blade open (the root blade is always pinned). */
  closable?: boolean;
}

/** A descriptor after the container has assigned it an id. */
export type ResolvedBlade = BladeDescriptor & { id: string };

export interface BladeStackActions {
  /** Opens a blade at the deepest end and returns its resolved id. */
  push: (blade: BladeDescriptor) => string;
  /** Closes `count` blades from the deepest end (default 1). Never removes the root. */
  pop: (count?: number) => void;
  /** Unwinds until `depth === n`, clamped to a minimum of 1. */
  popTo: (depth: number) => void;
  /** Unwinds until the named blade is the deepest one. Unknown ids are ignored. */
  popToId: (id: string) => void;
  /**
   * Swaps the deepest blade, leaving the depth unchanged. At depth 1 this is a no-op: the root
   * blade is owned by the container's `root` prop.
   */
  replace: (blade: BladeDescriptor) => void;
  /** Equivalent to `popTo(1)`. */
  reset: () => void;
}

export interface BladesContextValue extends BladeStackActions {
  blades: readonly ResolvedBlade[];
  depth: number;
  /** True while the viewport is narrower than the container's `collapseBreakpoint`. */
  isCollapsed: boolean;
}

/** Imperative surface exposed by `BladeContainer` so a parent outside the provider can drive it. */
export type BladeContainerHandle = BladeStackActions;
