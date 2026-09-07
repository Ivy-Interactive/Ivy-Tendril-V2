import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ShellLayout } from "../src/views/ShellLayout";
import { App } from "../src/App";
import { uiStore } from "../src/state/uiStore";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";

describe("ShellLayout & App Chat Navigation Integration", () => {
  beforeEach(() => {
    vi.spyOn(bridge, "listPlans").mockResolvedValue([]);
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    uiStore.setActiveNav("dashboard");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Chat navigation item in ShellLayout sidebar", () => {
    const onSelectNavMock = vi.fn();

    render(
      <ShellLayout
        activeNav="dashboard"
        activeTabs={["dashboard"]}
        serviceInfo={null}
        connectionStatus="online"
        reconnectCountdown={0}
        onSelectNav={onSelectNavMock}
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onNewPlan={() => {}}
        onOpenShortcuts={() => {}}
        onReconnect={() => {}}
      >
        <div>Content</div>
      </ShellLayout>
    );

    const chatNavItem = screen.getByText("Chat");
    expect(chatNavItem).toBeInTheDocument();

    fireEvent.click(chatNavItem);
    expect(onSelectNavMock).toHaveBeenCalledWith("chat");
  });

  it("switches activeNav to chat on Cmd/Ctrl + Shift + C shortcut", async () => {
    render(<App />);

    expect(uiStore.getState().activeNav).toBe("dashboard");

    act(() => {
      fireEvent.keyDown(window, {
        key: "c",
        code: "KeyC",
        metaKey: true,
        shiftKey: true,
      });
    });

    expect(uiStore.getState().activeNav).toBe("chat");
  });
});
