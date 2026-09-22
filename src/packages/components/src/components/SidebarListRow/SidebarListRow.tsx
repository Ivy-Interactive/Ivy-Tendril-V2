import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "../ui/badge";
import { ivyColorVar } from "@/lib/ivy-color";

/**
 * V1 `Helpers/SidebarListRow.cs` in three forms, as one shared component rather than one copy per
 * sidebar.
 *
 * V1 builds every row through the private `BuildButton`: full width, `Secondary` while selected and
 * `Ghost` otherwise. Rounding follows V1's own rule - the plain overloads sit inside a `List` widget
 * between its straight separator lines and stay square, while the icon overload lives in gap-spaced
 * menus and keeps its rounding.
 *
 * Two V2 sidebars had reimplemented this markup independently - the Settings nested sidebar
 * (`Apps/Settings/SettingsApp.cs`) and `InboxView`'s category rail - and had already drifted, so this
 * is the union of the two, and both are now thin delegations to it. The Shell's own primary sidebar
 * renders its own `.tsh-nav-item`/`.tsh-rail-item`/`.tsh-section-item` markup rather than this
 * component; `Shell/SidebarListRow.tsx` only re-exports it so `Shell/index.ts` keeps working. It
 * lives outside `Shell/` because its two real consumers are app views, not shell chrome.
 */

/** A lucide icon, or anything else taking the same two props. */
export type SidebarListRowIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean;
}>;

const ROW_BASE = "flex w-full items-center gap-2 py-1.5 text-left text-sm transition-colors";

/**
 * What makes a row read as a control. Applied only on the branches that render a `<button>`, never
 * on the static sub-item -- `cursor-pointer` and `cursor-default` are the same specificity and
 * Tailwind emits `.cursor-pointer` *after* `.cursor-default` in its utility order, so a base-level
 * `cursor-pointer` would silently win over the static row's own `cursor-default`.
 *
 * `cursor-pointer` has to be stated because nothing grants it any more: Tailwind v3's preflight
 * shipped `button, [role="button"] { cursor: pointer }` and v4 -- 4.1.16 here -- dropped that rule,
 * so every `<button>` in this repo gets the default `cursor: auto` unless its own classes say
 * otherwise. `buttonVariant` in `ui/button/variant.ts` compensates explicitly; these rows never did,
 * which is why a Settings sidebar row reads as inert text under the pointer.
 *
 * The focus ring is the same omission seen from the keyboard: the rows are real `<button>`s and were
 * always reachable by Tab, but with no ring nothing showed where focus was. `ring-inset` because a
 * rail row spans the full sidebar width, so an outset ring would be clipped by the container edge.
 */
const ROW_INTERACTIVE =
  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const ROW_SELECTED = "bg-secondary text-secondary-foreground";
const ROW_IDLE = "text-foreground";

/**
 * The hover fill is `bg-secondary/60`, where it used to be `bg-accent`. `--accent` is `#f8f8f8` on a
 * `#ffffff` rail and `#1a1a1a` on `#0a0a0a`, i.e. 1.06:1 and 1.14:1 against the surface behind it --
 * a fill that exists in the compiled CSS and is not visible on a screen. `--secondary` is the token
 * the *selected* row already uses, so hovering previews the selected state at 60%: 1.14:1 light and
 * 1.15:1 dark. Still quiet, but on the same ramp as selection rather than a neutral nobody can see,
 * and far enough below the solid `bg-secondary` that hovered and selected never read as one state.
 *
 * Gated on `interactive`, so the handler-less sub-item does not light up under a pointer it will not
 * respond to -- a false affordance is the same bug as a missing one. It was previously ungated and
 * got away with it only because `bg-accent` was invisible. `disabled:hover:bg-transparent` is the
 * same rule for the other inert case: `SidebarListRow` takes a `disabled` prop, and a disabled row
 * that still fills on hover would contradict the `not-allowed` cursor it shows at the same moment.
 * `disabled:text-muted-foreground` is unconditional rather than hover-gated, since a disabled row
 * reads as unavailable whether or not the pointer happens to be over it.
 */
const ROW_HOVER =
  "hover:bg-secondary/60 disabled:hover:bg-transparent disabled:text-muted-foreground";

/**
 * Horizontal padding is per variant so a sub-item's 1rem indent never has to beat `px-2`.
 *
 * `interactive` is false only for the handler-less sub-item, which renders a `<span>`: see
 * {@link ROW_INTERACTIVE} for why that branch must not receive the affordance classes.
 */
const rowClass = (
  selected: boolean,
  rounded: boolean,
  padding: string,
  extra?: string,
  interactive = true,
): string =>
  [
    ROW_BASE,
    interactive ? ROW_INTERACTIVE : null,
    padding,
    rounded ? "rounded-field" : "rounded-none",
    selected ? ROW_SELECTED : ROW_IDLE,
    !selected && interactive ? ROW_HOVER : null,
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
  /** Set by lists that are a tab set (`InboxView`'s sources, the Settings rail) so the row reads as one. */
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
  /** As on {@link SidebarListRowProps}: an expander inside a tablist is itself one of the tabs. */
  role?: "tab" | "option" | "menuitem";
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
  role,
  testId,
  className,
}) => (
  <button
    type="button"
    role={role}
    aria-expanded={expanded}
    aria-selected={role ? selected : undefined}
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
  /** V1 renders either the icon or, with none, a small colour box as the marker - never both. */
  icon?: SidebarListRowIcon;
  /**
   * An Ivy `Colors` name, e.g. a project's configured colour.
   *
   * The box is V1's, literally: `new Box().Background(color).BorderRadius(BorderRadius.Rounded)
   * .Width(Size.Units(3)).Height(Size.Units(3))` - a 0.75rem square at Ivy's `Rounded` radius, which
   * `styles.ts` resolves to 0.5rem, so it reads as a dot without being a circle. That is why this is
   * `size-3 rounded-box` and not `size-2 rounded-full`. The name resolves through the package's
   * `ivyColorVar`, the same resolver `Badge` and `TuiBadge` use, so there is exactly one
   * name-to-token mapping in the codebase.
   */
  color?: string;
  selected?: boolean;
  /** Without a handler the sub-item is static text, as V1's non-navigating rows are. */
  onClick?: () => void;
  role?: "tab" | "option" | "menuitem";
  testId?: string;
  className?: string;
}

/**
 * V1 `SidebarListRow.BuildSubItem`: a 1rem indent, then either an icon or a small colour box, then
 * the label.
 *
 * A row with neither an icon nor a colour keeps a neutral marker: both `SettingsApp` and the inbox
 * rail build sub-items that are not projects, and those have no colour to show.
 */
export const SidebarListRowSubItem: React.FC<SidebarListRowSubItemProps> = ({
  label,
  icon: Icon,
  color,
  selected = false,
  onClick,
  role,
  testId,
  className,
}) => {
  const shared = rowClass(selected, true, "pl-4 pr-2", className, !!onClick);

  const marker = Icon ? (
    <Icon className="size-4 shrink-0" aria-hidden />
  ) : color ? (
    <span
      aria-hidden
      data-testid={testId ? `${testId}-dot` : undefined}
      data-color={color}
      className="size-3 shrink-0 rounded-box"
      style={{ backgroundColor: ivyColorVar(color) }}
    />
  ) : (
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-full ${selected ? "bg-primary" : "bg-muted-foreground/50"}`}
    />
  );

  if (!onClick) {
    // `cursor-default` is explicit rather than left to the default: a `<span>` of text would
    // otherwise show the I-beam, which reads as selectable prose in a rail of controls.
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
