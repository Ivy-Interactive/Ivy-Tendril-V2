import { cn } from "@/lib/utils";
import { formatShortcut as formatShortcutWithPlatform } from "@/components/ui/TuiKbd";
import type React from "react";

/** `TuiKbd`'s platform-aware key formatting (same ⌘/⌥/⇧/↵/⌫ mapping), single-string call shape. */
const formatShortcut = (value: string): string => formatShortcutWithPlatform(value, true);

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
