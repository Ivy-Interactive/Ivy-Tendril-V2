import React, { useCallback, useRef, useState } from "react";

export interface UseResizableSidebarOptions {
  /**
   * localStorage key used to persist the sidebar width.
   * If omitted, width is kept in component state only.
   */
  storageKey?: string;
  /**
   * Default width in pixels when no persisted value exists or when reset.
   * Defaults to 320.
   */
  defaultWidth?: number;
  /**
   * Minimum allowable width in pixels.
   * Defaults to 200.
   */
  minWidth?: number;
  /**
   * Maximum allowable width in pixels.
   * Defaults to 640.
   */
  maxWidth?: number;
  /**
   * Screen anchor for the sidebar.
   * 'left' (default): dragging right increases width (derived from e.clientX).
   * 'right': dragging left increases width (derived from window.innerWidth - e.clientX).
   */
  side?: "left" | "right";
  /**
   * Optional callback when width changes.
   */
  onWidthChange?: (width: number) => void;
}

export interface UseResizableSidebarReturn {
  width: number;
  setWidth: (width: number | ((prev: number) => number)) => void;
  resetWidth: () => void;
  isDragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: (e?: React.MouseEvent<HTMLElement>) => void;
  separatorProps: {
    role: "separator";
    "aria-orientation": "vertical";
    tabIndex: 0;
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onDoubleClick: (e?: React.MouseEvent<HTMLElement>) => void;
  };
}

export function readStoredWidth(key: string, minWidth: number, maxWidth: number): number | null {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(key);
      if (raw != null) {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isNaN(parsed)) {
          return Math.min(Math.max(parsed, minWidth), maxWidth);
        }
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
  return null;
}

export function writeStoredWidth(key: string, width: number | null): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (width == null) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, String(width));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

export function useResizableSidebar(
  options: UseResizableSidebarOptions = {},
): UseResizableSidebarReturn {
  const {
    storageKey,
    defaultWidth = 320,
    minWidth = 200,
    maxWidth = 640,
    side = "left",
    onWidthChange,
  } = options;

  const clampedDefault = Math.min(Math.max(defaultWidth, minWidth), maxWidth);

  const [width, setWidthState] = useState<number>(() => {
    if (storageKey) {
      const stored = readStoredWidth(storageKey, minWidth, maxWidth);
      if (stored != null) {
        return stored;
      }
    }
    return clampedDefault;
  });

  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const optionsRef = useRef({
    storageKey,
    defaultWidth: clampedDefault,
    minWidth,
    maxWidth,
    side,
    onWidthChange,
  });

  optionsRef.current = {
    storageKey,
    defaultWidth: clampedDefault,
    minWidth,
    maxWidth,
    side,
    onWidthChange,
  };

  const setWidth = useCallback((action: number | ((prev: number) => number)) => {
    setWidthState((prev) => {
      const nextVal = typeof action === "function" ? action(prev) : action;
      const {
        minWidth: min,
        maxWidth: max,
        storageKey: key,
        onWidthChange: cb,
      } = optionsRef.current;
      const clamped = Math.min(Math.max(nextVal, min), max);
      if (key) {
        writeStoredWidth(key, clamped);
      }
      cb?.(clamped);
      return clamped;
    });
  }, []);

  const resetWidth = useCallback(() => {
    const { defaultWidth: def, storageKey: key, onWidthChange: cb } = optionsRef.current;
    setWidthState(def);
    if (key) {
      writeStoredWidth(key, def);
    }
    cb?.(def);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore
    }
    isDraggingRef.current = true;
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!isDraggingRef.current) return;
    const {
      side: currentSide,
      minWidth: min,
      maxWidth: max,
      storageKey: key,
      onWidthChange: cb,
    } = optionsRef.current;
    const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
    const rawWidth = currentSide === "right" ? windowWidth - e.clientX : e.clientX;
    const clamped = Math.min(Math.max(rawWidth, min), max);
    setWidthState(clamped);
    if (key) {
      writeStoredWidth(key, clamped);
    }
    cb?.(clamped);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

  const onDoubleClick = useCallback(
    (_e?: React.MouseEvent<HTMLElement>) => {
      resetWidth();
    },
    [resetWidth],
  );

  return {
    width,
    setWidth,
    resetWidth,
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    separatorProps: {
      role: "separator",
      "aria-orientation": "vertical",
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
    },
  };
}
