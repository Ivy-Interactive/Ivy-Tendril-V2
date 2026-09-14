import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

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

const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText("Save Preferences"));
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

  it("writes a changed field to config.yaml via putConfig, never saveUiState", async () => {
    await renderSettings();

    fireEvent.change(screen.getByLabelText("Coding Agent CLI"), {
      target: { value: "gemini" },
    });
    await submit();

    expect(putConfig).toHaveBeenCalledWith("codingAgent", "gemini");
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(saveUiState).not.toHaveBeenCalled();
  });

  it("does not write unchanged fields", async () => {
    await renderSettings();

    fireEvent.change(screen.getByLabelText("Job Timeout (seconds)"), {
      target: { value: "3600" },
    });
    await submit();

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith("jobTimeout", 3600);
  });

  it("surfaces a rejected save as an error, not a success message", async () => {
    putConfig.mockRejectedValue(new Error("Failed to update config: Merged config is invalid"));
    await renderSettings();

    fireEvent.change(screen.getByLabelText("Coding Agent CLI"), {
      target: { value: "gemini" },
    });
    await submit();

    expect(
      screen.getByText(/Failed to update config: Merged config is invalid/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Configuration saved to config.yaml.")).not.toBeInTheDocument();
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("re-reads config from disk after a successful save", async () => {
    getConfig
      .mockResolvedValueOnce({ ...baseConfig })
      .mockResolvedValueOnce({ ...baseConfig, maxConcurrentJobs: 8 });

    await renderSettings();

    fireEvent.change(screen.getByLabelText("Max Concurrent Jobs"), {
      target: { value: "8" },
    });
    await submit();

    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Max Concurrent Jobs")).toHaveValue(8);
  });
});
