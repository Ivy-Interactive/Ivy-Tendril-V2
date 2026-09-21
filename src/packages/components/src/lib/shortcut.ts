import React from "react";

/** Detects if the current platform is Mac/iOS */
export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

export interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

/**
 * Parses a shortcut string (e.g., "Ctrl+Shift+K") into its component parts.
 * Handles platform-specific modifier key mappings. `mod` is the platform command key — Command on
 * Mac, Ctrl elsewhere — matching the `mod` support matchesShortcut() has always had; without it a
 * host-supplied `mod+s` would silently degrade to a bare `S`.
 */
export const parseShortcut = (shortcutStr?: string): ParsedShortcut | null => {
  if (!shortcutStr) return null;
  const parts = shortcutStr.toLowerCase().split("+");
  return {
    ctrl: !isMac() && (parts.includes("ctrl") || parts.includes("mod")),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    meta: isMac()
      ? parts.includes("ctrl") ||
        parts.includes("meta") ||
        parts.includes("cmd") ||
        parts.includes("command") ||
        parts.includes("mod")
      : false,
    key: parts[parts.length - 1],
  };
};

/**
 * True when a shortcut key is a single punctuation character, e.g. `/` or `?`.
 *
 * Punctuation is matched on `event.key`, not `event.code`, and without the strict shift equality test
 * every other key gets: `?` is Shift+Slash, so the shift is what *produces* the character while
 * parseShortcut("?") reports `shift: false`. Matching on `key` also keeps `/` and `?` distinct, which
 * their shared `Slash` code cannot.
 */
export const isPunctuationKey = (key: string): boolean =>
  key.length === 1 && !/[a-z0-9]/i.test(key);

/**
 * Maps a key name to a KeyboardEvent.code value.
 * Uses event.code for matching so modifiers like Alt don't produce special characters on Mac.
 */
export const keyToCode = (key: string): string => {
  const k = key.toLowerCase();
  // Single letter keys: a-z → KeyA-KeyZ
  if (k.length === 1 && k >= "a" && k <= "z") {
    return `Key${k.toUpperCase()}`;
  }
  // Single digit keys: 0-9 → Digit0-Digit9
  if (k.length === 1 && k >= "0" && k <= "9") {
    return `Digit${k}`;
  }
  // Special keys
  const specialKeys: Record<string, string> = {
    enter: "Enter",
    return: "Enter",
    delete: "Delete",
    backspace: "Backspace",
    space: "Space",
    " ": "Space",
    tab: "Tab",
    escape: "Escape",
    esc: "Escape",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    insert: "Insert",
    // Punctuation. The browser reports event.code === "Slash" for both "/" and "?", so without these
    // a code-matched "/" never fires. See isPunctuationKey() for how the two are told apart.
    "/": "Slash",
    "?": "Slash",
    ",": "Comma",
    ".": "Period",
    ";": "Semicolon",
    "'": "Quote",
    "[": "BracketLeft",
    "]": "BracketRight",
    "\\": "Backslash",
    "-": "Minus",
    "=": "Equal",
    "`": "Backquote",
  };
  // F-keys: f1-f12
  const fKeyMatch = k.match(/^f(\d{1,2})$/);
  if (fKeyMatch) {
    return `F${fKeyMatch[1]}`;
  }
  return specialKeys[k] ?? key;
};

/**
 * Formats a shortcut string for display as React nodes.
 * Converts modifier keys to platform-appropriate symbols (e.g., ⌘ on Mac).
 */
export const formatShortcutForDisplay = (shortcutStr?: string): React.ReactNode[] => {
  if (!shortcutStr) return [];
  const parts = shortcutStr.split("+").map((p) => p.trim());
  const result: React.ReactNode[] = [];

  const keySymbols: Record<string, string> = {
    backspace: "⌫",
    delete: "⌦",
    enter: "↵",
    return: "↵",
    escape: "Esc",
    tab: "⇥",
    space: "␣",
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    ...(isMac() ? { shift: "⇧", alt: "⌥", option: "⌥" } : {}),
  };

  parts.forEach((part, index) => {
    if (index > 0) {
      result.push("+");
    }

    const symbol = keySymbols[part.toLowerCase()];
    if (symbol) {
      result.push(symbol);
    } else if (
      isMac() &&
      (part.toLowerCase() === "ctrl" ||
        part.toLowerCase() === "cmd" ||
        part.toLowerCase() === "command" ||
        part.toLowerCase() === "meta")
    ) {
      result.push(
        React.createElement(
          "span",
          {
            key: `meta-${index}`,
            className: "inline-flex items-center justify-center",
          },
          "⌘",
        ),
      );
    } else if (!isMac() && part.toLowerCase() === "ctrl") {
      result.push("Ctrl");
    } else {
      result.push(part.charAt(0).toUpperCase() + part.slice(1));
    }
  });

  return result;
};

export const formatShortcut = formatShortcutForDisplay;
export const getPlatformShortcut = (shortcut: string): string => {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return shortcut;
  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push(isMac() ? "⌘" : "Ctrl");
  if (parsed.alt) parts.push(isMac() ? "⌥" : "Alt");
  if (parsed.shift) parts.push(isMac() ? "⇧" : "Shift");
  if (parsed.key) parts.push(parsed.key.toUpperCase());
  return parts.join("+");
};
