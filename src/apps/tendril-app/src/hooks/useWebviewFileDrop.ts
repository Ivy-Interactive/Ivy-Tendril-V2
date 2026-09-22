import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";

export function isPositionInsideElement(
  position: { x: number; y: number } | undefined,
  element: HTMLElement | null,
): boolean {
  if (!element || !position) return true;
  const rect = element.getBoundingClientRect();
  // In jsdom / test environments where layout is not computed, width and height are 0.
  // Allow the drop so jsdom tests work without manual rect mocking.
  if (rect.width === 0 && rect.height === 0) return true;

  const scale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const logicalX = position.x / scale;
  const logicalY = position.y / scale;

  if (
    logicalX >= rect.left &&
    logicalX <= rect.right &&
    logicalY >= rect.top &&
    logicalY <= rect.bottom
  ) {
    return true;
  }

  // Also check unscaled coordinates in case position is already in CSS/logical pixels
  if (
    position.x >= rect.left &&
    position.x <= rect.right &&
    position.y >= rect.top &&
    position.y <= rect.bottom
  ) {
    return true;
  }

  return false;
}

interface Options {
  onPaths: (paths: string[]) => void;
  onDragStateChange: (isOver: boolean) => void;
  /**
   * Optional target container element to scope drag-and-drop to.
   *
   * When provided, `onDragStateChange` and `onPaths` are only fired if the drop position is
   * within this element's bounding box.
   */
  targetRef?: React.RefObject<HTMLElement | null>;
  /**
   * Whether to register at all, defaulting to yes.
   */
  enabled?: boolean;
}

export function useWebviewFileDrop({
  onPaths,
  onDragStateChange,
  targetRef,
  enabled = true,
}: Options): boolean {
  const [isActive, setIsActive] = useState(false);
  // Refs keep the effect deps empty so a re-render never re-subscribes.
  const handlers = useRef({ onPaths, onDragStateChange });
  handlers.current = { onPaths, onDragStateChange };

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void (async () => {
      try {
        const webview = getCurrentWebview();
        const fn = await webview.onDragDropEvent((event) => {
          const { payload } = event;
          const target = targetRef?.current ?? null;

          if (payload.type === "enter" || payload.type === "over") {
            const isInside = isPositionInsideElement(payload.position, target);
            handlers.current.onDragStateChange(isInside);
          } else if (payload.type === "leave") {
            handlers.current.onDragStateChange(false);
          } else if (payload.type === "drop") {
            handlers.current.onDragStateChange(false);
            const isInside = isPositionInsideElement(payload.position, target);
            if (isInside && payload.paths && payload.paths.length > 0) {
              handlers.current.onPaths(payload.paths);
            }
          }
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        setIsActive(true);
      } catch {
        // Not running under Tauri (e.g. `pnpm dev` opened in a plain browser).
      }
    })();

    return () => {
      cancelled = true;
      setIsActive(false);
      unlisten?.();
    };
  }, [enabled, targetRef]);

  return isActive;
}
