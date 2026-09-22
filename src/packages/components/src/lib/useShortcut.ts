import { useEffect, useRef, type RefObject } from "react";
import { parseShortcut } from "./shortcut";
import { registerShortcut, unregisterShortcut } from "./shortcutRegistry";

/**
 * Registers a keyboard shortcut with the centralized shortcut registry.
 * Handles registration/unregistration lifecycle via useEffect.
 */
export function useShortcut(
  id: string,
  shortcutKey: string | undefined,
  handler: () => void,
  options: {
    /** What the shortcut does, e.g. "Toggle sidebar collapse" — rendered by the help panel. */
    description: string;
    disabled?: boolean;
    skipInInputs?: boolean;
    elementRef?: RefObject<HTMLElement | null>;
    /**
     * False opts out of the registry's 300ms duplicate-fire debounce (default true). A toggle is
     * not idempotent, so two genuine presses inside 300ms must flip it twice: pass false for those.
     */
    debounce?: boolean;
  },
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const { description } = options;
  const disabled = options.disabled ?? false;
  const skipInInputs = options.skipInInputs ?? true;
  const elementRef = options.elementRef;
  const debounce = options.debounce ?? true;

  useEffect(() => {
    if (!shortcutKey || disabled) return;

    const shortcut = parseShortcut(shortcutKey);
    if (!shortcut) return;

    registerShortcut({
      id,
      shortcut,
      handler: () => handlerRef.current(),
      description,
      isActive: () => {
        if (!elementRef?.current) return true;
        return !elementRef.current.closest('[aria-hidden="true"]');
      },
      skipInInputs,
      displayKey: shortcutKey,
      debounce,
    });

    return () => {
      unregisterShortcut(id);
    };
  }, [id, shortcutKey, description, disabled, skipInInputs, elementRef, debounce]);
}
