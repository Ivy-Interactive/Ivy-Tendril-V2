import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ServiceStatusBanner } from "../ServiceStatusBanner";
import { ServiceSettingsView } from "../ServiceSettingsView";
import type { ServiceInfo } from "../../../types/api";

const mockGetLogs = vi.fn();
const mockRestart = vi.fn();
const mockRepair = vi.fn();
const mockSwitchMode = vi.fn();

vi.mock("@/api/bridge", () => ({
  bridge: {
    getServiceLogs: (...args: unknown[]) => mockGetLogs(...args),
    restartService: (...args: unknown[]) => mockRestart(...args),
    repairService: (...args: unknown[]) => mockRepair(...args),
    switchServiceMode: (...args: unknown[]) => mockSwitchMode(...args),
  },
}));

vi.mock("../../api/bridge", () => ({
  bridge: {
    getServiceLogs: (...args: unknown[]) => mockGetLogs(...args),
    restartService: (...args: unknown[]) => mockRestart(...args),
    repairService: (...args: unknown[]) => mockRepair(...args),
    switchServiceMode: (...args: unknown[]) => mockSwitchMode(...args),
  },
}));

describe("ServiceStatusBanner", () => {
  it("renders live health badge for Connected (Managed)", () => {
    const info: ServiceInfo = {
      state: "Connected",
      tendrilHome: "/home/user/.tendril",
      port: 5010,
      host: "127.0.0.1",
      ownership: "Managed",
      statusBadge: "Connected (Managed)",
      capabilities: ["plans"],
      message: "Online",
    };

    render(<ServiceStatusBanner serviceInfo={info} />);
    expect(screen.getByTestId("service-health-badge")).toHaveTextContent(
      "Connected (Managed)"
    );
    expect(screen.getByText("Managed")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:5010")).toBeInTheDocument();
  });

  it("renders live health badge for Connected (External)", () => {
    const info: ServiceInfo = {
      state: "Connected",
      tendrilHome: "/home/user/.tendril",
      port: 5010,
      host: "127.0.0.1",
      ownership: "AdoptedExternal",
      statusBadge: "Connected (External)",
      capabilities: ["plans"],
      message: "Online",
    };

    render(<ServiceStatusBanner serviceInfo={info} />);
    expect(screen.getByTestId("service-health-badge")).toHaveTextContent(
      "Connected (External)"
    );
  });

  it("calls restart, repair, and diagnostics callbacks", () => {
    const onRestart = vi.fn();
    const onRepair = vi.fn();
    const onViewDiagnostics = vi.fn();

    const info: ServiceInfo = {
      state: "Disconnected",
      tendrilHome: "/home/user/.tendril",
      capabilities: [],
      message: "Offline",
      statusBadge: "Disconnected",
    };

    render(
      <ServiceStatusBanner
        serviceInfo={info}
        onRestart={onRestart}
        onRepair={onRepair}
        onViewDiagnostics={onViewDiagnostics}
      />
    );

    fireEvent.click(screen.getByText("Restart Service"));
    expect(onRestart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Repair Service"));
    expect(onRepair).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Diagnostics"));
    expect(onViewDiagnostics).toHaveBeenCalledTimes(1);
  });
});

describe("ServiceSettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogs.mockResolvedValue([
      "2026-09-06T12:00:00Z [INFO] Service started",
      "2026-09-06T12:00:01Z [INFO] Bearer [REDACTED_BEARER_TOKEN] authenticated",
    ]);
    mockRestart.mockResolvedValue({});
    mockRepair.mockResolvedValue("Service repair completed successfully.");
    mockSwitchMode.mockResolvedValue({});
  });

  it("renders service details, logs, and triggers actions", async () => {
    const info: ServiceInfo = {
      state: "Connected",
      tendrilHome: "/home/user/.tendril",
      port: 5010,
      host: "127.0.0.1",
      pid: 4321,
      ownership: "Managed",
      statusBadge: "Connected (Managed)",
      crashCount: 0,
      capabilities: ["plans"],
      message: "Daemon ready",
    };

    const refreshMock = vi.fn().mockResolvedValue(undefined);

    render(
      <ServiceSettingsView
        serviceInfo={info}
        onRefreshHealth={refreshMock}
      />
    );

    expect(screen.getByTestId("service-settings-view")).toBeInTheDocument();
    expect(screen.getByText("4321")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("2026-09-06T12:00:00Z [INFO] Service started")
      ).toBeInTheDocument();
      expect(screen.getByText(/REDACTED_BEARER_TOKEN/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Repair Service"));
    await waitFor(() => {
      expect(mockRepair).toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalled();
      expect(
        screen.getByText("Service repair completed successfully.")
      ).toBeInTheDocument();
    });
  });
});
