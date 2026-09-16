import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The dashboard's first-paint placeholders.
 *
 * The framework's answer to a region whose data has not arrived is the `Skeleton` widget
 * (`Ivy/Widgets/Primitives/Skeleton.cs`): "placeholder loading indicators that mimic the shape of
 * your content", sized with `.Height()`/`.Width()` to match the real thing so the page does not jump
 * when the content replaces them. That is what these are — every measurement below is copied from
 * the corresponding rule in `dashboard.css`, so the box a skeleton reserves is the box the figure or
 * chart lands in.
 *
 * Note this is *not* a port of V1's dashboard, which does something cruder: `DashboardApp.cs`
 * short-circuits the whole page to a centred `Text.Muted("Loading Dashboard Data...")` until
 * `IsDatabaseReady`. That reads as an empty app rather than as the dashboard about to appear, and it
 * throws the layout away and rebuilds it. The framework shipped `Skeleton` for exactly this case, so
 * this takes the framework's idiom over V1's shortcut.
 *
 * `Loading`/`LogoLoading` and the `UseLoading` hook are the framework's other loading affordances and
 * are both wrong here: `UseLoading` documents itself as a *modal* dialog for long-running operations
 * with progress and cancellation, and a modal over a metric tile that resolves in under a second is
 * worse than the flicker it would be replacing.
 */

/** V1's dashboard has four KPI cards, so a placeholder row has four (`DashboardApp.BuildKpis`). */
const KPI_SKELETON_COUNT = 4;

/**
 * Bars in a chart placeholder. Enough to read as a chart without implying a resolution: the real
 * count is the data's, and pretending to know it before it arrives is the kind of guess that makes a
 * skeleton flash when it is replaced.
 */
const CHART_SKELETON_BARS = 8;

/**
 * Heights, as percentages, cycled across the placeholder bars.
 *
 * Fixed rather than random, unlike `Loading`'s skeleton lines: this renders on every dashboard mount,
 * and a silhouette that reshuffles each time reads as data changing rather than as data pending. It
 * also keeps the DOM assertable in a test.
 */
const CHART_SKELETON_HEIGHTS = [38, 62, 45, 78, 55, 88, 48, 70];

/** The four KPI tiles, in their real tones, with the label/value/hint stack blocked out. */
export const KpiSkeletonGrid: React.FC = () => (
  <div
    className="tdb-kpis"
    role="status"
    aria-label="Loading metrics"
    data-testid="tdb-kpis-skeleton"
  >
    {Array.from({ length: KPI_SKELETON_COUNT }, (_unused, index) => (
      // Same `data-tone` cycle as a real tile, so the coloured cards do not change hue on arrival.
      <div className="tdb-kpi" data-tone={index % 4} key={index}>
        <Skeleton className="tdb-skel tdb-skel-kpi-label" />
        <Skeleton className="tdb-skel tdb-skel-kpi-value" />
        <Skeleton className="tdb-skel tdb-skel-kpi-hint" />
      </div>
    ))}
  </div>
);

export interface ChartSkeletonProps {
  /** Announced to a screen reader, so "loading" names the card it belongs to. */
  label: string;
}

/**
 * A bottom-anchored row of bars standing in for one of the dashboard's charts.
 *
 * Bars fill their track with `flex: 1 1 0; min-width: 0`, so the silhouette fits whatever width the
 * card has — the same rule the real bars use, and the reason this cannot be the thing that overflows.
 *
 * The height goes on a wrapper rather than on `Skeleton` itself: the primitive sets its tint through
 * an inline `style` and then spreads its props over it, so a `style` passed in would replace that
 * tint with a transparent box. Sizing a wrapper and letting the skeleton fill it uses the primitive
 * exactly as it is written.
 */
export const ChartSkeleton: React.FC<ChartSkeletonProps> = ({ label }) => (
  <div className="tdb-skel-chart" role="status" aria-label={label} data-testid="tdb-chart-skeleton">
    {Array.from({ length: CHART_SKELETON_BARS }, (_unused, index) => (
      <div
        className="tdb-skel-chart-bar"
        key={index}
        style={{ height: `${CHART_SKELETON_HEIGHTS[index % CHART_SKELETON_HEIGHTS.length]}%` }}
      >
        <Skeleton className="tdb-skel tdb-skel-fill" />
      </div>
    ))}
  </div>
);
