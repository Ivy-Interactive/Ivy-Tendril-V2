import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShellLayout } from "../src/views/ShellLayout";
import type { ShellSidebarList } from "../src/state/sidebarListStore";

/**
 * Two places where V2's shell had wiring that rendered but did nothing, both found while reconciling
 * against `AppShell/TendrilAppShell.cs`.
 *
 * 1. V1 binds the Chat row's new-chat affordance *unconditionally* (`.OnNewChat(StartNewChat)`,
 *    L1085) and only overrides it with a published list's own `OnNew` when that list is a collapsed
 *    rail flyout (`.OnNewChat(chatList.OnNew ?? StartNewChat)`, L1092). V2 advertised `OnNewChat`
 *    only inside the flyout branch, so the row's chord was inert on every page that publishes no
 *    collapsed list — Dashboard, Jobs, Review and the rest.
 *
 * 2. Every V1 sidebar list navigates to *its own publisher*: `ShellSidebarListState` carries the args
 *    factory, and Review's is `planId => new ReviewAppArgs(planId)` (`Apps/Review/ReviewApp.cs:37`),
 *    so a row click stays inside `ReviewApp`. V2 intercepted any `{ planId }` from any publisher and
 *    sent it to the shared `plan-<id>` page, which for Review replaces `ReviewView`'s own
 *    `PlanWorkspace` topbar and triage actions with the generic plan page.
 */

const reviewList = (overrides: Partial<ShellSidebarList> = {}): ShellSidebarList => ({
  appId: "review",
  title: "Review",
  items: [{ id: "00074", title: "#74 Ship the shell", tag: "#74" }],
  selectedId: "00074",
  buildSelectArgs: (id) => ({ planId: id }),
  ...overrides,
});

const renderShell = (props: Partial<React.ComponentProps<typeof ShellLayout>> = {}) =>
  render(
    <ShellLayout
      activeNav="dashboard"
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

/** The Cmd/Ctrl+Alt+A chord `ShellAgentButton` binds on `window`. Both modifiers are set so the
 *  platform check in `isModKey` matches whichever one this environment reports. */
const pressNewChatChord = () =>
  fireEvent.keyDown(window, { key: "a", altKey: true, metaKey: true, ctrlKey: true });

describe("the Chat row's new-chat affordance", () => {
  it("is offered on a page that publishes no sidebar list at all", () => {
    // The regression: with nothing published there is no `railFlyoutList`, and the event was only
    // advertised inside that branch. Dashboard is the page a user most often starts a chat from.
    const onNewChat = vi.fn();
    renderShell({ activeNav: "dashboard", onNewChat });

    pressNewChatChord();

    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("is offered on a page whose published list supplies no onNew of its own", () => {
    const onNewChat = vi.fn();
    renderShell({
      activeNav: "review",
      sidebarList: reviewList({ collapsedMenu: true, onNew: undefined }),
      onNewChat,
    });

    pressNewChatChord();

    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("lets a collapsed flyout list override the shell's handler, as V1's `?? StartNewChat` does", () => {
    const onNewChat = vi.fn();
    const listOnNew = vi.fn();
    renderShell({
      activeNav: "review",
      sidebarList: reviewList({ collapsedMenu: true, onNew: listOnNew }),
      onNewChat,
    });

    pressNewChatChord();

    expect(listOnNew).toHaveBeenCalledTimes(1);
    expect(onNewChat).not.toHaveBeenCalled();
  });
});

describe("a Review row click", () => {
  it("reports the review app as the publisher, so the shell can keep the user in it", () => {
    // The shell's contract is to hand back the publishing app id and that publisher's own args;
    // `App.tsx` is what must not collapse `review` onto the shared plan page.
    const onSelectSidebarItem = vi.fn();
    renderShell({ activeNav: "review", sidebarList: reviewList(), onSelectSidebarItem });

    fireEvent.click(screen.getByText("#74 Ship the shell"));

    expect(onSelectSidebarItem).toHaveBeenCalledWith("review", "00074", { planId: "00074" });
  });
});
