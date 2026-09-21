import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ShellLayout } from "../src/views/ShellLayout";
import { uiStore } from "../src/state/uiStore";
import { navigation } from "../src/state/navigation";
import {
  DEFAULT_SEARCH_LABEL,
  hasSidebarSection,
  pageTabTitle,
  sidebarListStore,
  usesSidebarList,
  type ShellSidebarList,
} from "../src/state/sidebarListStore";

/**
 * The shell side of V1's `AppShell/ShellSidebarListSignal.cs`: five apps publish a contextual list
 * into the sidebar and render none of their own, and the shell routes a row click back as a
 * navigation. `AppShell/TendrilAppShell.cs` is the authority for `UsesSidebarList`, `PageTabTitle`
 * and the section's search defaults.
 */

const plansList = (overrides: Partial<ShellSidebarList> = {}): ShellSidebarList => ({
  appId: "plans",
  title: "Plans",
  items: [
    { id: "00074", title: "#74 Draft the shell", tag: "#74" },
    { id: "00075", title: "#75 Wire the rail", tag: "#75" },
  ],
  selectedId: "00074",
  buildSelectArgs: (id) => ({ planId: id }),
  ...overrides,
});

/** One open review-action pane, which is the only session V2 has (V1's `allowDuplicateTabs` apps). */
const reviewActionPane = {
  id: "review-action:Tendril:00074:Run Tests",
  appId: "review-action",
  title: "#74 Run Tests",
  args: {},
};

const renderShell = (props: Partial<React.ComponentProps<typeof ShellLayout>> = {}) =>
  render(
    <ShellLayout
      activeNav="plans"
      serviceInfo={null}
      connectionStatus="online"
      reconnectCountdown={0}
      onSelectNav={() => {}}
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      onNewPlan={() => {}}
      onReconnect={() => {}}
      {...props}
    >
      <div>Content</div>
    </ShellLayout>,
  );

