import { useEffect, useSyncExternalStore } from "react";
import type { ShellSectionItemDto } from "@ivy-interactive/components/tendril";

/**
 * The contextual list an app shows in the shell sidebar (plans for Review/Plans, recommendations,
 * chats, ...). Mirrors V1 `AppShell/ShellSidebarListSignal.cs`'s `ShellSidebarListState` field for
 * field: the active app publishes this on every render, the shell renders it, and a row click is
 * routed back as a normal navigation to {@link ShellSidebarList.appId} carrying
 * {@link ShellSidebarList.buildSelectArgs}' result.
 *
 * Five apps publish here and render no list of their own, matching V1's `SidebarSectionAppIds`:
 * `review`, `plans`, `drafts`, `recommendations`, `chat`.
 */
export interface ShellSidebarList {
  /** `"review" | "plans" | "drafts" | "recommendations" | "chat"`. */
  appId: string;
  title: string;
  items: ShellSectionItemDto[];
  selectedId: string | null;
  /** A click becomes a navigation to `appId` with these args. */
  buildSelectArgs: (id: string) => unknown;
  /** Defaults to true, as V1's `Searchable = true` does. */
  searchable?: boolean;
  /**
   * What the section's search icon does for this list; absent means the plan search dialog, which
   * is right for every plan list and wrong for anything else (V1's `OnSearch` doc comment).
   */
  onSearch?: () => void;
  /** The search icon's tooltip, e.g. "Search chats"; absent reads {@link DEFAULT_SEARCH_LABEL}. */
  searchLabel?: string;
  onNew?: () => void;
  newLabel?: string;
  /**
   * Folds the collapsed rail's list into one flyout button, instead of the narrow ID chips a plan
   * list shows there (V1's `CollapsedMenu`).
   */
  collapsedMenu?: boolean;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string) => void;
}

/** V1's `ShellSidebarSection` default search tooltip, and the label a list without one reads. */
export const DEFAULT_SEARCH_LABEL = "Search plans";

/** V1 `TendrilAppShell.SidebarSectionAppIds`: the apps whose list lives in the shell, not the page. */
export const SIDEBAR_SECTION_APP_IDS = [
  "review",
  "plans",
  "drafts",
  "recommendations",
  "chat",
] as const;

const sectionAppIds = new Set<string>(SIDEBAR_SECTION_APP_IDS);

/**
 * V2 opens a plan the sidebar row points at under its own nav id, where V1 stayed inside the
 * publishing app with `PlanId` in its args. The list that produced the row therefore has to survive
 * that nav too, or clicking a row blanks the sidebar the click came from.
 */
export const PLAN_DETAIL_NAV_PREFIX = "plan-";

/** V1 `TendrilAppShell.HasSidebarSection`. */
export const hasSidebarSection = (appId: string | null | undefined): boolean =>
  !!appId && sectionAppIds.has(appId.toLowerCase());

/**
 * V1 `TendrilAppShell.UsesSidebarList`: a published list stays visible while the user is on any
 * sidebar-section app, so moving between Review and Plans does not blank the sidebar.
 *
 * The `plan-<id>` arm is V2 only, for the reason on {@link PLAN_DETAIL_NAV_PREFIX}.
 */
export const usesSidebarList = (
  listAppId: string | null | undefined,
  currentAppId: string | null | undefined,
): boolean => {
  if (!listAppId) return false;
  if (currentAppId && listAppId.toLowerCase() === currentAppId.toLowerCase()) return true;
  if (hasSidebarSection(currentAppId)) return true;
  return hasSidebarSection(listAppId) && !!currentAppId?.startsWith(PLAN_DETAIL_NAV_PREFIX);
};

/**
 * V1 `TendrilAppShell.PageTabTitle`: the page tab's title is the selected sidebar row (so the strip
 * reads "#74 Draft" rather than the generic "Plans"), else the app's own title. A row whose title is
 * blank falls back too.
 */
export const pageTabTitle = (
  appTitle: string,
  list: ShellSidebarList | null | undefined,
): string => {
  const selectedId = list?.selectedId;
  if (!selectedId) return appTitle;
  const selectedRow = list.items.find((item) => item.id === selectedId);
  return selectedRow?.title ? selectedRow.title : appTitle;
};

/** Separators no title can contain, so the joined signatures stay unambiguous. */
const UNIT = "\u001f";
const RECORD = "\u001e";

const itemSignature = (item: ShellSectionItemDto): string =>
  [
    item.id,
    item.title,
    item.tag ?? "",
    item.icon ?? "",
    item.state ?? "",
    item.pinned ? "1" : "0",
    (item.badges ?? []).map((b) => `${b.label}|${b.kind}|${b.color ?? ""}`).join(","),
  ].join(UNIT);

/**
 * Everything about a published list that changes what the sidebar draws or which row actions it
 * offers. Deliberately excludes the delegates' identities and includes only whether each is
 * present: a publisher that rebuilds its closures every render must not thrash the shell.
 */
