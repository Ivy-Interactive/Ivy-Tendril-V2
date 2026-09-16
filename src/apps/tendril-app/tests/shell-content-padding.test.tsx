import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ShellLayout,
  CONTENT_FULL_BLEED_CLASS,
  CONTENT_PADDED_CLASS,
} from "../src/views/ShellLayout";
import { APP_DESCRIPTORS, isFullBleedApp } from "../src/state/navigation";

/**
 * The outer padding of every app view, pinned to V1's.
 *
 * V1's host pads every app by 16px and owns its scroll (`Ivy-Framework/.../AppHostWidget.tsx`:
 * `<div className="w-full h-full p-4 overflow-y-auto">`). An app opts out by putting
 * `RemoveParentPadding()` on its root layout, which the `:has(> .remove-parent-padding)` rules in the
 * framework's `index.css` turn into `padding: 0 !important` on the parent - all-or-nothing, never a
 * reduced padding.
 *
 * The opt-out set has two halves in V1. The explicit half is `grep -rn RemoveParentPadding
 * Ivy-Tendril/src/Ivy.Tendril/Apps`: `Chat/ContentView.cs`, `Plans/ContentView.cs`,
 * `Review/ContentView.cs`, `ReviewAction/{ReviewActionApp,AppPreviewView}.cs`, `Agent/AgentApp.cs`
 * and the config editors (`ConfigEditorApp.cs`, `Settings/RawConfigEditorView.cs`, which V2 has no
 * view for). The implicit half is apps whose *root widget* already carries the class, so they never
 * call the method: `TendrilDashboard` (`.tdb-root`) for Dashboard, and `SidebarLayoutWidget`
 * (`widgets/layouts/sidebar/SidebarLayoutWidget.tsx:344`) for Settings. Both then re-apply an inset
 * of their own - `.tdb-inner`'s `padding: 16px 16px 24px`, and `SettingsApp.cs:203`'s `.Padding(4)`.
 *
 * V1's remaining implicit opt-outs are not in this list, and deliberately so. Inbox, Icebox and
 * Recommendations opt out through `SidebarLayout` / `HeaderLayout` / `FooterLayout` only for those
 * widgets to re-add `p-2` or `p-4` immediately inside (`HeaderLayoutWidget.tsx:44,54`,
 * `FooterLayoutWidget.tsx:38,49`, `SidebarLayoutWidget.tsx:448`). V2's views are hand-written React
 * with no such re-adding layer, so the shell's 16px *is* the inset those widgets would have supplied,
 * and the net result matches V1.
 *
 * A new app is padded unless it is added here *and* marked `fullBleed` in `APP_DESCRIPTORS`, so a view
 * that picks the wrong one fails this file rather than being spotted by eye.
 */
const FULL_BLEED_APP_IDS = [
  "chat",
  "plans",
  "review",
  "review-action",
  "agent",
  "dashboard",
  "settings",
] as const;

/** Every app that must keep the host's 16px. The complement of the list above, spelled out. */
const PADDED_APP_IDS = ["jobs", "inbox", "recommendations", "pull-requests", "icebox"] as const;

const renderShell = (pageNav: string) =>
  render(
    <ShellLayout
      activeNav={pageNav}
      pageNav={pageNav}
      serviceInfo={null}
      connectionStatus="online"
      reconnectCountdown={0}
      onSelectNav={() => {}}
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      onNewPlan={() => {}}
      onReconnect={() => {}}
    >
      <div>Content</div>
    </ShellLayout>,
  );

describe("app outer padding", () => {
  it("marks exactly V1's `RemoveParentPadding` apps as full-bleed", () => {
    const declared = Object.values(APP_DESCRIPTORS)
      .filter((app) => app.fullBleed)
      .map((app) => app.id)
      .sort();

    expect(declared).toEqual([...FULL_BLEED_APP_IDS].sort());
  });

  it("accounts for every registered app, so a new one cannot skip the decision", () => {
    expect(Object.keys(APP_DESCRIPTORS).sort()).toEqual(
      [...FULL_BLEED_APP_IDS, ...PADDED_APP_IDS].sort(),
    );
  });

  it.each(FULL_BLEED_APP_IDS)("gives %s the frame's full area, unpadded", (appId) => {
    expect(isFullBleedApp(appId)).toBe(true);

    renderShell(appId);
    const content = screen.getByTestId("shell-content");
    expect(content.dataset.fullBleed).toBe("true");
    expect(content.className).toBe(CONTENT_FULL_BLEED_CLASS);
    // V1's opt-out is `padding: 0`, so there is no residual outer padding to inherit.
    expect(content.className).not.toMatch(/(^|\s)p[trblxy]?-\d/);
  });

  it.each(PADDED_APP_IDS)("keeps %s inside the host's 16px", (appId) => {
    expect(isFullBleedApp(appId)).toBe(false);

    renderShell(appId);
    const content = screen.getByTestId("shell-content");
    expect(content.dataset.fullBleed).toBe("false");
    expect(content.className).toBe(CONTENT_PADDED_CLASS);
  });

  it("pads a plan page like the Plans app and a job page like the padded default", () => {
    // A plan page is V1's `PlansApp` plus args, so it inherits the workspace's full-bleed frame. A
    // job page is V1's output *sheet* over the Jobs table, and a sheet is inset.
    expect(isFullBleedApp("plan-00074")).toBe(true);
    expect(isFullBleedApp("job-42")).toBe(false);
  });

  it("pads an unknown app, which is the host's default in both versions", () => {
    expect(isFullBleedApp("not-an-app")).toBe(false);
    expect(isFullBleedApp(null)).toBe(false);
    expect(isFullBleedApp(undefined)).toBe(false);
  });

  it("keeps the scroll inside the frame, so sticky toolbars stay pinned", () => {
    // The padded container scrolls (V1's `overflow-y-auto`) and the full-bleed one does not, because
    // a full-bleed app owns every scroll inside it - `JobsView`'s `fillHeight` table and
    // `PlanWorkspace` both bound their own viewport, which `position: sticky` needs.
    expect(CONTENT_PADDED_CLASS).toContain("overflow-y-auto");
    expect(CONTENT_FULL_BLEED_CLASS).toContain("overflow-hidden");
    // `flex-1` against `.tsh-frame-pane`'s `inset: 0` flex column is what makes the height definite.
    expect(CONTENT_PADDED_CLASS).toContain("flex-1");
    expect(CONTENT_FULL_BLEED_CLASS).toContain("flex-1");
    expect(CONTENT_FULL_BLEED_CLASS).toContain("min-h-0");
  });

  it("never wraps a session pane in the content container", () => {
    // Session panes (review actions, agent terminals) are their own `.tsh-frame-pane`, so their
    // padding is not this container's business - and the container follows the page behind them.
    render(
      <ShellLayout
        activeNav="jobs"
        pageNav="jobs"
        sessionTabs={[
          { id: "session-1", title: "Review Action", appId: "review-action", args: {} },
        ]}
        activeSessionId="session-1"
        sessionContents={[<div key="session-1">Pane</div>]}
        serviceInfo={null}
        connectionStatus="online"
        reconnectCountdown={0}
        onSelectNav={() => {}}
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onNewPlan={() => {}}
        onReconnect={() => {}}
      >
        <div>Content</div>
      </ShellLayout>,
    );

    const content = screen.getByTestId("shell-content");
    expect(content.dataset.fullBleed).toBe("false");
    expect(screen.getByText("Pane").closest("main")).toBeNull();
  });
});
