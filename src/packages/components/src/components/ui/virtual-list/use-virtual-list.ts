import * as React from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { Range, VirtualItem } from "@tanstack/react-virtual";

export interface UseVirtualListOptions {
  /** Total number of items, rendered or not. */
  count: number;
  /** The scrolling element. Returning `null` disables windowing until it exists. */
  getScrollElement: () => HTMLElement | null;
  /** First-paint size estimate in px for the item at `index`. Real sizes come from measurement. */
  estimateSize: (index: number) => number;
  /** Items rendered beyond the visible range. Defaults to 6, matching the framework's ListWidget. */
  overscan?: number;
  /**
   * Stable key per index. Measurements are cached against it, so a reordered list keeps each item's
   * measured height instead of reusing its predecessor's.
   */
  getItemKey?: (index: number) => string | number;
  /**
   * Index always kept in the rendered range. Reproduces the chat windower's streaming-tail
   * guarantee: the pinned item never unmounts, so focus and in-progress content survive a scroll
   * that takes it out of view.
   */
  pinnedIndex?: number;
}

export interface UseVirtualListResult {
  /** The items to render, ascending by index. */
  items: VirtualItem[];
  /** Sum of every item size, measured where known and estimated elsewhere. */
  totalSize: number;
  scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => void;
  /** Pass as each item's `ref`. The element must also carry `data-index`. */
  measureElement: (node: HTMLElement | null) => void;
  /** Drops the measurement cache, e.g. after the content of every item changed. */
  measure: () => void;
}

export const DEFAULT_VIRTUAL_LIST_OVERSCAN = 6;

/**
 * A typed, minimal wrapper over `useVirtualizer` for consumers that own their own scroll element.
 *
 * It exists so windowing is one shared implementation rather than one per surface, and so
 * `pinnedIndex` — the part every hand-rolled windower gets wrong — is written once. `VirtualList`
 * is the batteries-included component built on it; use this hook directly when the scroll container
 * is not yours to create.
 */
export function useVirtualList({
  count,
  getScrollElement,
  estimateSize,
  overscan = DEFAULT_VIRTUAL_LIST_OVERSCAN,
  getItemKey,
  pinnedIndex,
}: UseVirtualListOptions): UseVirtualListResult {
  const rangeExtractor = React.useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (pinnedIndex === undefined || pinnedIndex < 0 || pinnedIndex >= range.count) {
        return indexes;
      }
      if (indexes.includes(pinnedIndex)) return indexes;
      return [...indexes, pinnedIndex].sort((a, b) => a - b);
    },
    [pinnedIndex],
  );

  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count,
    getScrollElement,
    estimateSize,
    overscan,
    getItemKey,
    rangeExtractor,
  });

  const { measureElement, scrollToIndex, measure } = virtualizer;

  return {
    items: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    scrollToIndex: React.useCallback(
      (index, options) => {
        scrollToIndex(index, options);
      },
      [scrollToIndex],
    ),
    measureElement,
    measure,
  };
}
