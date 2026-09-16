import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ivyColorVar } from "@ivy-interactive/components";
import { Badge } from "@ivy-interactive/components/ui";

/**
 * V1's `Helpers/SidebarListRow.cs`, the three row shapes `SettingsApp.Build` composes its nested
 * sidebar out of: `Build` (icon + label + optional count badge), `BuildExpandable` (the same plus a
 * chevron) and `BuildSubItem` (a 1rem indent, then an icon or a colour marker, then the label).
 *
 * There is still no shared V2 component for these. `InboxView` reimplemented all three locally and
 * this module is a second copy of that same markup, deliberately kept in one small file so that
 * swapping to the shared component being extracted right now is a one-file change here.
 *
 * Every row is `BuildButton`: full width, `Secondary` while selected and `Ghost` otherwise.
 */

type IconComponent = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** `BuildButton`'s two variants, as the token pair `Secondary`/`Ghost` resolve to. */
const rowTone = (selected: boolean): string =>
  selected
    ? "bg-secondary text-secondary-foreground"
    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground";

const ROW_BASE =
  "flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-xs transition-colors";

/** `SidebarListRow.Build(string, Icons, Action, bool, int?)`. */
export const SidebarRow: React.FC<{
  icon: IconComponent;
  label: string;
  count?: number;
  selected?: boolean;
  onClick: () => void;
  testId?: string;
}> = ({ icon: IconCmp, label, count, selected = false, onClick, testId }) => (
  <button
    type="button"
    role="tab"
    aria-selected={selected}
    data-testid={testId}
    onClick={onClick}
    className={`${ROW_BASE} ${rowTone(selected)}`}
  >
    <IconCmp className="size-4 shrink-0" aria-hidden />
    <span className="truncate">{label}</span>
    {/* `count is > 0`: a zero count is suppressed rather than shown as an empty badge. */}
    {count !== undefined && count > 0 && (
      <Badge variant="secondary" density="Small" className="ml-auto">
        {count}
      </Badge>
    )}
  </button>
);

/** `SidebarListRow.BuildExpandable`: icon, label, spacer, then a chevron for the open state. */
export const SidebarExpandableRow: React.FC<{
  icon: IconComponent;
  label: string;
  expanded: boolean;
  selected?: boolean;
  onClick: () => void;
  testId?: string;
}> = ({ icon: IconCmp, label, expanded, selected = false, onClick, testId }) => (
  <button
    type="button"
    aria-expanded={expanded}
    aria-selected={selected}
    role="tab"
    data-testid={testId}
    onClick={onClick}
    className={`${ROW_BASE} ${rowTone(selected)}`}
  >
    <IconCmp className="size-4 shrink-0" aria-hidden />
    <span className="truncate">{label}</span>
    {expanded ? (
      <ChevronDown className="ml-auto size-3 shrink-0" aria-hidden />
    ) : (
      <ChevronRight className="ml-auto size-3 shrink-0" aria-hidden />
    )}
  </button>
);

/**
 * `SidebarListRow.BuildSubItem`: a 1rem indent, then either an icon or a small colour box, then the
 * label.
 *
 * The colour box is V1's, literally: `new Box().Background(color).BorderRadius(BorderRadius.Rounded)
 * .Width(Size.Units(3)).Height(Size.Units(3))` — a 0.75rem square with Ivy's `Rounded` radius, which
 * `styles.ts` resolves to 0.5rem, so it reads as a dot without being a circle. `Size.Units(3)` and
 * that radius are why this is `size-3 rounded-[0.5rem]` rather than `size-2 rounded-full`.
 *
 * `color` is an Ivy `Colors` name, resolved through the package's `ivyColorVar` — the same resolver
 * `Badge` and `TuiBadge` use, so there is exactly one name-to-token mapping in the codebase.
 *
 * A row with neither an icon nor a colour keeps the old neutral marker: `SettingsApp` also builds
 * sub-items that are not projects, and they have no colour to show.
 */
export const SidebarSubItem: React.FC<{
  label: string;
  icon?: IconComponent;
  /** An Ivy `Colors` name, e.g. the project's configured colour. */
  color?: string;
  selected?: boolean;
  onClick: () => void;
  testId?: string;
}> = ({ label, icon: IconCmp, color, selected = false, onClick, testId }) => (
  <button
    type="button"
    role="tab"
    aria-selected={selected}
    data-testid={testId}
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-field py-1.5 pr-2 pl-4 text-left text-xs transition-colors ${rowTone(
      selected,
    )}`}
  >
    {IconCmp ? (
      <IconCmp className="size-4 shrink-0" aria-hidden />
    ) : color ? (
      <span
        aria-hidden
        data-testid={testId ? `${testId}-dot` : undefined}
        data-color={color}
        className="size-3 shrink-0 rounded-[0.5rem]"
        style={{ backgroundColor: ivyColorVar(color) }}
      />
    ) : (
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${selected ? "bg-primary" : "bg-muted-foreground/50"}`}
      />
    )}
    <span className="truncate">{label}</span>
  </button>
);
