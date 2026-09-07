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

export interface UseChatMessageWindowReturn {
  isVirtualized: boolean;
  totalSize: number;
  items: ChatWindowItem[];
}

const DISABLED_RESULT: UseChatMessageWindowReturn = {
  isVirtualized: false,
  totalSize: 0,
  items: [],
};

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
  options: UseChatMessageWindowOptions
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
    if (!enabled) return;
    const current = scrollContainerRef.current;
    if (current !== scrollEl) {
      setScrollEl(current);
    }
  });

  useEffect(() => {
    if (!enabled || !scrollEl) return;

    const readGeometry = () => {
      setScrollTop(scrollEl.scrollTop);
      setClientHeight(scrollEl.clientHeight);
    };

    readGeometry();
    scrollEl.addEventListener("scroll", readGeometry, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", readGeometry);
    };
  }, [enabled, scrollEl]);

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
    [count, prefixSums]
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

  if (!enabled) {
    return DISABLED_RESULT;
  }

  return {
    isVirtualized: true,
    totalSize,
    items,
  };
}

export default useChatMessageWindow;
