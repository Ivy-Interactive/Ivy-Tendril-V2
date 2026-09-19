import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ShellLayout,
  buildNavItems,
  buildSettingsMenuItems,
  type ShellMenuItemDto,
} from "../src/views/ShellLayout";

/**
 * The sidebar's item set, against V1 `AppShell/TendrilAppShell.cs`. This is a drift guard: every
 * assertion here names the V1 decision it copies, so adding, removing or reordering a row fails
 * loudly rather than quietly diverging.
 *
 * V1's own equivalents are `Test/AppShell/TendrilAppShellNavTests.cs` (over `BuildNavItems`) and the
 * `settingsMenuItems` array in `Build()`.
 */

const labelsOf = (items: ShellMenuItemDto[]) => items.map((item) => item.label);

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

describe("sidebar nav items (V1 BuildNavItems)", () => {
  it("is exactly V1's five visible Apps rows, in Constants order, with V1's icons", () => {
    // `[App(group: ["Apps"], order: Constants.*)]`: Dashboard 10, Plans 20, Review 30,
    // Recommendations 40, Jobs 50. Icons are the `[App(icon: ...)]` values.
    expect(buildNavItems("dashboard")).toEqual([
      { id: "dashboard", label: "Dashboard", icon: "ChartBar", badge: undefined, isActive: true },
      { id: "plans", label: "Plans", icon: "Feather", badge: undefined, isActive: false },
      { id: "review", label: "Review", icon: "ThumbsUp", badge: undefined, isActive: false },
      {
        id: "recommendations",
        label: "Recommendations",
        icon: "Lightbulb",
        badge: undefined,
        isActive: false,
      },
      { id: "jobs", label: "Jobs", icon: "Activity", badge: undefined, isActive: false },
    ]);
  });

  it("excludes every app V1's BuildNavItems drops", () => {
    const ids = buildNavItems("dashboard").map((item) => item.id);

    // `tag == AgentAppId || tag == ChatAppId` - both are reached from the Chat row above the nav.
    expect(ids).not.toContain("chat");
    expect(ids).not.toContain("agent");
    // `footerAppIds` - the Inbox gets its own footer button (`ShowInboxInFooter`).
    expect(ids).not.toContain("inbox");
    // `isVisible: false` - reached from the footer's settings menu, not the nav.
    expect(ids).not.toContain("pull-requests");
    expect(ids).not.toContain("icebox");
    expect(ids).not.toContain("settings");
  });

  it("badges each row from V1's badge dictionary key, and shows nothing at zero", () => {
    // `BuildMenuItems`: plans -> DraftCount, review -> ReviewCount,
    // recommendations -> RecommendationsCount, jobs -> JobCount. Dashboard has no key at all.
    const items = buildNavItems("plans", { plans: 3, review: 0, recommendations: 12, jobs: 7 });
    expect(items.map((item) => [item.id, item.badge])).toEqual([
      ["dashboard", undefined],
      ["plans", "3"],
      ["review", undefined],
      ["recommendations", "12"],
      ["jobs", "7"],
    ]);
  });

  it("marks the current app active, and only it", () => {
    expect(
      buildNavItems("review")
        .filter((item) => item.isActive)
        .map((item) => item.id),
    ).toEqual(["review"]);
    // A nav id that is not a row (a plan detail, say) leaves every row inactive.
    expect(buildNavItems("plan-00074").some((item) => item.isActive)).toBe(false);
  });

  it("renders those five rows, in that order, and nothing else", () => {
    const { container } = renderShell();

    expect(
      Array.from(container.querySelectorAll(".tsh-nav-item")).map((row) =>
        row.getAttribute("aria-label"),
      ),
    ).toEqual(["Dashboard", "Plans", "Review", "Recommendations", "Jobs"]);
  });
});

