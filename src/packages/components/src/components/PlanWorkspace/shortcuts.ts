import { useEffect, useId, useRef } from "react";
import type { RefObject } from "react";
import { isMac } from "../Shell/types";
import { parseShortcut } from "../../lib/shortcut";
import {
  registerShortcut,
  serializeShortcut,
  unregisterShortcut,
} from "../../lib/shortcutRegistry";

const NAMED_KEYS: Record<string, string> = {
  backspace: "⌫",
  escape: "Esc",
  enter: "↵",
  delete: "Del",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
};

const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  meta: "⌘",
  cmd: "⌘",
  alt: isMac() ? "⌥" : "Alt",
  option: "⌥",
  shift: "⇧",
};

const parts = (shortcut: string): string[] =>
  shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

/** The keys a tooltip or button badge shows for a shortcut, e.g. `["⌘", "K"]` or `["⌫"]`. */
export const shortcutKeys = (shortcut: string): string[] => {
  const keys = parts(shortcut);
  if (keys.length === 0) return [];
  const key = keys[keys.length - 1];
  const modifiers = keys.slice(0, -1).map((modifier) => {
    const lower = modifier.toLowerCase();
    if (lower === "mod") return isMac() ? "⌘" : "Ctrl";
    return MODIFIER_LABELS[lower] ?? modifier;
  });
  const keyLabel = key.length === 1 ? key.toUpperCase() : (NAMED_KEYS[key.toLowerCase()] ?? key);
  return [...modifiers, keyLabel];
};

/** True when the keydown is the shortcut: same key, exactly the wanted modifiers (shift is free for letters). */
export const matchesShortcut = (e: KeyboardEvent, shortcut: string): boolean => {
  const keys = parts(shortcut);
  if (keys.length === 0) return false;
  const key = keys[keys.length - 1];
  const modifiers = keys.slice(0, -1).map((modifier) => modifier.toLowerCase());
  const mac = isMac();
  const wantCtrl =
    modifiers.includes("ctrl") ||
    modifiers.includes("control") ||
    (modifiers.includes("mod") && !mac);
  const wantMeta =
    modifiers.includes("meta") || modifiers.includes("cmd") || (modifiers.includes("mod") && mac);
  const wantAlt = modifiers.includes("alt") || modifiers.includes("option");
  const wantShift = modifiers.includes("shift");
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta || e.altKey !== wantAlt) return false;
  if (key.length === 1) {
    if (wantShift && !e.shiftKey) return false;
    return e.key.toLowerCase() === key.toLowerCase();
  }
  if (e.shiftKey !== wantShift) return false;
  return e.key.toLowerCase() === key.toLowerCase();
};

export interface ShortcutBinding {
  tag: string;
  shortcut?: string;
  disabled?: boolean;
  /** Action label, used as the shortcut's description in the generated help panel. */
  label?: string;
}

/** A modal layer owned by the host (an Ivy dialog or sheet) takes the keyboard; page shortcuts stay quiet under it. */
const hostModalOpen = (): boolean =>
  !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  );

/**
 * The shell keeps inactive panes mounted but `visibility: hidden`, which neither blurs a focused
 * element inside them nor unmounts this widget; a hidden page must not answer keys.
 */
const isVisible = (element: Element): boolean => {
  if (typeof element.checkVisibility === "function")
    return element.checkVisibility({ visibilityProperty: true });
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
};

/**
 * Registers every action's shortcut with the package's central shortcut registry, so this widget's
 * keys are enumerable through `getRegisteredShortcuts()` and share the one window listener instead of
 * running a `keydown` handler of their own.
 *
 * The gating this widget needs and the registry does not have generically — a host modal is open, or
 * the pane is `visibility: hidden` — becomes each registration's `isActive()`. The rest (`e.repeat`,
 * `e.defaultPrevented`, editable targets, the arrow-key escape for composite widgets) is the
 * registry's own, applied to every consumer.
 *
 * Two things the registry does not do for us, both of which V1's own `keydown` handler did:
 *
 * - **The id has to name the instance, not just the tag.** The registry is a module-level `Map`, so
 *   two mounted workspaces registering `planWorkspace:Execute` are one entry: the second overwrites
 *   the first, and the first's cleanup then unregisters the second's. `useId` scopes the id to this
 *   hook instance so both survive and both fire, which is what two mounted `document` listeners did
 *   in V1.
 * - **One key fires one action.** The registry runs *every* matching registration; V1 used
 *   `bindings.find(...)`, so the first binding carrying a key was the only one that answered it. A
 *   later binding repeating a key is therefore dropped here rather than registered, which also keeps
 *   the dev-mode conflict warning for genuine cross-widget clashes meaningful.
 */
export const useActionShortcuts = (
  bindings: ShortcutBinding[],
  fire: (tag: string) => void,
  enabled: boolean,
  rootRef?: RefObject<HTMLElement | null>,
) => {
  const fireRef = useRef(fire);
  fireRef.current = fire;
  const instance = useId();

  useEffect(() => {
    if (!enabled) return;

    const isActive = () => {
      if (hostModalOpen()) return false;
      const root = rootRef?.current;
      return !(root && !isVisible(root));
    };

    const ids: string[] = [];
    const claimed = new Set<string>();
    for (const binding of bindings) {
      if (!binding.shortcut || binding.disabled) continue;
      const shortcut = parseShortcut(binding.shortcut);
      if (!shortcut) continue;
      const key = serializeShortcut(shortcut);
      if (claimed.has(key)) continue;
      claimed.add(key);
      const id = `planWorkspace${instance}:${binding.tag}`;
      const tag = binding.tag;
      registerShortcut({
        id,
        shortcut,
        handler: () => fireRef.current(tag),
        description: binding.label ?? binding.tag,
        isActive,
        skipInInputs: true,
        displayKey: binding.shortcut,
      });
      ids.push(id);
    }

    return () => ids.forEach(unregisterShortcut);
  }, [bindings, enabled, rootRef, instance]);
};
