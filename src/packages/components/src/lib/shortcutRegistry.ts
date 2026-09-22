/// <reference types="vite/client" />
import { isPunctuationKey, keyToCode, type ParsedShortcut } from "./shortcut";

type ShortcutHandler = () => void;

export interface ShortcutRegistration {
  id: string;
  shortcut: ParsedShortcut;
  handler: ShortcutHandler;
  /** Human-readable description, e.g. "Toggle sidebar collapse" — this is what a help panel renders. */
  description: string;
  /** Returns true if this handler should be active (e.g., not in an aria-hidden or hidden container) */
  isActive: () => boolean;
  /** If true, skip firing when the target is a *visible* INPUT/TEXTAREA/SELECT/contentEditable/xterm */
  skipInInputs: boolean;
  /** Raw shortcut string for display (e.g., "Ctrl+K") */
  displayKey: string;
  /**
   * False opts this registration out of the 300ms duplicate-fire debounce (default true). The
   * debounce exists to absorb a key repeat or an accidental double-fire during a UI transition, but
   * it also makes a toggle non-idempotent: two genuine presses inside 300ms should flip the state
   * twice, back to where it started, not once. A toggle action should set this false.
   */
  debounce?: boolean;
}

export interface ShortcutInfo {
  id: string;
  /** Serialized canonical key (e.g., "ctrl+k") */
  shortcutKey: string;
  /** Raw shortcut string for display formatting */
  displayKey: string;
  /** Human-readable description of what the shortcut does */
  description: string;
  isActive: boolean;
}

const registry = new Map<string, ShortcutRegistration>();

// Debounce state for keyboard shortcuts to prevent duplicate triggers during UI transitions
const recentShortcuts = new Map<string, number>();
const DEBOUNCE_MS = 300;
const SWEEP_INTERVAL_MS = 5 * DEBOUNCE_MS; // 1500ms
let sweepTimerId: ReturnType<typeof setInterval> | null = null;

/** Composite widgets that move their own focus with the arrow keys keep them. */
const ARROW_OWNER =
  '[role="menu"], [role="menubar"], [role="listbox"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="tree"], [role="grid"]';

export function serializeShortcut(shortcut: ParsedShortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push("ctrl");
  if (shortcut.meta) parts.push("meta");
  if (shortcut.alt) parts.push("alt");
  if (shortcut.shift) parts.push("shift");
  parts.push(shortcut.key.toLowerCase());
  return parts.join("+");
}

function startSweepIfNeeded() {
  if (sweepTimerId !== null) return;
  sweepTimerId = setInterval(() => {
    const now = Date.now();
    for (const [id, timestamp] of recentShortcuts.entries()) {
      if (now - timestamp > SWEEP_INTERVAL_MS) {
        recentShortcuts.delete(id);
      }
    }
    if (recentShortcuts.size === 0 && sweepTimerId !== null) {
      clearInterval(sweepTimerId);
      sweepTimerId = null;
    }
  }, SWEEP_INTERVAL_MS);
}

/**
 * The shell keeps inactive panes mounted but `visibility: hidden`, which neither blurs a focused
 * element inside them nor unmounts the widget that owns it; a hidden editable must not swallow keys.
 */
function isVisible(element: Element): boolean {
  if (typeof element.checkVisibility === "function")
    return element.checkVisibility({ visibilityProperty: true });
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

function isEditable(element: Element): boolean {
  const el = element as HTMLElement;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    !!el.closest(".xterm")
  );
}

