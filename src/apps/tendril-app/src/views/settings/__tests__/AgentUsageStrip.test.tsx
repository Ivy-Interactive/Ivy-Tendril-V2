import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { AgentUsageStrip } from "../AgentUsageStrip";
import { resetAgentProbeTransports, setAgentProbeTransports } from "../../../api/agentsApi";
import type { AgentUsageSnapshot } from "../../../types/agents";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const NOW = new Date("2026-09-19T12:00:00Z");
const now = () => NOW;

function snapshot(overrides: Partial<AgentUsageSnapshot> = {}): AgentUsageSnapshot {
  return {
    agentId: "claude",
    capturedAt: "2026-09-19T11:59:00Z",
    windows: [
      {
        windowMinutes: 300,
        usedPercent: 40,
        remainingPercent: 60,
        resetsAt: "2026-09-19T14:05:00Z",
      },
      {
        windowMinutes: 10080,
        usedPercent: 92,
        remainingPercent: 8,
        resetsAt: "2026-09-22T12:00:00Z",
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  resetAgentProbeTransports();
  vi.restoreAllMocks();
});

describe("AgentUsageStrip", () => {
  it("draws both windows with their countdowns", async () => {
    setAgentProbeTransports({ agentUsage: vi.fn().mockResolvedValue(snapshot()) });

    render(<AgentUsageStrip agent="claude" nowFn={now} />);

    await screen.findByTestId("agent-usage-strip");
    expect(screen.getByText("5h window")).toBeTruthy();
    expect(screen.getByText("60% left")).toBeTruthy();
    expect(screen.getByText("resets in 2h 05m")).toBeTruthy();
    expect(screen.getByText("7d window")).toBeTruthy();
    expect(screen.getByText("8% left")).toBeTruthy();
  });

  it("colours a nearly exhausted window destructive and a low one warning", async () => {
    setAgentProbeTransports({
      agentUsage: vi.fn().mockResolvedValue(
        snapshot({
          windows: [
            { windowMinutes: 300, usedPercent: 95, remainingPercent: 5 },
            { windowMinutes: 10080, usedPercent: 80, remainingPercent: 20 },
          ],
        }),
      ),
    });

    render(<AgentUsageStrip agent="claude" nowFn={now} />);

    await screen.findByTestId("agent-usage-strip");
    expect(screen.getByText("5% left").className).toContain("text-destructive");
    expect(screen.getByText("20% left").className).toContain("text-warning");
  });

  it("shows only the first two windows, however many the provider reports", async () => {
    setAgentProbeTransports({
      agentUsage: vi.fn().mockResolvedValue(
        snapshot({
          windows: [
            { windowMinutes: 300, usedPercent: 10, remainingPercent: 90 },
            { windowMinutes: 10080, usedPercent: 20, remainingPercent: 80 },
            { windowMinutes: 43200, usedPercent: 30, remainingPercent: 70 },
          ],
        }),
      ),
    });

    render(<AgentUsageStrip agent="claude" nowFn={now} />);

    await screen.findByTestId("agent-usage-strip");
    expect(screen.queryByTestId("usage-window-43200")).toBeNull();
  });

  it("admits its age once the snapshot is over ten minutes old", async () => {
    setAgentProbeTransports({
      agentUsage: vi.fn().mockResolvedValue(snapshot({ capturedAt: "2026-09-19T11:45:00Z" })),
    });

    render(<AgentUsageStrip agent="claude" nowFn={now} />);

    expect((await screen.findByTestId("agent-usage-stale")).textContent).toBe("as of 15m ago");
  });

  it("names which limit a weekly number came from", async () => {
    setAgentProbeTransports({
      agentUsage: vi.fn().mockResolvedValue(snapshot({ note: "from Opus weekly limit" })),
    });

    render(<AgentUsageStrip agent="claude" nowFn={now} />);

    expect((await screen.findByTestId("agent-usage-note")).textContent).toBe(
      "from Opus weekly limit",
    );
  });

  it("draws nothing for an agent whose provider publishes no usage", async () => {
    const agentUsage = vi.fn().mockResolvedValue(null);
    setAgentProbeTransports({ agentUsage });

    render(<AgentUsageStrip agent="gemini" nowFn={now} />);

    await waitFor(() => {
      expect(agentUsage).toHaveBeenCalledWith("gemini");
    });
    expect(screen.queryByTestId("agent-usage-strip")).toBeNull();
  });

  it("draws nothing when the daemon cannot be reached", async () => {
    const agentUsage = vi.fn().mockRejectedValue(new Error("disconnected"));
    setAgentProbeTransports({ agentUsage });

    render(<AgentUsageStrip agent="claude" nowFn={now} />);

    await waitFor(() => {
      expect(agentUsage).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("agent-usage-strip")).toBeNull();
  });

  it("re-reads when the selected agent changes, and shows no stale strip in between", async () => {
    const agentUsage = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ agentId: "codex", note: "codex" }));
    setAgentProbeTransports({ agentUsage });

    const { rerender } = render(<AgentUsageStrip agent="claude" nowFn={now} />);
    await screen.findByTestId("agent-usage-strip");

    rerender(<AgentUsageStrip agent="codex" nowFn={now} />);
    await waitFor(() => {
      expect(agentUsage).toHaveBeenLastCalledWith("codex");
    });
    expect((await screen.findByTestId("agent-usage-note")).textContent).toBe("codex");
  });
});
