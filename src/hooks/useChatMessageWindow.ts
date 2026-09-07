import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

export interface UseChatMessageWindowOptions {
  count: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  getItemKey: (index: number) => string;
  enabled: boolean;
  estimateSize?: number;
  overscan?: number;
  /** Index that must always be present in `items`, even outside the visible range (e.g. the streaming tail). */
  pinnedIndex?: number;
}

export interface ChatWindowItem {
  index: number;
  key: string;
  start: number;
  measureRef: (el: HTMLElement | null) => void;
}

export interface ScrollToIndexOptions {
  smooth?: boolean;
  align?: "start" | "center" | "end";
}

export interface UseChatMessageWindowReturn {
  isVirtualized: boolean;
  totalSize: number;
  items: ChatWindowItem[];
  scrollToIndex: (index: number, options?: ScrollToIndexOptions) => void;
  visibleRange: { startIndex: number; endIndex: number };
}

const DEFAULT_ESTIMATE_SIZE = 160;
const DEFAULT_OVERSCAN = 6;

export const CHAT_VIRTUALIZATION_MIN_MESSAGES = 40;

/**
 * Hand rolled windowing for variable height chat rows: heights are measured
 * per row via ResizeObserver (a no-op stub under jsdom) and used to build a
 * prefix-sum offset table, which is binary searched against scroll position
 * to decide which rows are in view.
 */
