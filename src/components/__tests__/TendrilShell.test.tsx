import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TendrilApp } from "../TendrilShellContainer";
import type { DaemonStatusResponse } from "@/api/dtos";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("TendrilApp Component Lifecycle", () => {
  it("renders onboarding state when daemon is not running", () => {
    const status: DaemonStatusResponse = {
      state: "NotRunning",
      tendrilHome: "/Users/rorychatt/.tendril",
      capabilities: [],
      message: "Tendril daemon metadata (.master) not found",
    };

    render(<TendrilApp initialStatus={status} />);

    expect(screen.getByTestId("onboarding-state")).toBeInTheDocument();
    expect(screen.getByText("Tendril Service Not Detected")).toBeInTheDocument();
    expect(screen.getByText("/Users/rorychatt/.tendril")).toBeInTheDocument();
    expect(screen.getByText("tendril serve")).toBeInTheDocument();
  });

  it("renders auth error state when credentials rejected", () => {
    const status: DaemonStatusResponse = {
      state: "Unauthenticated",
      tendrilHome: "/Users/rorychatt/.tendril",
      port: 5010,
      capabilities: [],
      message: "Daemon rejected authentication credentials",
    };

    render(<TendrilApp initialStatus={status} />);

    expect(screen.getByTestId("auth-error-state")).toBeInTheDocument();
    expect(screen.getByText("Authentication Failed")).toBeInTheDocument();
  });

  it("renders connected state with TendrilShell when daemon online", () => {
    const status: DaemonStatusResponse = {
      state: "Connected",
      tendrilHome: "/Users/rorychatt/.tendril",
      port: 5010,
      host: "127.0.0.1",
      scheme: "http",
      secret: "token123",
      pid: 1234,
      apiVersion: 1,
      capabilities: ["plans", "jobs"],
      message: "Daemon is online and healthy",
    };

    render(<TendrilApp initialStatus={status} />);

    expect(screen.getByTestId("connected-state")).toBeInTheDocument();
    expect(screen.getByText("Tendril Desktop")).toBeInTheDocument();
  });
});
