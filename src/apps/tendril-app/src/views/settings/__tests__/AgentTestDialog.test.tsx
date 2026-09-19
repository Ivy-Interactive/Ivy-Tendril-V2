import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import {
  AgentTestDialog,
  cancelRows,
  rowsFromResult,
  type TestModelEntry,
} from "../AgentTestDialog";
import { resetAgentProbeTransports, setAgentProbeTransports } from "../../../api/agentsApi";
import type { TestAgentResult } from "../../../types/agents";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const MODELS: TestModelEntry[] = [
  { id: "claude-opus-5", displayName: "Claude Opus 5" },
  { id: "", displayName: "Default" },
];

function result(overrides: Partial<TestAgentResult> = {}): TestAgentResult {
  return {
    agent: "claude",
    install: { isInstalled: true, version: "2.1.0" },
    auth: { status: "authenticated", provider: "anthropic-api" },
    models: [
      { status: "ok", model: "claude-opus-5" },
      { status: "ok", model: "" },
    ],
    ...overrides,
  };
}

afterEach(() => {
  resetAgentProbeTransports();
  vi.restoreAllMocks();
});

describe("rowsFromResult", () => {
  it("passes install with its version and auth with its provider", () => {
    const rows = rowsFromResult(MODELS, result());
    expect(rows.map((row) => [row.label, row.status, row.message])).toEqual([
      ["Installation", "passed", "v2.1.0"],
      ["Authentication", "passed", "Authenticated (anthropic-api)"],
      ["Model: Claude Opus 5", "passed", "Ok"],
      ["Model: Default", "passed", "Ok"],
    ]);
  });

  it("leaves auth and the models Pending when the CLI is missing", () => {
    const rows = rowsFromResult(
      MODELS,
      result({
        install: { isInstalled: false, error: "claude not found on PATH" },
        auth: null,
        models: [],
      }),
    );
    expect(rows[0]).toMatchObject({
      status: "failed",
      message: "claude not found on PATH",
      rawOutput: "claude not found on PATH",
    });
    // Not "failed": these checks were never run, and reporting them as failures would send the
    // operator after an auth problem that has not been shown to exist.
    expect(rows.slice(1).map((row) => row.status)).toEqual(["pending", "pending", "pending"]);
  });

  it("reports an exhausted quota as a failure, not a warning", () => {
    const rows = rowsFromResult([MODELS[0]], {
      agent: "claude",
      install: { isInstalled: true },
      auth: { status: "authenticated" },
      models: [{ status: "rateLimit", model: "claude-opus-5" }],
    });
    expect(rows[2]).toMatchObject({
      status: "failed",
      message: "Quota exhausted or rate limited",
    });
  });

  it("appends the sign-in hint to a signed-out agent, and keeps the raw error behind the button", () => {
    const rows = rowsFromResult([], {
      agent: "claude",
      install: { isInstalled: true },
      auth: {
        status: "notAuthenticated",
        error: "exit 1: Invalid API key",
        signInHint: "run `claude login`",
      },
      models: [],
    });
    expect(rows[1]).toMatchObject({
      status: "failed",
      message: "Not authenticated - run `claude login`",
      rawOutput: "exit 1: Invalid API key",
    });
  });

  it("warns rather than fails when a check could not reach a verdict", () => {
    const rows = rowsFromResult([], {
      agent: "codex",
      install: { isInstalled: true },
      auth: { status: "checkFailed", error: "Timed out" },
      models: [],
    });
    expect(rows[1]).toMatchObject({ status: "warning", message: "Timed out" });
  });

  it("falls back to a warning for an unknown status with nothing to say", () => {
    const rows = rowsFromResult([MODELS[0]], {
      agent: "opencode",
      install: { isInstalled: true },
      auth: { status: "authenticated" },
      models: [{ status: "unknown", model: "claude-opus-5" }],
    });
    expect(rows[2]).toMatchObject({ status: "warning", message: "Unknown" });
  });
});