export function useChatMessageWindow(
  options: UseChatMessageWindowOptions,
): UseChatMessageWindowReturn {
  const {
    count,
    scrollContainerRef,
    getItemKey,
    enabled,
    estimateSize = DEFAULT_ESTIMATE_SIZE,
    overscan = DEFAULT_OVERSCAN,
    pinnedIndex,
  } = options;

  const heightsRef = useRef(new Map<string, number>());
  const observersRef = useRef(new Map<string, ResizeObserver>());
  const measureRefCacheRef = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const [heightVersion, setHeightVersion] = useState(0);

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(0);

  useEffect(() => {
    const current = scrollContainerRef.current;
    if (current !== scrollEl) {
      setScrollEl(current);
    }
  });

  useEffect(() => {
    if (!scrollEl) return;

    const readGeometry = () => {
      setScrollTop(scrollEl.scrollTop);
      setClientHeight(scrollEl.clientHeight);
    };

    readGeometry();
    scrollEl.addEventListener("scroll", readGeometry, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", readGeometry);
    };
  }, [scrollEl]);

  useEffect(() => {
    return () => {
      for (const observer of observersRef.current.values()) {
        observer.disconnect();
      }
      observersRef.current.clear();
    };
  }, []);

  const getMeasureRef = useCallback((key: string) => {
    const cache = measureRefCacheRef.current;
    const cached = cache.get(key);
    if (cached) return cached;

    const measureRef = (el: HTMLElement | null) => {
      const observers = observersRef.current;
      const existing = observers.get(key);
      if (existing) {
        existing.disconnect();
        observers.delete(key);
      }
      if (!el) return;

      const measure = () => {
        const next = el.offsetHeight;
        if (next > 0 && heightsRef.current.get(key) !== next) {
          heightsRef.current.set(key, next);
          setHeightVersion((v) => v + 1);
        }
      };
      measure();

      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        observers.set(key, observer);
      }
    };

    cache.set(key, measureRef);
    return measureRef;
  }, []);

  const keys = useMemo(() => {
    const result: string[] = new Array(count);
    for (let i = 0; i < count; i++) result[i] = getItemKey(i);
    return result;
  }, [count, getItemKey]);

  const prefixSums = useMemo(() => {
    const sums = new Array<number>(count + 1);
    sums[0] = 0;
    for (let i = 0; i < count; i++) {
      const height = heightsRef.current.get(keys[i]) ?? estimateSize;
      sums[i + 1] = sums[i] + height;
    }
    return sums;
    // heightVersion is not read directly, but forces this to recompute whenever
    // a row's measured height changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, keys, estimateSize, heightVersion]);

  const totalSize = prefixSums[count] ?? 0;

  const findIndex = useCallback(
    (offset: number) => {
      let lo = 0;
      let hi = count;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (prefixSums[mid + 1] <= offset) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      return Math.min(lo, Math.max(count - 1, 0));
    },
    [count, prefixSums],
  );

  const items = useMemo<ChatWindowItem[]>(() => {
    if (!enabled || count === 0) return [];

    const startIndex = Math.max(0, findIndex(scrollTop) - overscan);
    const endIndex = Math.min(count - 1, findIndex(scrollTop + clientHeight) + overscan);

    const result: ChatWindowItem[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      result.push({
        index: i,
        key: keys[i],
        start: prefixSums[i],
        measureRef: getMeasureRef(keys[i]),
      });
    }

    if (
      pinnedIndex !== undefined &&
      pinnedIndex >= 0 &&
      pinnedIndex < count &&
      (pinnedIndex < startIndex || pinnedIndex > endIndex)
    ) {
      result.push({
        index: pinnedIndex,
        key: keys[pinnedIndex],
        start: prefixSums[pinnedIndex],
        measureRef: getMeasureRef(keys[pinnedIndex]),
      });
    }

    return result;
  }, [
    enabled,
    count,
    scrollTop,
    clientHeight,
    overscan,
    findIndex,
    keys,
    prefixSums,
    getMeasureRef,
    pinnedIndex,
  ]);

  const visibleRange = useMemo(() => {
    if (count === 0) return { startIndex: -1, endIndex: -1 };
    if (clientHeight === 0) return { startIndex: 0, endIndex: count - 1 };
    return {
      startIndex: findIndex(scrollTop),
      endIndex: findIndex(scrollTop + clientHeight),
    };
  }, [count, clientHeight, findIndex, scrollTop]);

  const scrollToIndex = useCallback(
    (index: number, options?: ScrollToIndexOptions) => {
      if (index < 0 || index >= count) return;
      const smooth = options?.smooth ?? false;
      const align = options?.align ?? "start";

      const container = scrollContainerRef.current ?? scrollEl;
      if (!container) return;

      if (!enabled) {
        const targetEl = container.querySelector(`[data-index="${index}"]`);
        if (targetEl && typeof (targetEl as HTMLElement).scrollIntoView === "function") {
          (targetEl as HTMLElement).scrollIntoView({
            behavior: smooth ? "smooth" : "auto",
            block: align,
          });
        }
        const itemHeight = heightsRef.current.get(keys[index]) ?? estimateSize;
        const itemStart = prefixSums[index];
        const ch = container.clientHeight || clientHeight;
        let targetTop = itemStart;
        if (align === "center") {
          targetTop = itemStart - (ch - itemHeight) / 2;
        } else if (align === "end") {
          targetTop = itemStart - ch + itemHeight;
        }
        const maxScroll = Math.max(0, totalSize - ch);
        targetTop = Math.max(0, Math.min(targetTop, maxScroll));
        if (typeof container.scrollTo === "function") {
          container.scrollTo({ top: targetTop, behavior: smooth ? "smooth" : "auto" });
        }
        container.scrollTop = targetTop;
        setScrollTop(targetTop);
        return;
      }

      const itemHeight = heightsRef.current.get(keys[index]) ?? estimateSize;
      const itemStart = prefixSums[index];
      const ch = container.clientHeight || clientHeight;
      let targetTop = itemStart;
      if (align === "center") {
        targetTop = itemStart - (ch - itemHeight) / 2;
      } else if (align === "end") {
        targetTop = itemStart - ch + itemHeight;
      }
      const maxScroll = Math.max(0, totalSize - ch);
      targetTop = Math.max(0, Math.min(targetTop, maxScroll));

      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: targetTop, behavior: smooth ? "smooth" : "auto" });
      }
      container.scrollTop = targetTop;
      setScrollTop(targetTop);
    },
    [
      count,
      enabled,
      scrollContainerRef,
      scrollEl,
      keys,
      estimateSize,
      prefixSums,
      clientHeight,
      totalSize,
    ],
  );

  if (!enabled) {
    return {
      isVirtualized: false,
      totalSize: 0,
      items: [],
      scrollToIndex,
      visibleRange,
    };
  }

  return {
    isVirtualized: true,
    totalSize,
    items,
    scrollToIndex,
    visibleRange,
  };
}

export default useChatMessageWindow;