describe("sidebarListStore", () => {
  beforeEach(() => {
    sidebarListStore.resetForTesting();
  });

  it("publishes on every render without thrashing subscribers", () => {
    const listener = vi.fn();
    sidebarListStore.subscribe(listener);

    // V1's apps publish on every `Build()`, rebuilding their delegates each time, so republishing
    // identical data must notify nobody.
    sidebarListStore.publish(plansList());
    expect(listener).toHaveBeenCalledTimes(1);
    const first = sidebarListStore.getState();

    sidebarListStore.publish(plansList());
    sidebarListStore.publish(plansList());
    expect(listener).toHaveBeenCalledTimes(1);
    // The snapshot's identity is stable too, so React does not re-render on a no-op publish.
    expect(sidebarListStore.getState()).toBe(first);

    sidebarListStore.publish(plansList({ selectedId: "00075" }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(sidebarListStore.getState()?.selectedId).toBe("00075");
  });

  it("routes the delegates of the newest publish, not the ones the snapshot was built from", () => {
    const stale = vi.fn(() => ({ planId: "stale" }));
    const fresh = vi.fn(() => ({ planId: "fresh" }));
    sidebarListStore.publish(plansList({ buildSelectArgs: stale }));
    const snapshot = sidebarListStore.getState()!;

    sidebarListStore.publish(plansList({ buildSelectArgs: fresh }));

    expect(snapshot.buildSelectArgs("00074")).toEqual({ planId: "fresh" });
    expect(stale).not.toHaveBeenCalled();
  });

  it("keeps the published list across sidebar-section apps and drops it elsewhere", () => {
    // V1 `TendrilAppShell.UsesSidebarList` / `HasSidebarSection`.
    expect(["review", "plans", "drafts", "recommendations", "chat"].every(hasSidebarSection)).toBe(
      true,
    );
    expect(hasSidebarSection("jobs")).toBe(false);
    expect(usesSidebarList("plans", "review")).toBe(true);
    expect(usesSidebarList("plans", "plan-00074")).toBe(true);
    expect(usesSidebarList("plans", "jobs")).toBe(false);

    // V1 `HandleOpenPage` drops the section only when the new page is neither the list's own app
    // nor a sidebar-section app.
    sidebarListStore.publish(plansList());
    sidebarListStore.retainFor("review");
    expect(sidebarListStore.getState()).not.toBeNull();
    sidebarListStore.retainFor("jobs");
    expect(sidebarListStore.getState()).toBeNull();
  });

  /**
   * The row a deleted plan leaves behind, which is the half of "it does not instantly remove the
   * deleted thing from the sidebar" that dropping the plan from `plansStore` cannot reach.
   *
   * On Plans or Review the page republishes its own list on every render, so a shortened queue takes
   * the row with it. On a `plan-<id>` page that publisher has unmounted and `retainFor` is keeping
   * the snapshot alive on purpose — so it is frozen, and the row for the plan the operator just
   * deleted from that very page stays in the sidebar and stays clickable.
   */
  it("drops a deleted plan's row from a list no mounted page can republish", () => {
    sidebarListStore.publish(plansList());
    sidebarListStore.retainFor("plan-00074");
    const listener = vi.fn();
    sidebarListStore.subscribe(listener);

    sidebarListStore.removeItem("00074");

    expect(sidebarListStore.getState()?.items.map((i) => i.id)).toEqual(["00075"]);
    // The highlight goes with the row rather than staying on a plan that is gone. Which plan opens
    // next is `nextAfterRemoval`'s decision, made by the shell, not this store's.
    expect(sidebarListStore.getState()?.selectedId).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("matches the row by any of the three spellings of a plan id", () => {
    // `isSamePlanId`: the id reaches this from a dialog as `00074`, a nav as `74` and args as
    // `00074-SomePlan`.
    sidebarListStore.publish(plansList());
    sidebarListStore.removeItem("74");
    expect(sidebarListStore.getState()?.items.map((i) => i.id)).toEqual(["00075"]);
  });

  it("leaves a list holding no such row completely alone", () => {
    // A retained chat list is keyed by session id, and a plan delete must not disturb it — identity
    // included, or the shell re-renders for nothing.
    sidebarListStore.publish(plansList());
    const before = sidebarListStore.getState();
    const listener = vi.fn();
    sidebarListStore.subscribe(listener);

    sidebarListStore.removeItem("00404");

    expect(sidebarListStore.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps republishing coherent after a removal", () => {
    // The signature has to move with the shortened list, or the page that remounts and republishes
    // the *original* queue is mistaken for a no-op and the row never comes back.
    sidebarListStore.publish(plansList());
    sidebarListStore.removeItem("00074");

    sidebarListStore.publish(plansList());

    expect(sidebarListStore.getState()?.items.map((i) => i.id)).toEqual(["00074", "00075"]);
  });

  it("titles the page tab after the selected row, falling back to the app title", () => {
    // V1 `TendrilAppShell.PageTabTitle`.
    expect(pageTabTitle("Plans", plansList())).toBe("#74 Draft the shell");
    expect(pageTabTitle("Plans", plansList({ selectedId: null }))).toBe("Plans");
    expect(pageTabTitle("Plans", plansList({ selectedId: "missing" }))).toBe("Plans");
    expect(pageTabTitle("Plans", plansList({ items: [{ id: "00074", title: "" }] }))).toBe("Plans");
    expect(pageTabTitle("Plans", null)).toBe("Plans");
  });
});

describe("navigation seam", () => {
  beforeEach(() => {
    navigation.resetForTesting();
  });

  it("rule 4: a page is the page, never a tab, and the address says which", () => {
    uiStore.setActiveNav("dashboard");
    expect(navigation.getState().sessions).toEqual([]);
    expect(navigation.getState().activeNav).toBe("dashboard");
    expect(window.location.pathname).toBe("/dashboard");

    // Args travel in the address rather than being smuggled through the nav id.
    uiStore.navigate({ appId: "plan-00074", args: { planId: "00074" } });
    expect(navigation.getState().sessions).toEqual([]);
    expect(navigation.getState().pageArgs).toEqual({ planId: "00074" });
    expect(window.location.search).toBe("?planId=00074");
  });

  it("rule 3: a session app opens a pane, keyed so the same session is revealed not restarted", () => {
    uiStore.navigate({
      appId: "review-action",
      args: { sessionId: "ra:1", actionName: "Run Tests" },
    });
    expect(navigation.getState().sessions.map((s) => s.id)).toEqual(["ra:1"]);
    expect(navigation.getState().activeSessionId).toBe("ra:1");
    // The open session is part of the address, which is why V1 can restore a pane by its tab id.
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("ra:1");

    // The page behind it is untouched, and reopening the same action reveals the pane it is in.
    uiStore.setActiveNav("review");
    uiStore.navigate({
      appId: "review-action",
      args: { sessionId: "ra:1", actionName: "Run Tests" },
    });
    expect(navigation.getState().sessions).toHaveLength(1);

    // A *different* action is a second pane, which is what `allowDuplicateTabs: true` buys.
    uiStore.navigate({ appId: "review-action", args: { sessionId: "ra:2", actionName: "Lint" } });
    expect(navigation.getState().sessions.map((s) => s.id)).toEqual(["ra:1", "ra:2"]);
  });

  it("rule 2: an address or target naming no app does nothing", () => {
    uiStore.setActiveNav("inbox");
    uiStore.navigate({ appId: null });
    expect(navigation.getState().activeNav).toBe("inbox");
  });

  it("rule 1: history naming a pane that is gone is an error, not a silent redirect", () => {
    uiStore.navigate({ appId: "review-action", args: { sessionId: "ra:1" } });
    const sessionUrl = window.location.pathname + window.location.search;

    uiStore.closeTab("ra:1");
    expect(navigation.getState().sessions).toEqual([]);

    // Back into the closed pane. V1 refuses to open something else in its place.
    window.history.replaceState(null, "", sessionUrl);
    navigation.syncFromAddress(true);
    expect(navigation.getState().error).toBe("Tab no longer exists.");

    uiStore.clearNavError();
    expect(navigation.getState().error).toBeNull();
  });

  it("reveals the page behind the panes without unmounting them", () => {
    uiStore.setActiveNav("review");
    uiStore.navigate({ appId: "review-action", args: { sessionId: "ra:1" } });
    uiStore.showPage();

    expect(navigation.getState().activeSessionId).toBeNull();
    expect(navigation.getState().activeNav).toBe("review");
    // The pane is still registered, so its terminal is still running.
    expect(navigation.getState().sessions).toHaveLength(1);
  });

  it("closing the last pane reveals the page, and closing one of two picks a neighbour", () => {
    uiStore.setActiveNav("review");
    uiStore.navigate({ appId: "review-action", args: { sessionId: "ra:1" } });
    uiStore.navigate({ appId: "review-action", args: { sessionId: "ra:2" } });

    uiStore.closeTab("ra:2");
    expect(navigation.getState().activeSessionId).toBe("ra:1");

    uiStore.closeTab("ra:1");
    expect(navigation.getState().activeSessionId).toBeNull();
    expect(navigation.getState().activeNav).toBe("review");
  });

  it("adopts a first-load address, dropping a session it cannot resurrect", () => {
    window.history.replaceState(null, "", "/review-action?sessionId=ra:9&tab=ra:9");
    navigation.syncFromAddress(false);

    // Not an error: a first load is not a history pop, and the process died with the last run.
    expect(navigation.getState().error).toBeNull();
    expect(navigation.getState().activeSessionId).toBeNull();
    expect(new URLSearchParams(window.location.search).get("tab")).toBeNull();
  });
});

describe("ShellLayout sidebar list", () => {
  beforeEach(() => {
    sidebarListStore.resetForTesting();
  });

  it("renders the published list in the sidebar, not the content area", () => {
    const { container } = renderShell({ sidebarList: plansList() });

    // "Plans" is also the nav row's label, so the assertion is on the section's own title.
    expect(container.querySelector(".tsh-section-title")?.textContent).toBe("Plans");
    const sidebar = container.querySelector(".tsh-sidebar")!;
    expect(sidebar).toContainElement(screen.getByText("#74 Draft the shell"));
    expect(sidebar).toContainElement(screen.getByText("#75 Wire the rail"));
  });

  it("keeps a published list up while navigating between two sidebar-section apps", () => {
    // The rule from V1 that is easiest to get wrong: moving Plans -> Review must not blank the
    // sidebar, because Review has not published its own list yet.
    const { rerender } = renderShell({ sidebarList: plansList() });
    expect(screen.getByText("#74 Draft the shell")).toBeInTheDocument();

    const shell = (activeNav: string) => (
      <ShellLayout
        activeNav={activeNav}
        serviceInfo={null}
        connectionStatus="online"
        reconnectCountdown={0}
        onSelectNav={() => {}}
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onNewPlan={() => {}}
        onReconnect={() => {}}
        sidebarList={plansList()}
      >
        <div>Content</div>
      </ShellLayout>
    );

    rerender(shell("review"));
    expect(screen.getByText("#74 Draft the shell")).toBeInTheDocument();

    rerender(shell("recommendations"));
    expect(screen.getByText("#74 Draft the shell")).toBeInTheDocument();

    // Jobs has no sidebar section, so the section falls back to V1's full-width Search button.
    rerender(shell("jobs"));
    expect(screen.queryByText("#74 Draft the shell")).not.toBeInTheDocument();
    expect(screen.getByLabelText(DEFAULT_SEARCH_LABEL)).toBeInTheDocument();
  });

  it("routes a row click as a navigation to the list's app with its select args", () => {
    const onSelectSidebarItem = vi.fn();
    renderShell({ sidebarList: plansList(), onSelectSidebarItem });

    fireEvent.click(screen.getByText("#75 Wire the rail"));

    expect(onSelectSidebarItem).toHaveBeenCalledWith("plans", "00075", { planId: "00075" });
  });

  it("names the $page tab after the selected sidebar row, beside the session tabs", () => {
    // V1 `BuildStripTabs` / `PageTabDisplay`: the strip is the page tab plus the sessions, and a
    // session tab is what keeps the strip on screen at all (`HasTabs`).
    renderShell({
      sidebarList: plansList(),
      activeNav: "plans",
      sessionTabs: [reviewActionPane],
    });

    expect(screen.getByRole("tab", { name: /#74 Draft the shell/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /#74 Run Tests/ })).toBeInTheDocument();
    // A page is never a tab of its own.
    expect(screen.queryByRole("tab", { name: /^Plans$/ })).not.toBeInTheDocument();
  });

  it("shows no strip at all until a session is open", () => {
    const { container } = renderShell({ sidebarList: plansList(), sessionTabs: [] });
    expect(container.querySelector(".tsh-tabs-row")).toBeNull();
  });

  it("titles the page tab after the page a session is covering, and reveals it on click", () => {
    // V1 `PageTabDisplay` reads `currentApp`, not the visible session, and `ShowPage` reveals it.
    const onShowPage = vi.fn();
    renderShell({
      activeNav: reviewActionPane.id,
      activeSessionId: reviewActionPane.id,
      pageNav: "review",
      sessionTabs: [reviewActionPane],
      onShowPage,
    });

    const pageTab = screen.getByRole("tab", { name: /Review$/ });
    expect(pageTab).toBeInTheDocument();
    fireEvent.click(pageTab);
    expect(onShowPage).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plan search with V1's label when the list supplies no onSearch", () => {
    const onPlanSearch = vi.fn();
    renderShell({ sidebarList: plansList(), onPlanSearch });

    fireEvent.click(screen.getByLabelText(DEFAULT_SEARCH_LABEL));
    expect(onPlanSearch).toHaveBeenCalledTimes(1);
  });

  it("prefers the list's own search and label over the plan search", () => {
    const onPlanSearch = vi.fn();
    const onSearch = vi.fn();
    renderShell({
      sidebarList: plansList({
        appId: "chat",
        title: "Chats",
        onSearch,
        searchLabel: "Search chats",
      }),
      activeNav: "chat",
      onPlanSearch,
    });

    fireEvent.click(screen.getByLabelText("Search chats"));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onPlanSearch).not.toHaveBeenCalled();
  });

  it("keeps plan search reachable from an app with no list at all", () => {
    // V1: "apps without a list (and lists with no rows) get the section's full-width Search button
    // in place of the title".
    const onPlanSearch = vi.fn();
    renderShell({ activeNav: "jobs", sidebarList: null, onPlanSearch });

    fireEvent.click(screen.getByLabelText(DEFAULT_SEARCH_LABEL));
    expect(onPlanSearch).toHaveBeenCalledTimes(1);
  });

  it("shows the new affordance only with a newLabel, and fires onNew", () => {
    const onNew = vi.fn();
    const { unmount } = renderShell({ sidebarList: plansList({ newLabel: "New chat", onNew }) });
    fireEvent.click(screen.getByLabelText("New chat"));
    expect(onNew).toHaveBeenCalledTimes(1);
    unmount();

    renderShell({ sidebarList: plansList() });
    expect(screen.queryByLabelText("New chat")).not.toBeInTheDocument();
  });

  it("offers rename, delete and pin only for the handlers the list supplied", () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onTogglePin = vi.fn();
    renderShell({ sidebarList: plansList({ onRename, onDelete, onTogglePin }) });

    fireEvent.click(screen.getByLabelText("#75 Wire the rail options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Pin chat/ }));
    expect(onTogglePin).toHaveBeenCalledWith("00075");

    fireEvent.click(screen.getByLabelText("#75 Wire the rail options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledWith("00075");

    fireEvent.click(screen.getByLabelText("#75 Wire the rail options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit name/ }));
    const input = screen.getByLabelText("Item name");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("00075", "Renamed");
  });

  it("leaves row actions off entirely when the list supplies none", () => {
    renderShell({ sidebarList: plansList() });
    expect(screen.queryByLabelText("#75 Wire the rail options")).not.toBeInTheDocument();
  });

  /**
   * The double-highlight bug: opening #75 from the sidebar left #74 highlighted *as well*.
   *
   * `PlansView` unmounts the instant its row click navigates to `plan-00075`, so the publish carrying
   * `selectedId: "00075"` never happens -- the retained snapshot is the one the click was made from,
   * still naming #74. `retainFor` keeps that list alive on purpose (a plan page must not blank the
   * sidebar it was opened from), so the stale selection is retained with it. The nav is the only
   * thing that still knows which plan is open, and V1 reads the same fact from `PlansAppArgs.PlanId`.
   */
  const selectedRows = (container: HTMLElement, selector: string) => [
    ...container.querySelectorAll(`${selector}[data-selected="true"]`),
  ];

  it("marks exactly one row selected after switching plans, and it is the plan that is open", () => {
    // The click published nothing, so the list the shell still holds names the *previous* plan.
    const stale = plansList({ selectedId: "00074" });
    const { container } = renderShell({ sidebarList: stale, activeNav: "plan-00075" });

    const selected = selectedRows(container, ".tsh-section-item");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("#75 Wire the rail");
  });

  it("titles the page tab after the plan the nav opened, not the one it came from", () => {
    // `PageTabTitle` reads the same `selectedId`, so a stale row would mis-title the strip too.
    renderShell({
      sidebarList: plansList({ selectedId: "00074" }),
      activeNav: "plan-00075",
      pageNav: "plans",
      sessionTabs: [reviewActionPane],
    });

    expect(screen.getByRole("tab", { name: /#75 Wire the rail/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /#74 Draft the shell/ })).not.toBeInTheDocument();
  });

  it("leaves the selection alone on the list's own page, where the publisher still owns it", () => {
    // Only a `plan-<id>` nav has no publisher; on Plans itself the published value is the truth.
    const { container } = renderShell({ sidebarList: plansList(), activeNav: "plans" });

    const selected = selectedRows(container, ".tsh-section-item");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("#74 Draft the shell");
  });

  it("leaves a retained list alone when it holds no row for the plan the nav names", () => {
    // A chat list retained across a plan page keys on session ids, so nothing there is that plan.
    const chats = plansList({ appId: "chat", title: "Chats", selectedId: "00074" });
    const { container } = renderShell({ sidebarList: chats, activeNav: "plan-99999" });

    const selected = selectedRows(container, ".tsh-section-item");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("#74 Draft the shell");
  });

  it("matches a nav id spelled without the folder padding", () => {
    // `ResolveSelection` accepts `00021`, `21` and `00021-SomePlan` as one plan; so must this.
    const { container } = renderShell({
      sidebarList: plansList({ selectedId: "00074" }),
      activeNav: "plan-75",
    });

    const selected = selectedRows(container, ".tsh-section-item");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("#75 Wire the rail");
  });

  it("keeps Inbox out of the nav rows and in the sidebar footer", () => {
    // V1 `BuildNavItems`'s `footerAppIds` plus `ShowInboxInFooter`: the Inbox is an icon-only
    // footer button beside the settings cog, not a nav row.
    const { container } = renderShell({ activeNav: "inbox" });
    const inbox = screen.getByLabelText("Inbox");
    expect(container.querySelector(".tsh-sidebar-footer")?.contains(inbox)).toBe(true);
    expect(container.querySelector(".tsh-nav")?.contains(inbox)).toBe(false);
  });
});

describe("ShellLayout collapsed rail", () => {
  beforeEach(() => {
    sidebarListStore.resetForTesting();
    window.localStorage.setItem("tendril.shell.sidebarCollapsed", "true");
  });

  it("shows narrow id chips for a plan list", () => {
    const { container } = renderShell({ sidebarList: plansList() });

    expect(container.querySelector(".tsh-section-rail")).not.toBeNull();
    // V1's rail chips are the rows' tags, e.g. "#74".
    expect(container.querySelectorAll(".tsh-rail-item").length).toBe(2);
    expect(container.textContent).toContain("#74");
  });

  /* The rail is where the bug was reported from: the screenshot showed #4 and #2 both filled. */
  it("highlights exactly one rail chip after switching plans", () => {
    const { container } = renderShell({
      sidebarList: plansList({ selectedId: "00074" }),
      activeNav: "plan-00075",
    });

    const selected = [...container.querySelectorAll('.tsh-rail-item[data-selected="true"]')];
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("aria-label")).toBe("#75 Wire the rail");
  });

  it("folds a collapsedMenu list into the Chat row's flyout instead of chips", async () => {
    const onSelectSidebarItem = vi.fn();
    const chats = plansList({
      appId: "chat",
      title: "Chats",
      collapsedMenu: true,
      buildSelectArgs: (id) => ({ sessionId: id }),
    });
    const { container } = renderShell({
      activeNav: "chat",
      sidebarList: chats,
      onSelectSidebarItem,
    });

    // The rail keeps only the search button; the list moved to the Chat row.
    expect(container.querySelectorAll(".tsh-rail-item").length).toBe(0);

    const chatButton = screen.getByLabelText("Chat");
    await act(async () => {
      fireEvent.click(chatButton);
    });

    fireEvent.click(screen.getByText("#75 Wire the rail"));
    expect(onSelectSidebarItem).toHaveBeenCalledWith("chat", "00075", { sessionId: "00075" });
  });
});
