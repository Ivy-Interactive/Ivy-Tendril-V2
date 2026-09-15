import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { notificationsStore } from "../src/state/notificationsStore";
import { bridge } from "../src/api/bridge";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/** Port of `NotificationsSetupView`: the one setting, its default, and what saving it does. */

const baseConfig: TendrilConfig = {
  codingAgent: "claude",
  jobTimeout: 1800,
  maxConcurrentJobs: 4,
  theme: "dark",
};

const serviceInfo: ServiceInfo = {
  state: "Connected",
  tendrilHome: "/home/user/.tendril",
  port: 5010,
  host: "127.0.0.1",
  capabilities: ["plans"],
  message: "Online",
};

const checkbox = () =>
  screen.getByLabelText(/Enable Desktop Notifications/) as HTMLInputElement;

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText("Save Notification Settings"));
  });
};

describe("SettingsView notifications card", () => {
  let putConfig: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue({
      source: "static",
      totalModelCount: 0,
      dynamicModelCount: 0,
      staticModelCount: 0,
      enrichModels: false,
      cachedAt: null,
      cachePath: "/home/user/.tendril/models.json",
    });
    vi.spyOn(bridge, "getServiceLogs").mockResolvedValue([]);
  });

  afterEach(() => {
    notificationsStore.dispose();
    vi.restoreAllMocks();
  });

  async function renderWith(config: TendrilConfig) {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(config);
    await act(async () => {
      render(<SettingsView serviceInfo={serviceInfo} onRefreshHealth={vi.fn()} />);
    });
  }

  it("shows the setting as on when config.yaml does not mention it", async () => {
    await renderWith({ ...baseConfig });

    expect(checkbox().checked).toBe(true);
    expect(
      screen.getByText(
        "Configure how Tendril notifies you about job completions, failures, and other events.",
      ),
    ).toBeTruthy();
  });

  it("shows the setting as off when config.yaml disables it", async () => {
    await renderWith({ ...baseConfig, desktopNotifications: false });

    expect(checkbox().checked).toBe(false);
  });

  it("writes only desktopNotifications and tells the store, so routing follows at once", async () => {
    await renderWith({ ...baseConfig });
    const setDesktopNotifications = vi.spyOn(notificationsStore, "setDesktopNotifications");
    const notifySuccess = vi.spyOn(notificationsStore, "notifySuccess");

    fireEvent.click(checkbox());
    await save();

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith("desktopNotifications", false);
    expect(setDesktopNotifications).toHaveBeenCalledWith(false);
    expect(notifySuccess).toHaveBeenCalledWith("Saved", "Notification settings saved");
  });

  it("re-enables the setting from off", async () => {
    await renderWith({ ...baseConfig, desktopNotifications: false });

    fireEvent.click(checkbox());
    await save();

    expect(putConfig).toHaveBeenCalledWith("desktopNotifications", true);
  });

  it("reports a failed write and leaves the store alone", async () => {
    await renderWith({ ...baseConfig });
    putConfig.mockRejectedValue(new Error("daemon unreachable"));
    const setDesktopNotifications = vi.spyOn(notificationsStore, "setDesktopNotifications");

    fireEvent.click(checkbox());
    await save();

    expect(screen.getByText(/Failed to save/)).toBeTruthy();
    expect(setDesktopNotifications).not.toHaveBeenCalled();
    // The box keeps the operator's choice: retrying should not need it ticked again.
    expect(checkbox().checked).toBe(false);
  });

  it("does not save notifications from the preferences form", async () => {
    await renderWith({ ...baseConfig });

    fireEvent.click(checkbox());
    await act(async () => {
      fireEvent.click(screen.getByText("Save Preferences"));
    });

    expect(putConfig).not.toHaveBeenCalled();
  });
});
