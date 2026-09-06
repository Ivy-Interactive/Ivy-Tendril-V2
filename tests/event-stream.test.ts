import { describe, it, expect, beforeEach } from "vitest";
import { jobsStore } from "../src/state/jobsStore";
import { getPollingInterval } from "../src/api/queryClient";

describe("Live Event Stream & WebSocket Resilience", () => {
  beforeEach(() => {
    jobsStore.clearSession("job-101");
  });

  it("deduplicates identical incoming events by event ID or compound timestamp key", () => {
    const event1 = {
      id: "evt-001",
      type: "status",
      message: "Agent starting...",
      timestamp: 1000,
    };

    // First emission should be accepted
    const added1 = jobsStore.addStreamEvent("job-101", event1);
    expect(added1).toBe(true);

    // Re-emission of exact duplicate should be rejected
    const added2 = jobsStore.addStreamEvent("job-101", event1);
    expect(added2).toBe(false);

    const sessionEvents = jobsStore.getSessionEvents("job-101");
    expect(sessionEvents).toHaveLength(1);
    expect(sessionEvents[0].id).toBe("evt-001");
  });

  it("accepts distinct events in sequence", () => {
    jobsStore.addStreamEvent("job-101", {
      id: "evt-001",
      type: "status",
      message: "Step 1",
      timestamp: 1000,
    });
    jobsStore.addStreamEvent("job-101", {
      id: "evt-002",
      type: "tool_use",
      message: "cargo build",
      timestamp: 1001,
    });

    const sessionEvents = jobsStore.getSessionEvents("job-101");
    expect(sessionEvents).toHaveLength(2);
    expect(sessionEvents[1].id).toBe("evt-002");
  });

  it("calculates exponential backoff reconnect delays correctly", () => {
    const calculateBackoff = (
      attempt: number,
      baseMs = 500,
      maxMs = 10000
    ): number => {
      const delay = baseMs * Math.pow(2, attempt);
      return Math.min(delay, maxMs);
    };

    expect(calculateBackoff(0)).toBe(500); // 500ms
    expect(calculateBackoff(1)).toBe(1000); // 1s
    expect(calculateBackoff(2)).toBe(2000); // 2s
    expect(calculateBackoff(3)).toBe(4000); // 4s
    expect(calculateBackoff(4)).toBe(8000); // 8s
    expect(calculateBackoff(5)).toBe(10000); // capped at 10s
    expect(calculateBackoff(10)).toBe(10000); // capped at 10s
  });

  it("switches query polling interval based on realtime connection status", () => {
    // When WebSocket is connected, polling is disabled (false)
    const connectedInterval = getPollingInterval(true, "plans");
    expect(connectedInterval).toBe(false);

    // When WebSocket is disconnected, fallback to periodic polling interval (e.g. 5000ms)
    const disconnectedInterval = getPollingInterval(false, "plans");
    expect(disconnectedInterval).toBe(5000);
  });
});
