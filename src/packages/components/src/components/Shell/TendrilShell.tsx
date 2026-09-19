import React, { useCallback, useEffect, useRef, useState } from "react";
import { ShellContext } from "./ShellContext.tsx";
import { type ShellWidgetProps, isModKey } from "./types.ts";
import {
  useResizableSidebar,
  readStoredWidth as readStoredWidthHelper,
  writeStoredWidth as writeStoredWidthHelper,
} from "../../hooks/use-resizable-sidebar";
import { TooltipScope } from "../ui/TuiTooltip";
import "./shell.css";

interface TendrilShellProps extends ShellWidgetProps {
  collapsed?: boolean;
  activeSessionIndex?: number | null;
  hasTabs?: boolean;
  slots?: {
    SidebarHeader?: React.ReactNode;
    SidebarBody?: React.ReactNode;
    SidebarFooter?: React.ReactNode;
    Content?: React.ReactNode;
    SessionContents?: React.ReactNode;
    Tabs?: React.ReactNode;
    Hidden?: React.ReactNode;
  };
}

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "tendril.shell.sidebarCollapsed";
export const SIDEBAR_WIDTH_STORAGE_KEY = "tendril.shell.sidebarWidth";
export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 640;

const readStoredCollapsed = (): boolean | null => {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
};

const writeStoredCollapsed = (collapsed: boolean) => {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    /* storage unavailable (private mode, sandboxed host): the state just doesn't persist */
  }
};

export function readStoredWidth(): number | null {
  return readStoredWidthHelper(SIDEBAR_WIDTH_STORAGE_KEY, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

export function writeStoredWidth(width: number | null): void {
  writeStoredWidthHelper(SIDEBAR_WIDTH_STORAGE_KEY, width);
}

/**
 * The Tendril app chrome: sidebar (expanded / icon rail) and one rounded,
 * bordered container holding the white content surface with the session tab
 * strip inside its bottom edge. Collapse is client-side for a smooth
 * animation; the host is notified through OnCollapsedChanged so the state
 * can be persisted, and remembered locally so a reload does not flash the
 * other width. Session panes all stay mounted - only the active one is
 * visible - so agent terminals keep their buffers when switching tabs. The
 * Hidden slot hosts zero-size utility widgets (shortcut ghosts, chunk
 * warm-ups) without letting them paint.
 */
export const TendrilShell: React.FC<TendrilShellProps> = ({
  id,
  events = [],
  eventHandler,
  collapsed: collapsedProp = false,
  activeSessionIndex,
  hasTabs = false,
  slots,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    const stored = readStoredCollapsed();
    return stored != null ? stored : collapsedProp;
  });
  const {
    width: sidebarWidth,
    isDragging,
    separatorProps,
  } = useResizableSidebar({
    storageKey: SIDEBAR_WIDTH_STORAGE_KEY,
    defaultWidth: DEFAULT_SIDEBAR_WIDTH,
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
  });
  const prevPropRef = useRef(collapsedProp);
  if (collapsedProp !== prevPropRef.current) {
    prevPropRef.current = collapsedProp;
    if (collapsedProp !== collapsed) setCollapsed(collapsedProp);
  }

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeStoredCollapsed(next);
      if (events.includes("OnCollapsedChanged")) {
        eventHandler("OnCollapsedChanged", id, [next]);
      }
      return next;
    });
  }, [events, eventHandler, id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isModKey(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const sessionPanes = React.Children.toArray(slots?.SessionContents ?? []);
  const hasActiveSession =
    activeSessionIndex != null &&
    activeSessionIndex >= 0 &&
    activeSessionIndex < sessionPanes.length;

  return (
    <TooltipScope>
      <div
        /* No `remove-parent-padding` class here. It is Ivy's opt-out for full-bleed widgets, but it only
         works through the `:has(> .remove-parent-padding)` rules in the framework's `index.css`, and V2
         ships no stylesheet implementing them — so carrying it made these components *look* as though
         they handled their own inset while the shell went on padding them anyway. V2 decides full-bleed
         in one place instead: `AppDescriptor.fullBleed` in the app registry, read by `ShellLayout`. */
        className="tsh-root"
        data-collapsed={collapsed}
        data-resizing={isDragging}
        style={
          {
            "--tsh-sidebar-width": `${sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <ShellContext.Provider value={{ collapsed, toggle }}>
          <div className="tsh-sidebar">
            <div className="tsh-sidebar-header">{slots?.SidebarHeader}</div>
            <div className="tsh-sidebar-body">{slots?.SidebarBody}</div>
            <div className="tsh-sidebar-footer">{slots?.SidebarFooter}</div>
            {!collapsed && (
              <div
                className="tsh-sidebar-resizer"
                {...separatorProps}
                aria-label="Resize sidebar"
                title="Drag to resize sidebar, double-click to reset"
              />
            )}
          </div>
        </ShellContext.Provider>
        {/* The rail is a property of the sidebar, not of the app inside the frame: content
          widgets that read `useShell()` must never render their own collapsed variant. */}
        <ShellContext.Provider value={{ collapsed: false, toggle }}>
          <div className="tsh-main">
            <div className="tsh-container">
              <div className="tsh-frame" data-has-tabs={hasTabs}>
                <div className="tsh-frame-pane" data-active={!hasActiveSession}>
                  {slots?.Content}
                </div>
                {sessionPanes.map((pane, index) => (
                  <div
                    className="tsh-frame-pane"
                    data-active={hasActiveSession && index === activeSessionIndex}
                    key={(React.isValidElement(pane) && pane.key) || index}
                  >
                    {pane}
                  </div>
                ))}
              </div>
              {hasTabs && slots?.Tabs && <div className="tsh-tabs-row">{slots.Tabs}</div>}
            </div>
          </div>
        </ShellContext.Provider>
        {slots?.Hidden && <div style={{ display: "none" }}>{slots.Hidden}</div>}
      </div>
    </TooltipScope>
  );
};
