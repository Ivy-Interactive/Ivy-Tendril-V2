import React from "react";
import {
  SidebarListRow,
  SidebarListRowExpandable,
  SidebarListRowSubItem,
  type SidebarListRowIcon,
} from "@ivy-interactive/components/ui";

/**
 * V1's `Helpers/SidebarListRow.cs`, the three row shapes `SettingsApp.Build` composes its nested
 * sidebar out of: `Build` (icon + label + optional count badge), `BuildExpandable` (the same plus a
 * chevron) and `BuildSubItem` (a 1rem indent, then an icon or a colour marker, then the label).
 *
 * The markup itself now lives in the package (`components/SidebarListRow/`), shared with the Shell
 * and with `InboxView`'s category rail - the three had been separate copies of the same rows. What
 * stays here is the naming: `SettingsView` composes `SidebarRow`/`SidebarExpandableRow`/
 * `SidebarSubItem`, and every row in that rail is a tab in its `role="tablist"`, so these wrappers
 * fix `role="tab"` rather than making each of its ~8 call sites repeat it.
 */

type IconComponent = SidebarListRowIcon;

/** `SidebarListRow.Build(string, Icons, Action, bool, int?)`. */
export const SidebarRow: React.FC<{
  icon: IconComponent;
  label: string;
  count?: number;
  selected?: boolean;
  onClick: () => void;
  testId?: string;
}> = ({ icon, label, count, selected = false, onClick, testId }) => (
  <SidebarListRow
    icon={icon}
    label={label}
    count={count}
    selected={selected}
    onClick={onClick}
    role="tab"
    testId={testId}
  />
);

/** `SidebarListRow.BuildExpandable`: icon, label, spacer, then a chevron for the open state. */
export const SidebarExpandableRow: React.FC<{
  icon: IconComponent;
  label: string;
  expanded: boolean;
  selected?: boolean;
  onClick: () => void;
  testId?: string;
}> = ({ icon, label, expanded, selected = false, onClick, testId }) => (
  <SidebarListRowExpandable
    icon={icon}
    label={label}
    expanded={expanded}
    selected={selected}
    onClick={onClick}
    role="tab"
    testId={testId}
  />
);

/**
 * `SidebarListRow.BuildSubItem`: a 1rem indent, then either an icon or a small colour box, then the
 * label. The box is V1's `new Box().Background(color).BorderRadius(BorderRadius.Rounded)
 * .Width(Size.Units(3)).Height(Size.Units(3))`, resolved through the package's `ivyColorVar`; see
 * the shared component for why that is `size-3 rounded-box` rather than `size-2 rounded-full`.
 *
 * `onClick` stays required here though the shared prop is optional: every sub-item this rail builds
 * navigates, and a static one would be a tab that cannot be selected.
 */
export const SidebarSubItem: React.FC<{
  label: string;
  icon?: IconComponent;
  /** An Ivy `Colors` name, e.g. the project's configured colour. */
  color?: string;
  selected?: boolean;
  onClick: () => void;
  testId?: string;
}> = ({ label, icon, color, selected = false, onClick, testId }) => (
  <SidebarListRowSubItem
    label={label}
    icon={icon}
    color={color}
    selected={selected}
    onClick={onClick}
    role="tab"
    testId={testId}
  />
);
