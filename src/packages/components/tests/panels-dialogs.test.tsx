import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  ChatSearchDialog,
  MAX_CHAT_SEARCH_RESULTS,
  filterChatSessions,
  type ChatSearchSession,
} from "../src/components/Dialogs/ChatSearchDialog";
import { DeleteChatSessionDialog } from "../src/components/Dialogs/DeleteChatSessionDialog";
import { KeyboardShortcutsDialog } from "../src/components/Dialogs/KeyboardShortcutsDialog";
import { UpdateTendrilDialog } from "../src/components/Dialogs/UpdateTendrilDialog";
import { PlanRevisionSheet } from "../src/components/Sheets/PlanRevisionSheet";
import { buildKpiBlade, KpiBreakdownSheet } from "../src/components/Sheets/KpiBreakdownSheet";
import { i18n } from "../src/i18n/uiPanels";

/**
 * The chat, inbox, pull-request, dashboard and shell dialogs and sheets ported from V1. The app's
 * view tests drive them through their hosts; these pin the V1 rules each component owns itself.
 */

beforeAll(() => {
  // The blade stack reads the viewport through `useIsMobile`; jsdom has no `matchMedia`.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
});

const session = (id: string, title: string): ChatSearchSession => ({
  id,
  title,
  updatedAt: "2026-09-22T10:00:00Z",
});

describe("ChatSearchDialog", () => {
  it("matches titles case-insensitively and caps at V1's fifteen", () => {
    const many = Array.from({ length: 20 }, (_, i) => session(`s${i}`, `Deploy ${i}`));
    expect(filterChatSessions(many, "")).toHaveLength(MAX_CHAT_SEARCH_RESULTS);
    expect(filterChatSessions(many, "  DEPLOY 1")).toHaveLength(11);
    expect(filterChatSessions(many, "nothing")).toEqual([]);
  });

  it("closes first and then selects the picked chat", () => {
    const calls: string[] = [];
    render(
      <ChatSearchDialog
        isOpen
        onClose={() => calls.push("close")}
        onSelectSession={(id) => calls.push(`select:${id}`)}
        sessions={[session("a", "Architecture"), session("b", "Deploy the daemon")]}
      />,
    );
    const dialog = screen.getByTestId("chat-search-dialog");
    fireEvent.change(within(dialog).getByLabelText("Search chats"), {
      target: { value: "deploy" },
    });
    const results = within(dialog).getAllByTestId("chat-search-result");
    expect(results).toHaveLength(1);
    fireEvent.click(results[0]);
    expect(calls).toEqual(["close", "select:b"]);
  });

  it('reads "No chats found." when nothing matches', () => {
    render(<ChatSearchDialog isOpen onClose={() => {}} onSelectSession={() => {}} sessions={[]} />);
    expect(screen.getByTestId("chat-search-empty")).toHaveTextContent("No chats found.");
  });
});

describe("DeleteChatSessionDialog", () => {
  it("quotes a titled chat and names an untitled one as V1 does", () => {
    const { rerender } = render(
      <DeleteChatSessionDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        sessionTitle="Plan"
      />,
    );
    expect(screen.getByTestId("chat-delete-session-dialog")).toHaveTextContent(
      'Are you sure you want to delete "Plan"? This action cannot be undone.',
    );
    rerender(
      <DeleteChatSessionDialog isOpen onClose={() => {}} onConfirm={() => {}} sessionTitle="  " />,
    );
    expect(screen.getByTestId("chat-delete-session-dialog")).toHaveTextContent(
      "Are you sure you want to delete this chat session?",
    );
  });
});

describe("KeyboardShortcutsDialog", () => {
  it("sorts by description and dims an inactive shortcut", () => {
    render(
      <KeyboardShortcutsDialog
        isOpen
        onClose={() => {}}
        shortcuts={[
          { id: "z", displayKey: "Ctrl+K", description: "Search plans", isActive: true },
          { id: "a", displayKey: "?", description: "Approve plan", isActive: false },
        ]}
      />,
    );
    const rows = within(screen.getByTestId("shortcuts-dialog")).getAllByTestId("shortcut-row");
    expect(Array.from(rows, (r) => r.firstElementChild?.textContent)).toEqual([
      "Approve plan",
      "Search plans",
    ]);
    expect(rows[0]).toHaveAttribute("aria-disabled", "true");
  });
});

describe("UpdateTendrilDialog", () => {
  const base = {
    isOpen: true,
    currentVersion: "2.3.1",
    latestVersion: "2.4.0",
    updateCommand: "irm https://cdn.ivy.app/install-tendril.ps1 | iex",
  };

  it("shows the terminal command and only OK when the install cannot update itself", () => {
    render(<UpdateTendrilDialog {...base} onClose={() => {}} canSelfUpdate={false} />);
    expect(screen.getByTestId("update-tendril-command")).toHaveTextContent(base.updateCommand);
    expect(screen.getByTestId("dialog-ok")).toBeInTheDocument();
    expect(screen.queryByTestId("update-tendril-now")).not.toBeInTheDocument();
  });

  it("offers Update Now, and Retry after a failure", () => {
    const onUpdate = vi.fn();
    const { rerender } = render(
      <UpdateTendrilDialog {...base} onClose={() => {}} canSelfUpdate onUpdate={onUpdate} />,
    );
    fireEvent.click(screen.getByTestId("update-tendril-now"));
    rerender(
      <UpdateTendrilDialog
        {...base}
        onClose={() => {}}
        canSelfUpdate
        onUpdate={onUpdate}
        error="signature did not verify"
      />,
    );
    expect(screen.getByTestId("update-tendril-failed")).toHaveTextContent("Update Failed");
    fireEvent.click(screen.getByTestId("update-tendril-retry"));
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("cannot be dismissed while an update runs", () => {
    const onClose = vi.fn();
    render(<UpdateTendrilDialog {...base} onClose={onClose} canSelfUpdate progress={42} />);
    expect(screen.getByTestId("update-tendril-running")).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId("update-tendril-dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PlanRevisionSheet", () => {
  it('reads V1\'s "Plan not found or empty." for a blank revision', () => {
    render(<PlanRevisionSheet open onClose={() => {}} planId="00412" planTitle="P" revision="" />);
    expect(screen.getByTestId("pr-plan-sheet")).toHaveTextContent("Plan not found or empty.");
  });
});

describe("KpiBreakdownSheet", () => {
  const today = Math.floor(Date.UTC(2026, 8, 22) / 86_400_000);
  const data = {
    today,
    activity: null,
    shippedFeatures: [],
    mergedPrs: [],
    planCosts: [
      {
        planId: 7,
        title: "Unpriced",
        state: "Failed",
        created: "2026-09-21 10:00",
        cost: null,
        tokens: 5,
      },
    ],
    agentCosts: [],
  };

  it("has no panel for an id outside the four KPI cards, and stays closed", () => {
    expect(buildKpiBlade("usageWindow", data, i18n.getFixedT(null, "uiPanels"))).toBeNull();
    render(<KpiBreakdownSheet kpiId="usageWindow" data={data} onClose={() => {}} />);
    expect(screen.queryByTestId("kpi-breakdown")).not.toBeInTheDocument();
  });

  it("renders an unpriced plan cost as a dash, never $0.00", () => {
    render(<KpiBreakdownSheet kpiId="avgCostPlan" data={data} onClose={() => {}} />);
    const panel = screen.getByTestId("kpi-breakdown");
    expect(panel).toHaveTextContent("Unpriced");
    expect(panel.textContent).toContain("—");
    expect(panel.textContent).not.toContain("$0.00");
  });
});
