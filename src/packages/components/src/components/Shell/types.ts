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
  /** An Ivy color name the host assigned (e.g. "Blue"); tints the badge when `kind` is "color". */
  color?: string;
}

/** Whether a section item's task is still running or has finished. */
export type ShellItemState = "working" | "completed";

export interface ShellSectionItemDto {
  id: string;
  title: string;
  tag?: string;
  badges?: ShellBadgeDto[];
  /** Name looked up in `sectionItemIcons`; unknown names render nothing. */
  icon?: string;
  state?: ShellItemState;
  pinned?: boolean;
}

export interface ShellTabDto {
  id: string;
  title: string;
}

export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);

export const modKeyLabel = (): string => (isMac() ? "⌘" : "Ctrl");

/** True when the keydown's modifier matches the platform's command key. */
export const isModKey = (e: KeyboardEvent): boolean => (isMac() ? e.metaKey : e.ctrlKey);

export const isEditableTarget = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return (
    t.isContentEditable ||
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    !!t.closest(".xterm")
  );
};
