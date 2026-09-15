import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * Port of `SettingsApp`'s root setup views. Each section saves on its own, its Save stays disabled
 * until that section changes (`hasChanges` in every V1 setup view), and `jobTimeout` is minutes -
 * `TendrilSettings::job_timeout` is documented as minutes, unlike `daemonRequestTimeout`.
 */

const baseConfig: TendrilConfig = {
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
  raw: { staleOutputTimeout: 10, beta: false, themeMode: "system" },
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

async function renderSettings(onRefreshHealth = vi.fn()) {
  await act(async () => {
    render(<SettingsView serviceInfo={serviceInfo} onRefreshHealth={onRefreshHealth} />);
  });
}

/** The Save inside one section card, since every section now carries its own. */
const saveIn = (testId: string) => {
  const card = screen.getByTestId(testId);
  const button = Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Save");
  if (!button) throw new Error(`No Save button in ${testId}`);
  return button;
};

const submitIn = async (testId: string) => {
  await act(async () => {
    fireEvent.click(saveIn(testId));
  });
};

describe("SettingsView", () => {
  let getConfig: ReturnType<typeof vi.spyOn>;
  let putConfig: ReturnType<typeof vi.spyOn>;
  let saveUiState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getConfig = vi.spyOn(bridge, "getConfig").mockResolvedValue({ ...baseConfig });
    putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    saveUiState = vi.spyOn(bridge, "saveUiState").mockResolvedValue(undefined);
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
    vi.restoreAllMocks();
  });

  it("offers every agent `build_agent_spec` can launch, in V1's order", async () => {
    await renderSettings();

    const labels = Array.from(
      screen.getByTestId("coding-agent-card").querySelectorAll("[data-testid^='coding-agent-']"),
    ).map((el) => el.textContent?.trim());

    expect(labels).toEqual(["Claude", "Copilot", "Codex", "Gemini", "Antigravity", "OpenCode"]);
    expect(screen.getByTestId("coding-agent-claude")).toHaveAttribute("aria-pressed", "true");
  });

  it("writes a changed field to config.yaml via putConfig, never saveUiState", async () => {
    await renderSettings();

    fireEvent.click(screen.getByTestId("coding-agent-gemini"));
    await submitIn("coding-agent-card");

    expect(putConfig).toHaveBeenCalledWith("codingAgent", "gemini");
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(saveUiState).not.toHaveBeenCalled();
  });

  it("keeps each section's Save disabled until that section changes", async () => {
    await renderSettings();

    expect(saveIn("coding-agent-card")).toBeDisabled();
    expect(saveIn("advanced-settings-card")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Job Timeout"), { target: { value: "45" } });

    expect(saveIn("advanced-settings-card")).toBeEnabled();
    // A change in one section does not arm another section's Save.
    expect(saveIn("coding-agent-card")).toBeDisabled();
  });

  it("writes only the advanced keys that changed, and job timeout in minutes", async () => {
    await renderSettings();

    fireEvent.change(screen.getByLabelText("Job Timeout"), { target: { value: "45" } });
    await submitIn("advanced-settings-card");

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith("jobTimeout", 45);
  });

  it("surfaces a rejected save as an error, not a success message", async () => {
    putConfig.mockRejectedValue(new Error("Failed to update config: Merged config is invalid"));
    await renderSettings();

    fireEvent.click(screen.getByTestId("coding-agent-gemini"));
    await submitIn("coding-agent-card");

    expect(
      screen.getByText(/Failed to update config: Merged config is invalid/),
    ).toBeInTheDocument();
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("re-reads config from disk after a successful save", async () => {
    getConfig
      .mockResolvedValueOnce({ ...baseConfig })
      .mockResolvedValueOnce({ ...baseConfig, maxConcurrentJobs: 8 });

    await renderSettings();

    fireEvent.change(screen.getByLabelText("Max Concurrent Jobs"), { target: { value: "8" } });
    await submitIn("advanced-settings-card");

    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Max Concurrent Jobs")).toHaveValue(8);
    expect(saveIn("advanced-settings-card")).toBeDisabled();
  });

  it("saves the appearance mode on the click, under V1's themeMode key", async () => {
    await renderSettings();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Light" }));
    });

    expect(putConfig).toHaveBeenCalledWith("themeMode", "light");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  it("defaults the appearance mode to System when config.yaml does not mention it", async () => {
    getConfig.mockResolvedValue({ ...baseConfig, raw: {} });
    await renderSettings();

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves the plan template on its own", async () => {
    await renderSettings();

    fireEvent.change(screen.getByLabelText("Plan Template"), { target: { value: "## Goal" } });
    await submitIn("plans-settings-card");

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith("planTemplate", "## Goal");
  });
});
