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
 * The plan id a `plan-<id>` nav names, or null for anything else.
 *
 * V1 never needs this: a row click stays inside the publishing app (`OpenApp(new
 * NavigateArgs(list.AppId, list.BuildSelectArgs(itemId)))`), so the publisher is still mounted and
 * still republishing its own selection on every `Build()`. V2 opens the row's plan under its own nav
 * id instead, which is the whole reason {@link PLAN_DETAIL_NAV_PREFIX} exists -- and on that page the
 * nav id is the only thing left that knows which plan is open.
 */
export const planDetailNavPlanId = (appId: string | null | undefined): string | null => {
  if (!appId?.startsWith(PLAN_DETAIL_NAV_PREFIX)) return null;
  return appId.slice(PLAN_DETAIL_NAV_PREFIX.length) || null;
};

/**
 * `PlanSelectionHelper.ResolveSelection`'s id comparison, which V1 carries for the same reason: one
 * plan reaches the UI as `00021`, as `21` and as `00021-SomePlan`, so a row id and a nav id can name
 * the same plan without being the same string.
 */
const isSamePlanId = (itemId: string, planId: string): boolean => {
  if (itemId.toLowerCase() === planId.toLowerCase()) return true;
  const left = Number.parseInt(itemId, 10);
  const right = Number.parseInt(planId, 10);
  return !Number.isNaN(left) && !Number.isNaN(right) && left === right;
};

/**
 * Points a retained list's `selectedId` at the plan the nav actually has open.
 *
 * {@link SidebarListStore.retainFor} keeps a plan list alive across the `plan-<id>` nav on purpose,
 * but the publisher that owns `selectedId` unmounts on that same navigation, so it never publishes
 * the selection the click produced: `PlansView` calls `setOpenedPlanId` and navigates in one handler,
 * and by the next render it is gone, its `usePublishSidebarList` effect never having run. The
 * snapshot therefore stays frozen on the plan that was selected *before* the click, and the sidebar
 * paints that plan as selected while a different one is open.
 *
 * So on a plan-detail page the nav is the authority, exactly as `PlansAppArgs.PlanId` is in V1. A
 * list holding no row for that plan is returned untouched, which is what leaves a retained chat list
 * (session ids, not plan ids) alone. The same object comes back whenever nothing moves, because the
 * store works hard to keep its snapshot identity-stable and this must not undo that.
 */
export const withNavSelection = (
  list: ShellSidebarList | null,
  currentAppId: string | null | undefined,
): ShellSidebarList | null => {
  const planId = planDetailNavPlanId(currentAppId);
  if (!list || !planId) return list;
  const open = list.items.find((item) => isSamePlanId(item.id, planId));
  if (!open || open.id === list.selectedId) return list;
  return { ...list, selectedId: open.id };
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
   * Drops a row from the retained list, for a plan that has left every queue while the page that
   * publishes the list is not mounted.

   * The gap this closes is the one the operator sees as "the row is still there". A sidebar list is
   * published by its page on every render, so while `PlansView` or `ReviewView` is on screen the
   * shortened queue republishes itself and the row goes on its own. But {@link retainFor} keeps the
   * list alive across a `plan-<id>` navigation on purpose (see {@link PLAN_DETAIL_NAV_PREFIX}), and
   * on that page the publisher has unmounted — so the snapshot is frozen, nothing will republish it,
   * and deleting the plan from its own page leaves a row pointing at a plan that no longer exists.
   * `plansStore` dropping the plan cannot help: no mounted publisher is reading it.
   *
   * Matching is {@link isSamePlanId} rather than string equality for the reason that helper exists:
   * the id reaches this from a dialog as `00021`, from a nav as `21` and from args as
   * `00021-SomePlan`, and all three name the row.
   *
   * A list with no such row is left untouched, identity included, which is what leaves a retained
   * chat list (session ids, not plan ids) alone and keeps the store's snapshot stability intact.
   */
  public removeItem(itemId: string): void {
    const snapshot = this.snapshot;
    if (snapshot === null) return;
    const items = snapshot.items.filter((item) => !isSamePlanId(item.id, itemId));
    if (items.length === snapshot.items.length) return;

    // The selection goes with the row, so the shell does not paint a highlight on a plan that is
    // gone. Which plan to open next is the shell's decision (`nextAfterRemoval`), not this store's.
    const selectedId =
      snapshot.selectedId && isSamePlanId(snapshot.selectedId, itemId) ? null : snapshot.selectedId;
    const next = { ...snapshot, items, selectedId };

    this.latest = this.latest === null ? null : { ...this.latest, items, selectedId };
    this.snapshot = next;
    this.signature = listSignature(next);
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
