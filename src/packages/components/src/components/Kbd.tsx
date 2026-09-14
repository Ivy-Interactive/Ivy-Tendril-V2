import { cn } from "@/lib/utils";
import { isMac } from "@/lib/shortcut";
import type React from "react";

const KEY_SYMBOLS: Record<string, string> = {
  enter: "↵",
  return: "↵",
  backspace: "⌫",
  ...(isMac
    ? {
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
      }
    : {}),
};

const labelForKey = (raw: string): string => {
  const key = raw.trim();
  const symbol = KEY_SYMBOLS[key.toLowerCase()];
  if (symbol) return symbol;
  return key.length === 1 ? key.toUpperCase() : key;
};

const formatShortcut = (value: string): string => {
  const keys = value
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(labelForKey);
  if (keys.length === 0) return "";
  const allSingle = keys.every((k) => k.length === 1);
  return allSingle ? keys.join("\u2009") : keys.join("+");
};

const keyCapBase =
  "box-border inline-flex h-4 min-w-4 items-center justify-center rounded-[0.25rem] px-1 text-[10px] leading-[0.5]";

const keyCapColor = ({ inherit, ghost }: { inherit?: boolean; ghost?: boolean }) => {
  if (ghost) return "border-0 bg-transparent text-current";
  return inherit
    ? "border border-current/30 bg-transparent text-current"
    : "border border-border bg-muted/40 text-foreground";
};

export interface KbdProps {
  children?: React.ReactNode;
  keys?: string;
  ghost?: boolean;
}

export function Kbd({ children, keys, ghost }: KbdProps) {
  const shortcut = keys ?? (typeof children === "string" ? children : undefined);

  if (shortcut && shortcut.trim().length > 0) {
    return (
      <span className="inline-flex items-center align-middle">
        <kbd className={cn(keyCapBase, keyCapColor({ ghost }))}>{formatShortcut(shortcut)}</kbd>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center align-middle">
      <kbd className={cn(keyCapBase, keyCapColor({ ghost }))}>{children}</kbd>
    </span>
  );
}

export interface ShortcutKeysProps {
  shortcut: string;
  className?: string;
  inherit?: boolean;
  ghost?: boolean;
}

export function ShortcutKeys({ shortcut, className, inherit, ghost }: ShortcutKeysProps) {
  const text = formatShortcut(shortcut);
  if (text.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center align-middle", className)}>
      <kbd className={cn(keyCapBase, keyCapColor({ inherit, ghost }))}>{text}</kbd>
    </span>
  );
}

export default Kbd;
