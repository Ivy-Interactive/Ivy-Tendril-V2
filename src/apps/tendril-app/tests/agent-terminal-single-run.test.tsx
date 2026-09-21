import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import * as agentTerminal from "../src/api/agentTerminal";
import type { AgentTerminalRun } from "../src/api/agentTerminal";
import { AgentTerminalView } from "../src/views/AgentTerminalView";
import { chatApi } from "../src/api/chatApi";
import {
  acquireAgentTerminal,
  releaseAgentTerminal,
  resetAgentTerminalRunsForTesting,
} from "../src/state/agentTerminalRuns";
import type { ChatSession } from "../src/types/chat";

/**
 * One chat session runs exactly one agent, however many times its pane mounts.
 *
 * The bug, reported as three symptoms of one fault: "in the terminal chat, I can't type into it. it
 * did not properly resize. if i switch back to the empty chat, then to the terminal chat, the empty
 * chat become a bunch of letters/numbers".
 *
 * `AgentTerminalView` started its agent inside a mount effect, which React StrictMode double-invokes.
 * The start is asynchronous, so the cleanup between the two invocations found `runRef` still null and
 * closed nothing — and both invocations reached `startAgentTerminal`. Two ptys, one chat session id:
 *
 * - the Tauri transport filters frames on `chatSessionId`, so both agents' output lands in one
 *   emulator, interleaved — the letters and numbers;
 * - the native bridge keys `READERS` by chat session id too, so the second spawn displaces the
 *   first's entry and the retired mount's `close()` aborts the reader that is actually live — the
 *   terminal that will not accept typing;
 * - `onResize` reaches one pty and the other keeps drawing at its default grid.
 *
 * These tests pin the registry that fixes it, and would fail against a view that starts its own run:
 * the first asserts a single spawn across a StrictMode double-mount, the second that a genuine
 * unmount still ends the agent, which is what `close()` promises and what stops a model session
 * leaking per closed tab.
 */

const SESSION: ChatSession = {
  id: "term-1",
  title: "Terminal",
  createdAt: "2026-09-21T12:00:00Z",
  updatedAt: "2026-09-21T12:00:00Z",
  messages: [],
  spawnedJobIds: [],
};

/** A run that records what was asked of it, standing in for a pty. */
type FakeRun = AgentTerminalRun & {
  closed: number;
  resize: AgentTerminalRun["resize"] & { mock: { calls: unknown[] } };
};

const makeRun = (): FakeRun => {
  const run = {
    session: { sessionId: "pty-1", encoding: "utf-8", rows: 24, cols: 80 },
    closed: 0,
    sendInput: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    close: vi.fn(async () => {
      run.closed += 1;
    }),
  };
  return run as FakeRun;
};

describe("one agent per chat session", () => {
  beforeEach(() => {
    resetAgentTerminalRunsForTesting();
    vi.spyOn(chatApi, "getSession").mockResolvedValue(SESSION);
  });

  afterEach(() => {
    cleanup();
    resetAgentTerminalRunsForTesting();
    vi.restoreAllMocks();
  });

  it("spawns one pty when StrictMode double-invokes the pane's mount effect", async () => {
    const run = makeRun();
    const start = vi.spyOn(agentTerminal, "startAgentTerminal").mockResolvedValue(run);

    await act(async () => {
      render(
        <React.StrictMode>
          <AgentTerminalView sessionId="term-1" />
        </React.StrictMode>,
      );
    });

    // The whole defect in one assertion: the second invocation must adopt the first one's run.
    expect(start).toHaveBeenCalledTimes(1);
    // And the surviving mount must still hold a live agent — the reader the old code aborted.
    expect(run.closed).toBe(0);
  });

  it("ends the agent when the pane is really gone, not merely remounted", async () => {
    const run = makeRun();
    vi.spyOn(agentTerminal, "startAgentTerminal").mockResolvedValue(run);

    const view = await act(async () =>
      render(
        <React.StrictMode>
          <AgentTerminalView sessionId="term-1" />
        </React.StrictMode>,
      ),
    );

    await act(async () => {
      view.unmount();
      // The close is scheduled a tick out, so that a StrictMode remount can cancel it. A real
      // unmount just lets that tick pass.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(run.closed).toBe(1);
  });

  it("hands a second mount the run the first one started, and replays what it missed", async () => {
    const run = makeRun();
    let emit: ((bytes: Uint8Array) => void) | undefined;
    vi.spyOn(agentTerminal, "startAgentTerminal").mockImplementation(async (_id, options) => {
      emit = options.onChunk;
      return run;
    });

    const first = { onChunk: vi.fn(), onEnd: vi.fn() };
    await acquireAgentTerminal("term-1", "do the thing", first);
    releaseAgentTerminal("term-1", first);

    // The banner an agent prints in the gap between a cleanup and the remount that follows it.
    emit?.(new TextEncoder().encode("banner"));

    const second = { onChunk: vi.fn(), onEnd: vi.fn() };
    const adopted = await acquireAgentTerminal("term-1", "do the thing", second);

    expect(adopted).toBe(run);
    expect(second.onChunk).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(second.onChunk.mock.calls[0][0])).toBe("banner");
    // The first pane is gone; nothing may still be written into its detached handle.
    expect(first.onChunk).not.toHaveBeenCalled();

    await act(async () => {
      releaseAgentTerminal("term-1", second);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(run.closed).toBe(1);
  });

  it("replays a grid the emulator reported before the spawn returned", async () => {
    const run = makeRun();
    let release: ((run: AgentTerminalRun) => void) | undefined;
    vi.spyOn(agentTerminal, "startAgentTerminal").mockReturnValue(
      new Promise<AgentTerminalRun>((resolve) => {
        release = resolve;
      }),
    );

    await act(async () => {
      render(
        <React.StrictMode>
          <AgentTerminalView sessionId="term-1" />
        </React.StrictMode>,
      );
    });

    // `Terminal` measures itself and reports unconditionally, well before the daemon answers the
    // spawn. The old code forwarded that straight into `runRef.current?.resize`, which was null, and
    // the only size report the pty was ever going to get was dropped on the floor.
    await act(async () => {
      release?.(run);
      await Promise.resolve();
    });

    await waitFor(() => expect(run.resize.mock.calls.length).toBeGreaterThan(0));
  });

  it("forgets a run whose start failed, so the next mount may try again", async () => {
    const start = vi
      .spyOn(agentTerminal, "startAgentTerminal")
      .mockRejectedValueOnce(new Error("daemon refused"));

    const sink = { onChunk: vi.fn(), onEnd: vi.fn() };
    await expect(acquireAgentTerminal("term-1", undefined, sink)).rejects.toThrow("daemon refused");

    const run = makeRun();
    start.mockResolvedValueOnce(run);
    await expect(acquireAgentTerminal("term-1", undefined, sink)).resolves.toBe(run);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