describe("sidebar body and footer (V1 sidebarBody / sidebarFooter)", () => {
  it("is New Plan, the Chat row, the nav, then the section", () => {
    // V1: `sidebarBody: [newPlanButton, chatButton, nav, section]`.
    const { container } = renderShell();
    const body = container.querySelector(".tsh-sidebar-body");
    expect(body).not.toBeNull();

    const order = Array.from(body!.children).map((child) => child.className.split(" ")[0]);
    expect(order).toEqual(["tsh-newplan-wrap", "tsh-agent-wrap", "tsh-nav", "tsh-section"]);

    // The Chat row is that second slot, not a nav row: label "Chat", `Icons.MessageCircle`.
    expect(container.querySelector(".tsh-agent")?.getAttribute("aria-label")).toBe("Chat");
  });

  it("is the Inbox then the settings cog in the footer, both icon-only", () => {
    // A deliberate divergence, requested directly: V1 pairs them the other way round
    // (`inboxInFooter ? [settingsMenu, inboxButton] : [settingsMenu]`,
    // `TendrilAppShell.cs:1188`). `.tsh-sidebar-footer` is a row while the sidebar is expanded and a
    // column once collapsed - identical CSS in both versions - so this order is what puts Inbox
    // above Settings on the rail. `ShowLabel(!inboxInFooter)` is still false whenever the two are
    // paired, which is V1's rule and unchanged.
    const { container } = renderShell();
    const footer = container.querySelector(".tsh-sidebar-footer");
    const buttons = Array.from(footer!.querySelectorAll("button.tsh-settings"));

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Inbox",
      "Settings",
    ]);
    expect(buttons.every((button) => button.getAttribute("data-icon-only") === "true")).toBe(true);
    // Neither carries a badge in V1, even though `icebox` and `inbox` have counts elsewhere.
    expect(footer!.querySelector(".tsh-nav-badge")).toBeNull();
  });
});

describe("sidebar footer settings menu (V1 settingsMenuItems)", () => {
  it("is Configuration, Pull Requests, Icebox, Check for Updates, Help - in that order", () => {
    const items = buildSettingsMenuItems({
      onSelectNav: () => {},
      onCheckForUpdates: () => {},
    });

    expect(labelsOf(items)).toEqual([
      "Configuration",
      "Pull Requests",
      "Icebox",
      "Check for Updates",
      "Help",
    ]);
    // `BuildHelpMenuItems`, minus the `isBeta` "About" row V2 has no view for.
    expect(labelsOf(items.at(-1)!.children!)).toEqual(["Documentation", "Discord", "Report Issue"]);
  });

  it("has no Keyboard Shortcuts row, because V1 has no such item anywhere", () => {
    const items = buildSettingsMenuItems({ onSelectNav: () => {} });
    const everyLabel = items.flatMap((item) => [item.label, ...labelsOf(item.children ?? [])]);

    expect(everyLabel.some((label) => /shortcut/i.test(label))).toBe(false);
  });

  it("drops Check for Updates when the host cannot perform one", () => {
    expect(labelsOf(buildSettingsMenuItems({ onSelectNav: () => {} }))).toEqual([
      "Configuration",
      "Pull Requests",
      "Icebox",
      "Help",
    ]);
  });

  it("navigates each row where V1's OnSelect navigates", () => {
    const onSelectNav = vi.fn();
    const onCheckForUpdates = vi.fn();
    const items = buildSettingsMenuItems({ onSelectNav, onCheckForUpdates });
    const select = (label: string) => items.find((item) => item.label === label)!.onSelect!();

    // `navigator.Navigate<SettingsApp>()`, whose `[App(title: "Configuration")]` is the label.
    select("Configuration");
    expect(onSelectNav).toHaveBeenLastCalledWith("settings");
    select("Pull Requests");
    expect(onSelectNav).toHaveBeenLastCalledWith("pull-requests");
    select("Icebox");
    expect(onSelectNav).toHaveBeenLastCalledWith("icebox");
    select("Check for Updates");
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("gives every row a glyph, as V1's MenuItem.Icon does", () => {
    const items = buildSettingsMenuItems({
      onSelectNav: () => {},
      onCheckForUpdates: () => {},
    });
    const all = items.flatMap((item) => [item, ...(item.children ?? [])]);

    expect(all).toHaveLength(8);
    expect(all.every((item) => item.icon !== undefined && item.icon !== null)).toBe(true);
  });
});

describe("keyboard shortcuts are not a sidebar item", () => {
  it("renders no Keyboard Shortcuts affordance in the shell chrome", () => {
    // The one the user asked to be gone. The `?` shortcut still opens the help panel, which is how
    // V1 keeps its own shortcuts discoverable: in situ, never as a sidebar row.
    renderShell();
    expect(screen.queryByText(/keyboard shortcuts/i)).not.toBeInTheDocument();
  });
});
