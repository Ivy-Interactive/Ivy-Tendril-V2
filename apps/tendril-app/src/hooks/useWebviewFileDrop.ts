import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface Options {
  onPaths: (paths: string[]) => void;
  onDragStateChange: (isOver: boolean) => void;
}

export function useWebviewFileDrop({ onPaths, onDragStateChange }: Options): boolean {
  const [isActive, setIsActive] = useState(false);
  // Refs keep the effect deps empty so a re-render never re-subscribes.
  const handlers = useRef({ onPaths, onDragStateChange });
  handlers.current = { onPaths, onDragStateChange };

  useEffect(() => {
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
  }, []);

  return isActive;
}
