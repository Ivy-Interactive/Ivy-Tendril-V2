import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { THEME_PRESET_STYLE_ID } from "@ivy-interactive/components/theme";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import { initAppearance, readAppearance } from "../src/state/appearance";
import { uiStore } from "../src/state/uiStore";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * `Apps/Settings/AppearanceSetupView.cs`: the theme mode row, the theme preset select with its preview
 * swatches, and the main sidebar default. Every one applies and persists on the click - V1 has no Save
 * in this pane - and each is read back at start-up, which is the half that makes them settings rather
 * than session state.
 */

const baseConfig: TendrilConfig = {
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
  raw: { staleOutputTimeout: 10, beta: false, themeMode: "system", theme: "default" },
};

const serviceInfo: ServiceInfo = {
  state: "Connected",
  tendrilHome: "/home/user/.tendril",
  port: 5010,
  host: "127.0.0.1",
  ownership: "Managed",
  statusBadge: "Connected (Managed)",
  capabilities: ["plans"],
  message: "Online",
};

const presetStyle = () => document.getElementById(THEME_PRESET_STYLE_ID);

async function renderAppearance() {
  await act(async () => {
    render(
      <SettingsView
        serviceInfo={serviceInfo}
        onRefreshHealth={vi.fn()}
        initialSection="appearance"
      />,
    );
  });
}

describe("Settings / Appearance", () => {
  let putConfig: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ ...baseConfig });
    putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    presetStyle()?.remove();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    presetStyle()?.remove();
  });

  it("offers every shipped preset, in TendrilThemes.BuiltInThemes order", async () => {
    await renderAppearance();

    const select = screen.getByLabelText("Theme") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "default",
      "cupcake",
      "cyberpunk",
      "synthwave",
      "retro",
      "dracula",
      "nord",
      "forest",
      "aqua",
      "valentine",
      "sunset",
      "coffee",
      "dim",
      "luxury",
      "lovably",
      "hellokitty",
    ]);
    expect(select.value).toBe("default");
  });

  /**
   * `UseEffect(... selectedTheme)`: choosing a preset applies it, writes `theme` and toasts
   * "Theme set to {Name}". Applying it means a stylesheet, the way `ApplyTheme` hands one to the
   * client - not per-element styles that a later render would drop.
   */
  it("applies and persists a preset on the change", async () => {
    await renderAppearance();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dracula" } });
    });

    expect(putConfig).toHaveBeenCalledWith("theme", "dracula");
    expect(presetStyle()?.textContent).toContain("--primary: #bd93f9;");
    // Both halves are installed at once, so a light/dark flip needs no re-application.
    expect(presetStyle()?.textContent).toContain("html.dark:root {");
  });

  /** `PreviewColors`: four swatches, and they follow the selection rather than the saved value. */
  it("previews the selected preset's colours", async () => {
    await renderAppearance();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "nord" } });
    });

    const swatches = Array.from(
      screen.getByTestId("theme-swatches").querySelectorAll("[data-color]"),
    ).map((el) => el.getAttribute("data-color"));
    expect(swatches).toEqual(["#88c0d0", "#81a1c1", "#5e81ac", "#2e3440"]);
  });

  it("rolls the applied preset back when the write fails", async () => {
    putConfig.mockRejectedValue(new Error("disk full"));
    await renderAppearance();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "forest" } });
    });

    expect(screen.getByLabelText("Theme")).toHaveValue("default");
    expect(presetStyle()).toBeNull();
    expect(screen.getByTestId("appearance-card")).toHaveTextContent("Failed to save");
  });

  it("saves the appearance mode on the click, under V1's themeMode key", async () => {
    await renderAppearance();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Light" }));
    });

    expect(putConfig).toHaveBeenCalledWith("themeMode", "light");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  /** `Settings.SidebarOpen`, whose toast says "by default" because that is all it sets. */
  it("writes the main sidebar default and shows what config.yaml holds", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue({
      ...baseConfig,
      raw: { ...baseConfig.raw, sidebarOpen: false },
    });
    await renderAppearance();

    expect(screen.getByRole("button", { name: "Collapsed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Expanded" }));
    });
    expect(putConfig).toHaveBeenCalledWith("sidebarOpen", true);
  });

  /**
   * The start-up half. V1's shell calls `ApplyTheme`/`ApplyThemeMode` per session, so a preset chosen
   * here survives a restart; without this the setting would only apply to the session that set it.
   */
  it("applies the saved preset at start-up", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue({
      ...baseConfig,
      raw: { ...baseConfig.raw, theme: "cupcake", themeMode: "dark" },
    });

    await initAppearance();

    expect(presetStyle()?.textContent).toContain("--primary: #65c3c8;");
  });

  it("reads V1's defaults for the keys config.yaml does not mention", () => {
    expect(readAppearance({ raw: {} })).toEqual({
      themeMode: "system",
      theme: "default",
      sidebarOpen: true,
    });
    // `ValidateSettings` falls back to `system` for anything but light or dark.
    expect(readAppearance({ raw: { themeMode: "solarized" } }).themeMode).toBe("system");
  });

  /**
   * `TendrilAppShell` seeds the sidebar from `SidebarOpen` on every build and never writes a runtime
   * toggle back, so the configured value wins over whatever the last session left behind.
   */
  it("seeds the shell's sidebar from the configured default, over the persisted flag", async () => {
    vi.spyOn(bridge, "loadUiState").mockResolvedValue(JSON.stringify({ sidebarCollapsed: false }));
    vi.spyOn(bridge, "saveUiState").mockResolvedValue(undefined);
    vi.spyOn(bridge, "getConfig").mockResolvedValue({
      ...baseConfig,
      raw: { ...baseConfig.raw, sidebarOpen: false },
    });

    await uiStore.init();

    expect(uiStore.getState().sidebarCollapsed).toBe(true);
  });
});
