import React from "react";
import "./ui.css";

export type KbdVariant = "bare" | "boxed";

export interface TuiKbdProps {
  /** "⌘+K", ["Ctrl", "K"] or a single key. */
  keys: string | string[];
  /** "boxed" draws a key cap (tooltips, toolbars); "bare" is the letters alone. */
  variant?: KbdVariant;
  className?: string;
}

/** Splits "⌘+K" into its keys; an array passes through unchanged. */
export const splitKeys = (keys: string | string[]): string[] =>
  (Array.isArray(keys) ? keys : keys.split("+")).map((k) => k.trim()).filter(Boolean);

/**
 * One line of shortcut text: single-character keys are glued with thin spaces (⌘⌥N), named
 * keys keep their plus signs (Ctrl+Alt+N).
 */
export const formatShortcut = (keys: string | string[]): string => {
  const parts = splitKeys(keys);
  if (parts.length === 0) return "";
  return parts.every((k) => k.length === 1) ? parts.join(" ") : parts.join("+");
};

/**
 * The bundle's one keyboard hint. Bare renders a span per key so a caller can space or hide
 * them; boxed renders the formatted line inside a single key cap.
 *
 * Hidden from assistive technology. A shortcut hint is a visual affordance for the control it sits
 * in, not part of that control's name — without this, a button labelled "Execute Plan" carrying an
 * `X` hint announces itself as "Execute Plan X", and every caller has to work around the hint when
 * querying by accessible name. The key is still reachable: the control's own handler is what binds
 * it, and `aria-keyshortcuts` is the attribute for announcing one.
 */
export const TuiKbd: React.FC<TuiKbdProps> = ({ keys, variant = "boxed", className = "" }) => {
  const parts = splitKeys(keys);
  if (parts.length === 0) return null;

  const classes = `tui-kbd tui-kbd--${variant} ${className}`.trim();

  if (variant === "bare") {
    return (
      <span className={classes} aria-hidden="true">
        {parts.map((key, index) => (
          <span key={`${key}-${index}`}>{key}</span>
        ))}
      </span>
    );
  }

  return (
    <kbd className={classes} aria-hidden="true">
      {formatShortcut(parts)}
    </kbd>
  );
};
