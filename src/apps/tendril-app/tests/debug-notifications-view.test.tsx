import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DebugView } from "../src/views/debug/DebugView";
import { notificationsStore } from "../src/state/notificationsStore";
import { APP_DESCRIPTORS, isFullBleedApp } from "../src/state/navigation";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => {
  cleanup();
  notificationsStore.dispose();
  vi.restoreAllMocks();
});

/**
 * The debug page, now a notifications bench rather than V1's dialog harness.
 *
 * The dialogs moved to Storybook, where a story is both what a person looks at and what
 * `dialog-stories.test.tsx` renders. What stayed is the part Storybook cannot do: firing a real
 * notification through the real routing, where the destination depends on whether this is the
 * desktop shell and whether the setting is on.
 */
describe("debug page registration", () => {
  it("is registered as an app, so the shell can title its tab", () => {
    expect(APP_DESCRIPTORS.debug).toBeDefined();
    expect(APP_DESCRIPTORS.debug.title).toBe("Debug");
  });

  it("takes the shell's inset rather than supplying its own", () => {
    expect(isFullBleedApp("debug")).toBe(false);
  });

  it("stays out of the nav, the way V1 marks it `isVisible: false`", async () => {
    // V2 has no `isVisible` field: an app hides by being absent from `buildNavItems`. Asserting on
    // the built nav rather than on a flag is what actually keeps it hidden.
    const { buildNavItems } = await import("../src/views/ShellLayout");
    const ids = buildNavItems("plans", {
      draftCount: 0,
      reviewCount: 0,
      inboxCount: 0,
      chatCount: 0,
      recommendationCount: 0,
      onSelectNav: () => {},
    } as never).map((item: { id: string }) => item.id);

    expect(ids).not.toContain("debug");
  });
});

describe("DebugView notifications bench", () => {
  it("reports where a notification would go, from the same inputs the router uses", () => {
    render(<DebugView />);

    // jsdom is not the Tauri shell, so this is the browser branch: always an in-app toast,
    // whatever the setting says.
    expect(screen.getByTestId("debug-shell")).toHaveTextContent("browser");
    expect(screen.getByTestId("debug-route")).toHaveTextContent("in-app toast");
  });

  it("follows the setting the store actually holds", () => {
    notificationsStore.setDesktopNotifications(false);
    render(<DebugView />);

    expect(screen.getByTestId("debug-setting")).toHaveTextContent("off");
  });

  it("fires a success notification through the store", () => {
    const notifySuccess = vi.spyOn(notificationsStore, "notifySuccess");
    render(<DebugView />);

    fireEvent.click(screen.getByTestId("debug-notify-success"));

    expect(notifySuccess).toHaveBeenCalledWith("Saved", "Notification settings saved");
  });

  it("fires an error notification through the store", () => {
    const notifyError = vi.spyOn(notificationsStore, "notifyError");
    render(<DebugView />);

    fireEvent.click(screen.getByTestId("debug-notify-error"));

    expect(notifyError).toHaveBeenCalled();
  });

  it("sends a job exit down the coalescing path, not the toast path", () => {
    const notifyJobExit = vi.spyOn(notificationsStore, "notifyJobExit");
    const notifySuccess = vi.spyOn(notificationsStore, "notifySuccess");
    render(<DebugView />);

    fireEvent.click(screen.getByTestId("debug-notify-job-exit"));

    // The distinction is the point of the bench: job exits are summarized, operator confirmations
    // are not. A button wired to the wrong one would look identical on screen.
    expect(notifyJobExit).toHaveBeenCalledWith(
      expect.objectContaining({ isSuccess: true, title: "ExecutePlan finished" }),
    );
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("marks a job failure as unsuccessful", () => {
    const notifyJobExit = vi.spyOn(notificationsStore, "notifyJobExit");
    render(<DebugView />);

    fireEvent.click(screen.getByTestId("debug-notify-job-failure"));

    expect(notifyJobExit).toHaveBeenCalledWith(expect.objectContaining({ isSuccess: false }));
  });

  it("sends five at once so the burst summarizer has something to coalesce", () => {
    const notifyJobExit = vi.spyOn(notificationsStore, "notifyJobExit");
    render(<DebugView />);

    fireEvent.click(screen.getByTestId("debug-notify-burst"));

    expect(notifyJobExit).toHaveBeenCalledTimes(5);
    // One of the five fails, so the summary has both outcomes to describe rather than one.
    const outcomes = notifyJobExit.mock.calls.map(([n]) => (n as { isSuccess: boolean }).isSuccess);
    expect(outcomes.filter(Boolean)).toHaveLength(4);
    expect(outcomes.filter((ok) => !ok)).toHaveLength(1);
  });

  it("says where the dialogs went, so nobody looks for the old harness here", () => {
    render(<DebugView />);

    expect(screen.getByText(/Dialogs and sheets live in Storybook/)).toBeInTheDocument();
  });
});