const listSignature = (list: ShellSidebarList): string =>
  [
    list.appId,
    list.title,
    list.selectedId ?? "",
    list.searchable === false ? "0" : "1",
    list.searchLabel ?? "",
    list.newLabel ?? "",
    list.collapsedMenu ? "1" : "0",
    list.onSearch ? "s" : "",
    list.onNew ? "n" : "",
    list.onRename ? "r" : "",
    list.onDelete ? "d" : "",
    list.onTogglePin ? "p" : "",
    String(list.items.length),
    list.items.map(itemSignature).join(RECORD),
  ].join(UNIT);

/**
 * The publish-on-render channel behind the shell sidebar's contextual list, standing in for V1's
 * `[Signal(BroadcastType.AppShell)] ShellSidebarListSignal`.
 *
 * V1's apps publish on **every** `Build()`, so {@link publish} has to tolerate being called on
 * every render. It does that by keeping the snapshot object it hands React identity-stable while
 * the list's *data* is unchanged, and by routing the delegates through wrappers that always call
 * the newest publish. So a publisher rebuilding its closures every render costs one comparison and
 * notifies nobody, while a row action never fires a stale closure.
 */
class SidebarListStore {
  /** The newest publish, whose delegates the snapshot's wrappers call. */
  private latest: ShellSidebarList | null = null;
  /** The identity-stable object handed to React; rebuilt only when {@link signature} moves. */
  private snapshot: ShellSidebarList | null = null;
  private signature: string | null = null;
  private listeners = new Set<() => void>();

  public getState(): ShellSidebarList | null {
    return this.snapshot;
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  /** Publishes (or republishes) the active app's list. Safe to call on every render. */
  public publish(list: ShellSidebarList): void {
    this.latest = list;
    const signature = listSignature(list);
    if (this.snapshot !== null && signature === this.signature) return;

    this.signature = signature;
    this.snapshot = {
      appId: list.appId,
      title: list.title,
      items: list.items,
      selectedId: list.selectedId,
      searchable: list.searchable,
      searchLabel: list.searchLabel,
      newLabel: list.newLabel,
      collapsedMenu: list.collapsedMenu,
      buildSelectArgs: (id) => this.latest?.buildSelectArgs(id),
      onSearch: list.onSearch ? () => this.latest?.onSearch?.() : undefined,
      onNew: list.onNew ? () => this.latest?.onNew?.() : undefined,
      onRename: list.onRename ? (id, title) => this.latest?.onRename?.(id, title) : undefined,
      onDelete: list.onDelete ? (id) => this.latest?.onDelete?.(id) : undefined,
      onTogglePin: list.onTogglePin ? (id) => this.latest?.onTogglePin?.(id) : undefined,
    };
    this.notify();
  }

  /** Drops the published list. */
  public clear(): void {
    if (this.snapshot === null) return;
    this.latest = null;
    this.snapshot = null;
    this.signature = null;
    this.notify();
  }

  /**
   * V1 `TendrilAppShell.HandleOpenPage`: the sidebar section belongs to the page app, so it is
   * dropped when the page changes to an app without a list of its own. It is retained between apps
   * that both show sidebar sections, so the header and search button do not flicker.
   */
  public retainFor(currentAppId: string | null | undefined): void {
    if (this.snapshot === null) return;
    if (usesSidebarList(this.snapshot.appId, currentAppId)) return;
    this.clear();
  }

  /** Test seam: vitest keeps one module instance per file, and this store outlives a render. */
  public resetForTesting(): void {
    this.latest = null;
    this.snapshot = null;
    this.signature = null;
    this.listeners.clear();
  }
}

export const sidebarListStore = new SidebarListStore();

/** The shell side: the currently published list, or null. */
export const usePublishedSidebarList = (): ShellSidebarList | null =>
  useSyncExternalStore(
    sidebarListStore.subscribe,
    () => sidebarListStore.getState(),
    () => sidebarListStore.getState(),
  );

/**
 * The publisher side, for the five sidebar-section views. Call it unconditionally on every render
 * with the list the view wants in the sidebar, exactly as V1's apps publish from `Build()`; pass
 * null while the view has nothing to publish yet (still loading, for instance) and the last
 * published list stays up, as it does in V1.
 *
 * ```ts
 * usePublishSidebarList({
 *   appId: "plans",
 *   title: "Plans",
 *   items: plans.map((p) => ({ id: p.id, title: p.title, tag: `#${p.id}` })),
 *   selectedId,
 *   buildSelectArgs: (id) => ({ planId: id }),
 * });
 * ```
 */
export const usePublishSidebarList = (list: ShellSidebarList | null): void => {
  // No dependency array on purpose: this is V1's publish-on-every-build, and `publish` is the thing
  // that decides whether anything actually changed. Deriving deps from the list would mean either
  // the signature logic twice or a dependency on closures that are new every render.
  useEffect(() => {
    if (list) sidebarListStore.publish(list);
  });
};
