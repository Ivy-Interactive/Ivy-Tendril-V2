import * as React from "react";

import { cn } from "@/lib/utils";
import { useDensity } from "@/contexts/density-context";
import { Densities } from "@/types/density";

import { useVirtualList } from "./use-virtual-list";

/**
 * First-paint item-height estimates per density, carried over from the framework's `ListWidget`.
 * Looser than the data table's map because list rows are not table cells.
 */
export const VIRTUAL_LIST_ITEM_HEIGHT_ESTIMATES: Record<Densities, number> = {
  [Densities.Small]: 44,
  [Densities.Medium]: 60,
  [Densities.Large]: 76,
};

export interface VirtualListProps<TItem> {
  items: TItem[];
  renderItem: (item: TItem, index: number) => React.ReactNode;
  /** Stable key per item. Measurements are cached against it, so reordering keeps real heights. */
  getItemKey: (item: TItem, index: number) => string;
  /** Overrides the density estimate, in px. Real heights are measured after first paint. */
  estimateSize?: number;
  /** Items rendered beyond the visible range. Defaults to 6. */
  overscan?: number;
  /**
   * Index always kept mounted, even when scrolled out of view — for a focused row, or a streaming
   * tail whose in-progress content must not be torn down.
   */
  pinnedIndex?: number;
  /** Applied to the scroll container. It must have a bounded height for windowing to mean anything. */
  className?: string;
  /** Applied to each item wrapper. */
  itemClassName?: string;
  density?: Densities;
  "aria-label"?: string;
  "data-testid"?: string;
}

/**
 * A windowed list that owns its scroll container.
 *
 * Only the visible slice plus `overscan` is mounted; the container's inner spacer carries the full
 * height so the scrollbar is honest, and items are absolutely positioned within it. Structure is
 * adapted from the framework's `ListWidget`, minus the widget-tree plumbing — this takes plain React
 * children through `renderItem`, not a `WidgetNode` map.
 *
 * Absolute positioning is fine here and deliberately *not* what the data table does: a `<tr>` cannot
 * be absolutely positioned without breaking column alignment and the sticky header, so the table
 * pads with spacer rows instead.
 */
export function VirtualList<TItem>({
  items,
  renderItem,
  getItemKey,
  estimateSize,
  overscan,
  pinnedIndex,
  className,
  itemClassName,
  density: propDensity,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
}: VirtualListProps<TItem>) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const globalDensity = useDensity();
  const density = propDensity ?? globalDensity;
  const estimate = estimateSize ?? VIRTUAL_LIST_ITEM_HEIGHT_ESTIMATES[density];

  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  const estimateSizeFn = React.useCallback(() => estimate, [estimate]);
  const getKey = React.useCallback(
    (index: number) => {
      const item = itemsRef.current[index];
      return item === undefined ? index : getItemKey(item, index);
    },
    [getItemKey],
  );

  const {
    items: virtualItems,
    totalSize,
    measureElement,
  } = useVirtualList({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateSizeFn,
    overscan,
    getItemKey: getKey,
    pinnedIndex,
  });

  return (
    <div
      ref={scrollRef}
      className={cn("relative h-full w-full overflow-y-auto", className)}
      aria-label={ariaLabel}
      data-testid={dataTestId}
    >
      <div className="relative w-full" style={{ height: totalSize }}>
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          return (
            <div
              key={virtualItem.key}
              // virtual-core reads `data-index` back off the measured element and warns without it.
              data-index={virtualItem.index}
              ref={measureElement}
              className={cn("absolute top-0 left-0 w-full min-w-0", itemClassName)}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              {renderItem(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

VirtualList.displayName = "VirtualList";
