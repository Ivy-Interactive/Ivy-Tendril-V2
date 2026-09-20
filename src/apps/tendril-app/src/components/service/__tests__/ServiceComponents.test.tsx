import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ServiceStatusBanner } from "../ServiceStatusBanner";
import { ServiceSettingsView } from "../ServiceSettingsView";
import type { ServiceInfo } from "../../../types/api";

const mockGetLogs = vi.fn();
const mockRestart = vi.fn();
const mockRepair = vi.fn();
const mockSwitchMode = vi.fn();
const mockInstall = vi.fn();
const mockUninstallAutostart = vi.fn();

// Each factory builds its own object: `vi.mock` is hoisted above every top-level binding, so a
// shared `const` here is a ReferenceError at mock time. The `vi.fn()`s above are fine - the factory
// only dereferences them when the component calls through.
vi.mock("@/api/bridge", () => ({
  bridge: {
    getServiceLogs: (...args: unknown[]) => mockGetLogs(...args),
    restartService: (...args: unknown[]) => mockRestart(...args),
    repairService: (...args: unknown[]) => mockRepair(...args),
    switchServiceMode: (...args: unknown[]) => mockSwitchMode(...args),
    installService: (...args: unknown[]) => mockInstall(...args),
    uninstallServiceAutostart: (...args: unknown[]) => mockUninstallAutostart(...args),
  },
}));

vi.mock("../../api/bridge", () => ({
  bridge: {
    getServiceLogs: (...args: unknown[]) => mockGetLogs(...args),
    restartService: (...args: unknown[]) => mockRestart(...args),
    repairService: (...args: unknown[]) => mockRepair(...args),
    switchServiceMode: (...args: unknown[]) => mockSwitchMode(...args),
    installService: (...args: unknown[]) => mockInstall(...args),
    uninstallServiceAutostart: (...args: unknown[]) => mockUninstallAutostart(...args),
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
    expect(screen.getByTestId("service-health-badge")).toHaveTextContent("Connected (Managed)");
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
    expect(screen.getByTestId("service-health-badge")).toHaveTextContent("Connected (External)");
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
      />,
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
    mockInstall.mockResolvedValue({
      installed: ["tendril", "opencode"],
      upToDate: [],
      missing: [],
      binDir: "/home/user/.tendril/bin",
      autostart: { kind: "registered", detail: "/home/user/Library/LaunchAgents/x.plist" },
      errors: [],
    });
    mockUninstallAutostart.mockResolvedValue("Removed the LaunchAgent at /home/user/x.plist.");
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

    render(<ServiceSettingsView serviceInfo={info} onRefreshHealth={refreshMock} />);

    expect(screen.getByTestId("service-settings-view")).toBeInTheDocument();
    expect(screen.getByText("4321")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("2026-09-06T12:00:00Z [INFO] Service started")).toBeInTheDocument();
      expect(screen.getByText(/REDACTED_BEARER_TOKEN/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Repair Service"));
    await waitFor(() => {
      expect(mockRepair).toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalled();
      expect(screen.getByText("Service repair completed successfully.")).toBeInTheDocument();
    });
  });

  it("installs the background service and reports what landed", async () => {
    const refreshMock = vi.fn().mockResolvedValue(undefined);
    render(<ServiceSettingsView serviceInfo={null} onRefreshHealth={refreshMock} />);

    fireEvent.click(screen.getByText("Install Background Service"));

    await waitFor(() => {
      expect(mockInstall).toHaveBeenCalled();
      // Both halves of the run are reported: the binaries and the autostart registration.
      expect(
        screen.getByText(/Installed tendril, opencode into \/home\/user\/\.tendril\/bin\./),
      ).toBeInTheDocument();
      expect(screen.getByText(/Registered to start with your session/)).toBeInTheDocument();
    });
  });

  it("reports a partial install rather than claiming success", async () => {
    // A run that copies nothing new, does not bundle the agent and fails to register: the operator
    // has to see all three, not a bare "done".
    mockInstall.mockResolvedValue({
      installed: [],
      upToDate: ["tendril"],
      missing: ["opencode"],
      binDir: "/home/user/.tendril/bin",
      autostart: { kind: "failed", detail: "LaunchAgents is not writable" },
      errors: ["failed to write the provisioning stamp: permission denied"],
    });

    render(<ServiceSettingsView serviceInfo={null} onRefreshHealth={vi.fn()} />);
    fireEvent.click(screen.getByText("Install Background Service"));

    await waitFor(() => {
      expect(screen.getByText(/tendril already up to date/)).toBeInTheDocument();
      expect(screen.getByText(/does not bundle opencode/)).toBeInTheDocument();
      expect(screen.getByText(/LaunchAgents is not writable/)).toBeInTheDocument();
      expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    });
  });

  it("disables start at login without touching the installed binaries", async () => {
    render(<ServiceSettingsView serviceInfo={null} onRefreshHealth={vi.fn()} />);

    fireEvent.click(screen.getByText("Disable Start at Login"));

    await waitFor(() => {
      expect(mockUninstallAutostart).toHaveBeenCalled();
      expect(screen.getByText(/Removed the LaunchAgent/)).toBeInTheDocument();
    });
  });
});
