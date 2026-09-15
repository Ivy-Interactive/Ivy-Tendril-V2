import { useCallback, useMemo, useRef, useEffect } from "react";

export type FocusDirection = "next" | "previous" | "first" | "last";

export interface FocusManager {
  focusNext: () => void;
  focusPrevious: () => void;
  focusFirst: () => void;
  focusLast: () => void;
  focusIndex: (index: number) => void;
  registerElement: (element: HTMLElement, priority?: number) => void;
  unregisterElement: (element: HTMLElement) => void;
}

const focusRegistry = new Map<string, HTMLElement[]>();

/**
 * Roving focus across a named group of elements, ordered by priority (lower first).
 *
 * Unlike a focus trap this moves *real* DOM focus between siblings, which is what a list whose arrow
 * keys only move a highlight index is missing.
 */
export const useFocusManagement = (groupId: string): FocusManager => {
  const getElements = useCallback(() => {
    return focusRegistry.get(groupId) || [];
  }, [groupId]);

  const focusNext = useCallback(() => {
    const elements = getElements();
    if (elements.length === 0) return;

    const activeElement = document.activeElement as HTMLElement;
    const currentIndex = elements.indexOf(activeElement);

    if (currentIndex === -1 || currentIndex === elements.length - 1) {
      // Focus first element if no current focus or at last element
      elements[0]?.focus();
    } else {
      // Focus next element
      elements[currentIndex + 1]?.focus();
    }
  }, [getElements]);

  const focusPrevious = useCallback(() => {
    const elements = getElements();
    if (elements.length === 0) return;

    const activeElement = document.activeElement as HTMLElement;
    const currentIndex = elements.indexOf(activeElement);

    if (currentIndex === -1 || currentIndex === 0) {
      // Focus last element if no current focus or at first element
      elements[elements.length - 1]?.focus();
    } else {
      // Focus previous element
      elements[currentIndex - 1]?.focus();
    }
  }, [getElements]);

  const focusFirst = useCallback(() => {
    const elements = getElements();
    elements[0]?.focus();
  }, [getElements]);

  const focusLast = useCallback(() => {
    const elements = getElements();
    elements[elements.length - 1]?.focus();
  }, [getElements]);

  /**
   * Focus one position in the walk. A caller that already tracks a selected index — a list whose
   * arrow keys move a highlight, say — needs this rather than focusNext(): stepping the walk from
   * "nothing in this group has focus" lands on the first element, which is one row behind a
   * highlight that has already moved.
   */
  const focusIndex = useCallback(
    (index: number) => {
      getElements()[index]?.focus();
    },
    [getElements],
  );

  const registerElement = useCallback(
    (element: HTMLElement, priority?: number) => {
      const elements = getElements();
      // Registering twice is a no-op: React Strict Mode double-invokes a ref callback, and pushing
      // unconditionally would leave the element in the walk twice.
      if (elements.includes(element)) return;
      // An explicit priority argument wins over the data attribute useFocusable writes, so a direct
      // registerElement(el, 2) call actually orders by priority.
      if (priority !== undefined) {
        element.setAttribute("data-focus-priority", priority.toString());
      }
      elements.push(element);
      // Sort by priority (lower numbers = higher priority)
      elements.sort((a, b) => {
        const aPriority = parseInt(a.getAttribute("data-focus-priority") || "0");
        const bPriority = parseInt(b.getAttribute("data-focus-priority") || "0");
        return aPriority - bPriority;
      });
      focusRegistry.set(groupId, elements);
    },
    [groupId, getElements],
  );

  const unregisterElement = useCallback(
    (element: HTMLElement) => {
      const elements = getElements();
      const index = elements.indexOf(element);
      if (index > -1) {
        elements.splice(index, 1);
        focusRegistry.set(groupId, elements);
      }
    },
    [groupId, getElements],
  );

  // Memoized because useFocusable hangs both its ref callback and its unmount effect off this
  // object. A fresh object per render re-runs that effect's cleanup after the refs have already
  // re-attached, so every re-render of the host left the group empty and focusNext() a no-op — the
  // roving focus worked exactly once, until the first state change.
  return useMemo(
    () => ({
      focusNext,
      focusPrevious,
      focusFirst,
      focusLast,
      focusIndex,
      registerElement,
      unregisterElement,
    }),
    [
      focusNext,
      focusPrevious,
      focusFirst,
      focusLast,
      focusIndex,
      registerElement,
      unregisterElement,
    ],
  );
};

// Hook for components that want to participate in focus management
export const useFocusable = (groupId: string, priority: number = 0) => {
  const focusManager = useFocusManagement(groupId);
  const elementRef = useRef<HTMLElement | null>(null);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      // Unregister previous element if it exists
      if (elementRef.current) {
        focusManager.unregisterElement(elementRef.current);
      }

      // Register new element
      if (element) {
        focusManager.registerElement(element, priority);
        elementRef.current = element;
      } else {
        elementRef.current = null;
      }
    },
    [focusManager, priority],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (elementRef.current) {
        focusManager.unregisterElement(elementRef.current);
      }
    };
  }, [focusManager]);

  return { ref, focusManager };
};

/** For testing only — clears every focus group */
export function _resetFocusRegistryForTesting(): void {
  focusRegistry.clear();
}
