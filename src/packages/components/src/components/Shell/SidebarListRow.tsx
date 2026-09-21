/**
 * V1 `Helpers/SidebarListRow.cs`, now shared rather than owned here.
 *
 * The markup moved to `components/SidebarListRow/` because the Shell was only one of three places
 * drawing it: the Settings nested sidebar and `InboxView`'s category rail had each reimplemented the
 * same three row shapes, and the copies had drifted apart. This module stays as the Shell's own
 * import path so `Shell/index.ts` and everything importing through it keep working.
 */
export {
  SidebarListRow,
  SidebarListRowExpandable,
  SidebarListRowSubItem,
} from "../SidebarListRow/index.ts";
export type {
  SidebarListRowIcon,
  SidebarListRowProps,
  SidebarListRowExpandableProps,
  SidebarListRowSubItemProps,
} from "../SidebarListRow/index.ts";