function handleKeyDown(event: KeyboardEvent) {
  // An auto-repeat, or a key another handler has already consumed, is not a fresh shortcut press.
  if (event.repeat || event.defaultPrevented) return;

  const target = event.target instanceof Element ? event.target : null;

  // A composite widget that owns the arrow keys keeps them.
  if (event.key.startsWith("Arrow") && target?.closest(ARROW_OWNER)) return;

  const isInputField = target !== null && isEditable(target) && isVisible(target);

  for (const registration of registry.values()) {
    const { shortcut, handler, isActive, skipInInputs, id, debounce = true } = registration;

    // Skip if this shortcut should be excluded in input fields
    if (skipInInputs && isInputField) continue;

    // Check modifier match
    const modifierMatch =
      (shortcut.meta && event.metaKey) ||
      (shortcut.ctrl && event.ctrlKey) ||
      (!shortcut.meta && !shortcut.ctrl && !event.metaKey && !event.ctrlKey);

    const expectedCode = keyToCode(shortcut.key);
    const punctuation = isPunctuationKey(shortcut.key);

    // `event.code` is why the framework matches on code at all: it keeps Alt on Mac from turning the
    // key into a special character. `event.key` is an *additional* way to match, not a fallback for
    // an empty code — a key-only event (jsdom, synthetic dispatch) has no code to compare.
    const keyPressed = punctuation
      ? event.key === shortcut.key || (event.key === "" && event.code === expectedCode)
      : event.code === expectedCode || event.key.toLowerCase() === shortcut.key.toLowerCase();

    const isShortcutPressed =
      modifierMatch &&
      (punctuation || event.shiftKey === shortcut.shift) &&
      event.altKey === shortcut.alt &&
      keyPressed;

    if (!isShortcutPressed) continue;

    // Check if registration is active
    if (!isActive()) continue;

    // Debounce check
    if (debounce) {
      const now = Date.now();
      const lastTrigger = recentShortcuts.get(id) || 0;
      if (now - lastTrigger < DEBOUNCE_MS) continue;

      recentShortcuts.set(id, now);
      startSweepIfNeeded();
    }

    event.preventDefault();
    handler();
  }
}

let listenerInstalled = false;

function installListener() {
  if (listenerInstalled) return;
  window.addEventListener("keydown", handleKeyDown);
  listenerInstalled = true;
}

/**
 * Registers a keyboard shortcut. The window listener is installed lazily on the first registration —
 * this module is reachable from the package entrypoints, so an install at module load would be an
 * import-time side effect that throws wherever `window` is absent.
 */
export function registerShortcut(registration: ShortcutRegistration): void {
  registry.set(registration.id, registration);
  installListener();

  // Dev-only: warn about conflicting shortcut assignments
  if (import.meta.env.DEV) {
    const key = serializeShortcut(registration.shortcut);
    const conflicts = [...registry.values()].filter(
      (r) => r.id !== registration.id && serializeShortcut(r.shortcut) === key,
    );
    if (conflicts.length > 0) {
      console.warn(`[Tendril] Shortcut conflict: "${key}" is registered by multiple widgets:`, [
        registration.id,
        ...conflicts.map((c) => c.id),
      ]);
    }
  }
}

export function unregisterShortcut(id: string): void {
  registry.delete(id);
  recentShortcuts.delete(id);
  if (registry.size === 0) {
    if (sweepTimerId !== null) {
      clearInterval(sweepTimerId);
      sweepTimerId = null;
    }
  }
}

export function getRegisteredShortcuts(): ShortcutInfo[] {
  return [...registry.values()].map((r) => ({
    id: r.id,
    shortcutKey: serializeShortcut(r.shortcut),
    displayKey: r.displayKey,
    description: r.description,
    isActive: r.isActive(),
  }));
}

/** For testing only — resets all internal state and leaves the listener uninstalled */
export function _resetForTesting(): void {
  registry.clear();
  recentShortcuts.clear();
  if (sweepTimerId !== null) {
    clearInterval(sweepTimerId);
    sweepTimerId = null;
  }
  if (listenerInstalled) {
    window.removeEventListener("keydown", handleKeyDown);
    listenerInstalled = false;
  }
}

/** For testing only — returns the current registry size */
export function _getRegistrySize(): number {
  return registry.size;
}

/** For testing only — returns whether the global listener is installed */
export function _isListenerInstalled(): boolean {
  return listenerInstalled;
}
