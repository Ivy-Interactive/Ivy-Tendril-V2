import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { notificationsStore } from "../src/state/notificationsStore";
import { bridge } from "../src/api/bridge";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * Port of `NotificationsSetupView`: the one setting, its default, and what saving it does. The
 * control is a switch (`ToSwitchInput`) and its Save is labelled "Save" and gated on `hasChanges`.
 *
 * `SettingsApp` renders only the selected sidebar row's view, so these open the Notifications
 * section with `initialSection` - V1's `SettingsAppArgs.Section`.
 */

const baseConfig: TendrilConfig = {
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
};

const serviceInfo: ServiceInfo = {
  state: "Connected",
  tendrilHome: "/home/user/.tendril",
  port: 5010,
  host: "127.0.0.1",
  capabilities: ["plans"],
  message: "Online",
};

const toggle = () => screen.getByRole("switch", { name: /Enable Desktop Notifications/ });

const isOn = () => toggle().getAttribute("aria-checked") === "true";

const saveButton = () => {
  const card = screen.getByTestId("notifications-card");
  const button = Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Save");
  if (!button) throw new Error("No Save button in the notifications card");
  return button;
};

const save = async () => {
  await act(async () => {
    fireEvent.click(saveButton());
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

  async function renderWith(config: TendrilConfig, section = "notifications") {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(config);
    await act(async () => {
      render(
        <SettingsView
          serviceInfo={serviceInfo}
          onRefreshHealth={vi.fn()}
          initialSection={section}
        />,
      );
    });
  }

  it("shows the setting as on when config.yaml does not mention it", async () => {
    await renderWith({ ...baseConfig });

    expect(isOn()).toBe(true);
    expect(
      screen.getByText(
        "Configure how Tendril notifies you about job completions, failures, and other events.",
      ),
    ).toBeTruthy();
  });

  it("shows the setting as off when config.yaml disables it", async () => {
    await renderWith({ ...baseConfig, desktopNotifications: false });

    expect(isOn()).toBe(false);
  });

  it("writes only desktopNotifications and tells the store, so routing follows at once", async () => {
    await renderWith({ ...baseConfig });
    const setDesktopNotifications = vi.spyOn(notificationsStore, "setDesktopNotifications");
    const notifySuccess = vi.spyOn(notificationsStore, "notifySuccess");

    fireEvent.click(toggle());
    await save();

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith("desktopNotifications", false);
    expect(setDesktopNotifications).toHaveBeenCalledWith(false);
    expect(notifySuccess).toHaveBeenCalledWith("Saved", "Notification settings saved");
  });

  it("re-enables the setting from off", async () => {
    await renderWith({ ...baseConfig, desktopNotifications: false });

    fireEvent.click(toggle());
    await save();

    expect(putConfig).toHaveBeenCalledWith("desktopNotifications", true);
  });

  it("reports a failed write and leaves the store alone", async () => {
    await renderWith({ ...baseConfig });
    putConfig.mockRejectedValue(new Error("daemon unreachable"));
    const setDesktopNotifications = vi.spyOn(notificationsStore, "setDesktopNotifications");

    fireEvent.click(toggle());
    await save();

    expect(screen.getByText(/Failed to save/)).toBeTruthy();
    expect(setDesktopNotifications).not.toHaveBeenCalled();
    // The switch keeps the operator's choice: retrying should not need it flipped again.
    expect(isOn()).toBe(false);
  });

  it("does not save notifications from another section's Save", async () => {
    await renderWith({ ...baseConfig });

    fireEvent.click(toggle());
    // Only one section renders at a time, so Advanced is reached through its sidebar row.
    await act(async () => {
      fireEvent.click(screen.getByTestId("settings-row-advanced"));
    });
    const advanced = screen.getByTestId("advanced-settings-card");
    const advancedSave = Array.from(advanced.querySelectorAll("button")).find(
      (b) => b.textContent === "Save",
    );
    // Nothing in Advanced changed, so V1's `hasChanges` gate leaves its Save disabled.
    expect(advancedSave).toBeDisabled();
    await act(async () => {
      fireEvent.click(advancedSave!);
    });

    expect(putConfig).not.toHaveBeenCalled();
  });

  it("keeps Save disabled until the setting is flipped", async () => {
    await renderWith({ ...baseConfig });

    expect(saveButton()).toBeDisabled();
    fireEvent.click(toggle());
    expect(saveButton()).toBeEnabled();
  });
});
