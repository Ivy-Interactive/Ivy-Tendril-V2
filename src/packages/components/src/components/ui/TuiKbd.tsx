import React from "react";
import { isMac } from "../../lib/shortcut";
import "./ui.css";

export type KbdVariant = "bare" | "boxed" | "outline";
export type KbdSize = "sm" | "md" | "lg";

const PLATFORM_SYMBOLS: Record<string, string> = {
  enter: "↵",
  return: "↵",
  backspace: "⌫",
};

const MAC_PLATFORM_SYMBOLS: Record<string, string> = {
  ctrl: "⌘",
  control: "⌘",
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  win: "⌘",
  super: "⌘",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
};

/** Maps a single key name to its platform symbol, or the key itself (uppercased if a single letter). */
const labelForKey = (raw: string): string => {
  const key = raw.trim();
  const lower = key.toLowerCase();
  const symbol = PLATFORM_SYMBOLS[lower] ?? (isMac() ? MAC_PLATFORM_SYMBOLS[lower] : undefined);
  if (symbol) return symbol;
  return key.length === 1 ? key.toUpperCase() : key;
};

export interface TuiKbdProps {
  /** "⌘+K", ["Ctrl", "K"] or a single key. */
  keys: string | string[];
  /** "boxed" draws a key cap (tooltips, toolbars); "bare" is the letters alone; "outline" is a
   * transparent cap with a current-color border, for hints on a colored surface. */
  variant?: KbdVariant;
  /** "sm" (16px, the default) or "md" (20px, for markdown-content kbds). */
  size?: KbdSize;
  /** Maps raw modifier/key names (ctrl, enter, backspace...) to their platform symbol. */
  platform?: boolean;
  className?: string;
}

/** Splits "⌘+K" into its keys; an array passes through unchanged. */
export const splitKeys = (keys: string | string[]): string[] =>
  (Array.isArray(keys) ? keys : keys.split("+")).map((k) => k.trim()).filter(Boolean);

/**
 * One line of shortcut text: single-character keys are glued with thin spaces (⌘⌥N), named
 * keys keep their plus signs (Ctrl+Alt+N).
 */
export const formatShortcut = (keys: string | string[], platform = false): string => {
  const parts = splitKeys(keys).map((key) => (platform ? labelForKey(key) : key));
  if (parts.length === 0) return "";
  return parts.every((k) => k.length === 1) ? parts.join(" ") : parts.join("+");
};

/**
 * The bundle's one keyboard hint. Bare and outline render a span per key, so a caller can space,
 * hide, or gap them individually; boxed renders the formatted line inside a single key cap.
 *
 * Hidden from assistive technology. A shortcut hint is a visual affordance for the control it sits
 * in, not part of that control's name — without this, a button labelled "Execute Plan" carrying an
 * `X` hint announces itself as "Execute Plan X", and every caller has to work around the hint when
 * querying by accessible name. The key is still reachable: the control's own handler is what binds
 * it, and `aria-keyshortcuts` is the attribute for announcing one.
 */
export const TuiKbd: React.FC<TuiKbdProps> = ({
  keys,
  variant = "boxed",
  size = "sm",
  platform = false,
  className = "",
}) => {
  const parts = splitKeys(keys).map((key) => (platform ? labelForKey(key) : key));
  if (parts.length === 0) return null;

  const classes = `tui-kbd tui-kbd--${variant} tui-kbd--${size} ${className}`.trim();

  if (variant === "bare") {
    return (
      <span className={classes} aria-hidden="true">
        {parts.map((key, index) => (
          <span key={`${key}-${index}`}>{key}</span>
        ))}
      </span>
    );
  }

  if (variant === "outline") {
    return (
      <kbd className={classes} aria-hidden="true">
        {parts.map((key, index) => (
          <span key={`${key}-${index}`}>{key}</span>
        ))}
      </kbd>
    );
  }

  return (
    <kbd className={classes} aria-hidden="true">
      {formatShortcut(parts)}
    </kbd>
  );
};
