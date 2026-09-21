import { useEffect } from "react";
import type { RefObject } from "react";

export interface UseMenuKeyboardOptions {
  /** The menu's own element, e.g. the `role="menu"` node. Arrow/Home/End navigation is scoped to
   * items inside it, and a keydown is ignored unless it originates inside this element. */
  containerRef: RefObject<HTMLElement | null>;
  /** The element Escape returns focus to. */
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Selector for one navigable row. Defaults to an enabled `role="menuitem"`; a widget built on a
   * different ARIA pattern (e.g. BadgeSelect's `role="option"` listbox) passes its own. */
  itemSelector?: string;
  /** Focuses the first item as soon as the menu opens. Only pass this for a keyboard-triggered open
   * (e.g. `event.detail === 0` on the opening click) — doing it unconditionally would steal focus
   * out from under a mouse click that opened the same menu. */
  autoFocusFirst?: boolean;
}

const DEFAULT_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

/**
 * Escape, ArrowUp/ArrowDown (wrapping) and Home/End for a hand-rolled popover menu. Only listens
 * while `open`, and only acts on a keydown whose target is inside `containerRef` or is the trigger
 * itself (so arrow keys work right after a mouse click opens the menu, before focus has moved off
 * the trigger) — it never intercepts a key typed in an unrelated input, such as the textarea a
 * menu's trigger sits next to.
 */
export function useMenuKeyboard(open: boolean, options: UseMenuKeyboardOptions): void {
  const {
    containerRef,
    triggerRef,
    onClose,
    itemSelector = DEFAULT_ITEM_SELECTOR,
    autoFocusFirst,
  } = options;

  useEffect(() => {
    if (!open) return;
    if (autoFocusFirst) {
      containerRef.current?.querySelector<HTMLElement>(itemSelector)?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const target = e.target as Node | null;
      const insideMenu = !!target && container.contains(target);
      const onTrigger = !!target && target === triggerRef.current;
      if (!insideMenu && !onTrigger) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        triggerRef.current?.focus();
        return;
      }

      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") {
        return;
      }

      const items = [...container.querySelectorAll<HTMLElement>(itemSelector)];
      if (items.length === 0) return;
      e.preventDefault();

      if (e.key === "Home") {
        items[0].focus();
        return;
      }
      if (e.key === "End") {
        items[items.length - 1].focus();
        return;
      }

      const current = items.indexOf(document.activeElement as HTMLElement);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      items[(current + delta + items.length) % items.length].focus();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, containerRef, triggerRef, onClose, itemSelector, autoFocusFirst]);
}
