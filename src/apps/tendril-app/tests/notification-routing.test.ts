import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BURST_WINDOW_MS } from "../src/state/notificationBurst";
import { notificationsStore } from "../src/state/notificationsStore";
import { bridge } from "../src/api/bridge";

const toast = vi.fn();
const sendNotification = vi.fn();
const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();

vi.mock("@ivy-interactive/components", () => ({
  toast: (...args: unknown[]) => toast(...args),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
}));

const exit = { title: "ExecutePlan Completed", message: "00638-Port", isSuccess: true };

/** The store reads the shell gate at delivery time, so the tests set it per case. */
function setDesktopShell(isDesktop: boolean): void {
  if (isDesktop) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: () => {} };
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
}

/**
 * Waits for a delivery to land. The store reaches both `toast` and the OS plugin through dynamic
 * `import()`, which vitest resolves on a macrotask — flushing microtasks never gets there, so the
 * wait has to be a real one. `vi.waitFor` drives the fake clock while it polls.
 */
async function waitForCalls(fn: typeof toast, count = 1): Promise<void> {
  await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(count));
}

/** Closes the burst window so the summarizer flushes. */
function flushBurst(): void {
  vi.advanceTimersByTime(BURST_WINDOW_MS);
}

describe("notificationsStore routing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.mockReset();
    sendNotification.mockReset();
    isPermissionGranted.mockReset().mockResolvedValue(true);
    requestPermission.mockReset().mockResolvedValue("granted");
    notificationsStore.dispose();
  });

  afterEach(() => {
    notificationsStore.dispose();
    setDesktopShell(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function init(desktopNotifications?: boolean): Promise<void> {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(
      desktopNotifications === undefined ? {} : { desktopNotifications },
    );
    await notificationsStore.init();
  }

  it("sends an OS notification and no toast when the setting is on and permission granted", async () => {
    setDesktopShell(true);
    await init(true);

    notificationsStore.notifyJobExit(exit);
    flushBurst();
    await waitForCalls(sendNotification);

    expect(sendNotification).toHaveBeenCalledWith({
      title: "ExecutePlan Completed",
      body: "00638-Port",
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it("defaults an absent setting to on, matching the legacy shell", async () => {
    setDesktopShell(true);
    await init(undefined);

    expect(notificationsStore.isDesktopNotificationsEnabled()).toBe(true);

    notificationsStore.notifyJobExit(exit);
    flushBurst();
    await waitForCalls(sendNotification);

    expect(toast).not.toHaveBeenCalled();
  });

  it("toasts and sends nothing to the OS when the setting is off", async () => {
    setDesktopShell(true);
    await init(false);

    notificationsStore.notifyJobExit(exit);
    flushBurst();
    await waitForCalls(toast);

    expect(toast).toHaveBeenCalledWith({
      title: "ExecutePlan Completed",
      description: "00638-Port",
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("falls back to a toast when the OS permission is denied", async () => {
    // The one intentional divergence from upstream, where a denied permission meant silence.
    setDesktopShell(true);
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");
    await init(true);

    notificationsStore.notifyJobExit(exit);
    flushBurst();
    await waitForCalls(toast);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("falls back to a toast when sendNotification throws", async () => {
    setDesktopShell(true);
    sendNotification.mockImplementation(() => {
      throw new Error("plugin notification not found");
    });
    await init(true);

    notificationsStore.notifyJobExit(exit);
    flushBurst();
    await waitForCalls(toast);

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("toasts in a browser-served build even with the setting on", async () => {
    setDesktopShell(false);
    await init(true);

    notificationsStore.notifyJobExit(exit);
    flushBurst();
    await waitForCalls(toast);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("always toasts notifyError, whatever the setting, without waiting for the window", async () => {
    setDesktopShell(true);
    await init(true);

    notificationsStore.notifyError("Execute refused: dependency unmet");
    await waitForCalls(toast);

    expect(toast).toHaveBeenCalledWith({
      title: "Error",
      description: "Execute refused: dependency unmet",
      variant: "destructive",
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("always toasts notifySuccess without waiting for the window", async () => {
    setDesktopShell(true);
    await init(true);

    notificationsStore.notifySuccess("Saved", "Notification settings saved");
    await waitForCalls(toast);

    expect(toast).toHaveBeenCalledWith({
      title: "Saved",
      description: "Notification settings saved",
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("changes routing on setDesktopNotifications without a re-init", async () => {
    setDesktopShell(true);
    await init(true);

    notificationsStore.setDesktopNotifications(false);
    notificationsStore.notifyJobExit(exit);
    flushBurst();
    await waitForCalls(toast);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("keeps notifying when the config read fails", async () => {
    setDesktopShell(false);
    vi.spyOn(bridge, "getConfig").mockRejectedValue(new Error("daemon unreachable"));

    await notificationsStore.init();
    notificationsStore.notifyJobExit(exit);
    flushBurst();
    await waitForCalls(toast);
  });
});