describe("cancelRows", () => {
  it("turns everything still in flight into a Cancelled warning and leaves verdicts alone", () => {
    expect(
      cancelRows([
        { label: "Installation", status: "passed", message: "v1" },
        { label: "Authentication", status: "running" },
        { label: "Model: Default", status: "pending" },
      ]),
    ).toEqual([
      { label: "Installation", status: "passed", message: "v1" },
      { label: "Authentication", status: "warning", message: "Cancelled" },
      { label: "Model: Default", status: "warning", message: "Cancelled" },
    ]);
  });
});

describe("AgentTestDialog", () => {
  it("seeds every check as Pending before the reply lands, then fills them in", async () => {
    let settle: (value: TestAgentResult) => void = () => {};
    const testAgent = vi.fn(
      () =>
        new Promise<TestAgentResult>((resolve) => {
          settle = resolve;
        }),
    );
    setAgentProbeTransports({ testAgent });

    render(<AgentTestDialog isOpen onClose={vi.fn()} agent="claude" models={MODELS} />);

    // Four rows, all Pending, and the footer offers Cancel because a run is in flight.
    await waitFor(() => {
      expect(screen.getAllByTestId("agent-test-row-pending")).toHaveLength(4);
    });
    expect(screen.getByTestId("agent-test-close").textContent).toBe("Cancel");
    expect(testAgent).toHaveBeenCalledWith("claude", { models: ["claude-opus-5", ""] });

    await act(async () => {
      settle(result());
    });

    expect(screen.getAllByTestId("agent-test-row-passed")).toHaveLength(4);
    expect(screen.getByTestId("agent-test-close").textContent).toBe("Close");
  });

  it("shows a failed run as one extra row instead of an empty table", async () => {
    setAgentProbeTransports({
      testAgent: vi.fn().mockRejectedValue(new Error("daemon is not running")),
    });

    render(<AgentTestDialog isOpen onClose={vi.fn()} agent="claude" models={MODELS} />);

    await waitFor(() => {
      expect(screen.getByText("Unexpected error")).toBeTruthy();
    });
    // The seeded checks are still listed, marked Cancelled rather than silently dropped.
    expect(screen.getAllByTestId("agent-test-row-warning")).toHaveLength(4);
  });

  it("opens the raw output behind the Bug button and closes it again", async () => {
    setAgentProbeTransports({
      testAgent: vi.fn().mockResolvedValue(
        result({
          install: { isInstalled: true, version: "2.1.0" },
          auth: { status: "checkFailed", error: "keychain prompt timed out" },
          models: [],
        }),
      ),
    });

    render(<AgentTestDialog isOpen onClose={vi.fn()} agent="claude" models={[]} />);

    const bug = await screen.findByTestId("agent-test-raw-output");
    fireEvent.click(bug);
    // Scoped to the second dialog: the same text is already on screen in the row's Result cell.
    const raw = await screen.findByTestId("agent-test-raw-dialog");
    expect(within(raw).getByText("keychain prompt timed out")).toBeTruthy();

    fireEvent.click(screen.getByTestId("agent-test-raw-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("agent-test-raw-dialog")).toBeNull();
    });
  });

  it("ignores the reply of a run the operator has already closed", async () => {
    let settle: (value: TestAgentResult) => void = () => {};
    setAgentProbeTransports({
      testAgent: vi.fn(
        () =>
          new Promise<TestAgentResult>((resolve) => {
            settle = resolve;
          }),
      ),
    });
    const onClose = vi.fn();

    render(<AgentTestDialog isOpen onClose={onClose} agent="claude" models={MODELS} />);
    await screen.findAllByTestId("agent-test-row-pending");

    fireEvent.click(screen.getByTestId("agent-test-close"));
    expect(onClose).toHaveBeenCalled();

    await act(async () => {
      settle(result());
    });

    // The table was emptied on close and the late reply did not refill it.
    expect(screen.queryAllByTestId("agent-test-row-passed")).toHaveLength(0);
  });

  it("runs nothing at all while it is closed", () => {
    const testAgent = vi.fn().mockResolvedValue(result());
    setAgentProbeTransports({ testAgent });

    render(<AgentTestDialog isOpen={false} onClose={vi.fn()} agent="claude" models={MODELS} />);

    expect(testAgent).not.toHaveBeenCalled();
  });
});
