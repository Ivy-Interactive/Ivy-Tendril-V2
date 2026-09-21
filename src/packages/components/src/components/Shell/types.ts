import { isMac } from "../../lib/shortcut";

export type IvyEventHandler = (eventName: string, widgetId: string, args: unknown[]) => void;

export interface ShellWidgetProps {
  id: string;
  events?: string[];
  eventHandler: IvyEventHandler;
}

export interface ShellNavItemDto {
  id: string;
  label: string;
  icon?: string;
  badge?: string;
  isActive?: boolean;
}

export interface ShellBadgeDto {
  label: string;
  kind: "project" | "success" | "warning" | "neutral" | "color";
  /** An Ivy color name the host assigned (e.g. "Purple"); it recolors the badge and takes precedence over `kind`. */
  color?: string;
}

export type ShellItemState = "working" | "completed";

export interface ShellSectionItemDto {
  id: string;
  title: string;
  tag?: string;
  badges?: ShellBadgeDto[];
  /** A lucide icon name (see ShellSidebarSection's icon map), rendered left of the title. */
  icon?: string;
  /** A small icon left of the title telling the row's state, e.g. a chat still being answered. */
  state?: ShellItemState;
  pinned?: boolean;
}

export interface ShellTabDto {
  id: string;
  title: string;
  /** The page tab cannot be closed: it is how the user gets back to the page behind the sessions. */
  closable?: boolean;
  /** Lucide icon name; defaults to the terminal glyph used by session tabs. */
  icon?: string;
}

export { isMac };

export const modKeyLabel = (): string => (isMac() ? "⌘" : "Ctrl");

/** The platform spelling of a Cmd+Opt / Ctrl+Alt chord, for a key hint. */
export const modAltKeys = (key: string): string[] =>
  isMac() ? ["⌘", "⌥", key] : ["Ctrl", "Alt", key];

/** The letter the agent row's "new chat" chord uses. */
export const NEW_CHAT_SHORTCUT_KEY = "A";

/** True when the keydown's modifier matches the platform's command key. */
export const isModKey = (e: KeyboardEvent): boolean => (isMac() ? e.metaKey : e.ctrlKey);

export const isEditableTarget = (e: KeyboardEvent): boolean => {
  // Not `as HTMLElement | null`: that cast was a lie the `!t` guard could not catch. A keydown
  // dispatched at `window` or `document` has a non-null target with no `closest`, so the last
  // clause threw a TypeError out of every shell chord handler that consults this.
  const t = e.target;
  if (!(t instanceof Element)) return false;
  return (
    (t as HTMLElement).isContentEditable === true ||
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    !!t.closest(".xterm")
  );
};
