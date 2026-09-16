import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface Options {
  onPaths: (paths: string[]) => void;
  onDragStateChange: (isOver: boolean) => void;
  /**
   * Whether to register at all, defaulting to yes.
   *
   * The listener is on the **webview**, so it answers a drop anywhere in the window rather than only
   * on the subtree that asked for it. A second consumer therefore is not a second drop target, it is
   * two handlers for every drop — which is why the chat hosted inside a plan page passes false and
   * relies on its own React drag handlers instead.
   */
  enabled?: boolean;
}

export function useWebviewFileDrop({
  onPaths,
  onDragStateChange,
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
          if (payload.type === "enter") {
            handlers.current.onDragStateChange(true);
          } else if (payload.type === "leave") {
            handlers.current.onDragStateChange(false);
          } else if (payload.type === "drop") {
            handlers.current.onDragStateChange(false);
            handlers.current.onPaths(payload.paths);
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
  }, [enabled]);

  return isActive;
}
