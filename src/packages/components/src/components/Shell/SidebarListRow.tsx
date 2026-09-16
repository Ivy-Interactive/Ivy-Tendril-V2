import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "../ui/badge";

/**
 * V1 `Helpers/SidebarListRow.cs` in three forms, shared rather than reimplemented per view.
 *
 * V1 builds each row as a full-width `Button`, `Secondary` while selected and `Ghost` otherwise.
 * Rounding follows V1's own rule: the plain overloads sit inside a `List` widget, between its
 * straight separator lines, so they stay square; the icon overload lives in gap-spaced menus and
 * keeps its rounding.
 *
 * Every consumer of a sidebar list of rows uses these: `InboxView`'s source list, and the nested
 * Settings sidebar (`Apps/Settings/SettingsApp.cs`), which is a list of `Build` rows one of which
 * (`Projects`) is a `BuildExpandable` over `BuildSubItem` children.
 */

/** A lucide icon, or anything else taking the same two props. */
export type SidebarListRowIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean;
}>;

const ROW_BASE = "flex w-full items-center gap-2 py-1.5 text-left text-xs transition-colors";
const ROW_SELECTED = "bg-secondary text-secondary-foreground";
const ROW_IDLE = "text-muted-foreground hover:bg-accent hover:text-accent-foreground";

/** Horizontal padding is per variant so a sub-item's 1rem indent never has to beat `px-2`. */
const rowClass = (selected: boolean, rounded: boolean, padding: string, extra?: string): string =>
  [
    ROW_BASE,
    padding,
    rounded ? "rounded-field" : "rounded-none",
    selected ? ROW_SELECTED : ROW_IDLE,
    extra,
  ]
    .filter(Boolean)
    .join(" ");

export interface SidebarListRowProps {
  label: string;
  /** V1's icon overload; its presence is also what makes the row rounded rather than square. */
  icon?: SidebarListRowIcon;
  /** V1 suppresses the count badge unless it is greater than zero. */
  count?: number;
  selected?: boolean;
  onClick?: () => void;
  /** V1's `Build(title, content, ...)` overload: a second line under the label. */
  detail?: React.ReactNode;
  /** Set by lists that are a tab set (`InboxView`'s sources) so the row reads as one. */
  role?: "tab" | "option" | "menuitem";
  disabled?: boolean;
  testId?: string;
  className?: string;
}

/** V1 `SidebarListRow.Build`. */
export const SidebarListRow: React.FC<SidebarListRowProps> = ({
  label,
  icon: Icon,
  count,
  selected = false,
  onClick,
  detail,
  role,
  disabled = false,
  testId,
  className,
}) => {
  const body = (
    <>
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      {detail === undefined ? (
        <span className="truncate">{label}</span>
      ) : (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{label}</span>
          <span className="truncate text-muted-foreground">{detail}</span>
        </span>
      )}
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" density="Small" className="ml-auto">
          {count}
        </Badge>
      )}
    </>
  );

  return (
    <button
      type="button"
      role={role}
      aria-selected={role ? selected : undefined}
      data-selected={selected}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={rowClass(selected, !!Icon, "px-2", className)}
    >
      {body}
    </button>
  );
};

export interface SidebarListRowExpandableProps {
  label: string;
  icon: SidebarListRowIcon;
  expanded: boolean;
  selected?: boolean;
  onClick: () => void;
  testId?: string;
  className?: string;
}

/** V1 `SidebarListRow.BuildExpandable`: icon, label, spacer, then a chevron for the open state. */
export const SidebarListRowExpandable: React.FC<SidebarListRowExpandableProps> = ({
  label,
  icon: Icon,
  expanded,
  selected = false,
  onClick,
  testId,
  className,
}) => (
  <button
    type="button"
    aria-expanded={expanded}
    data-selected={selected}
    data-testid={testId}
    onClick={onClick}
    className={rowClass(selected, true, "px-2", className)}
  >
    <Icon className="size-4 shrink-0" aria-hidden />
    <span className="truncate">{label}</span>
    {expanded ? (
      <ChevronDown className="ml-auto size-3 shrink-0" aria-hidden />
    ) : (
      <ChevronRight className="ml-auto size-3 shrink-0" aria-hidden />
    )}
  </button>
);

export interface SidebarListRowSubItemProps {
  label: string;
  /** V1 renders either the icon or, with none, a small colour box as the marker. */
  icon?: SidebarListRowIcon;
  selected?: boolean;
  /** Without a handler the sub-item is static text, as V1's non-navigating rows are. */
  onClick?: () => void;
  role?: "tab" | "option" | "menuitem";
  testId?: string;
  className?: string;
}

/**
 * V1 `SidebarListRow.BuildSubItem`: a 1rem indent, then either an icon or a small marker box, then
 * the label. V1 colours the box per project (`config.GetProjectColor`); nothing in V2 carries a
 * project colour yet, so the marker stays a semantic token rather than an invented palette.
 */
export const SidebarListRowSubItem: React.FC<SidebarListRowSubItemProps> = ({
  label,
  icon: Icon,
  selected = false,
  onClick,
  role,
  testId,
  className,
}) => {
  const shared = rowClass(selected, true, "pl-4 pr-2", className);

  const marker = Icon ? (
    <Icon className="size-4 shrink-0" aria-hidden />
  ) : (
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-full ${selected ? "bg-primary" : "bg-muted-foreground/50"}`}
    />
  );

  if (!onClick) {
    return (
      <span className={`${shared} cursor-default`} data-testid={testId}>
        {marker}
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      role={role}
      aria-selected={role ? selected : undefined}
      data-selected={selected}
      data-testid={testId}
      onClick={onClick}
      className={shared}
    >
      {marker}
      <span className="truncate">{label}</span>
    </button>
  );
};
