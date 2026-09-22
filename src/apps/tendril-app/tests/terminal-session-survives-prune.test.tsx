import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, cleanup } from "@testing-library/react";
import { App } from "../src/App";
import { agentsApi } from "../src/api/agentsApi";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { chatLauncher } from "../src/state/chatLauncher";
import { chatStore } from "../src/state/chatStore";
import { uiStore } from "../src/state/uiStore";
import { navigation } from "../src/state/navigation";
import type { ChatSession } from "../src/types/chat";

/**
 * A terminal chat session outlives the empty-session prune.
 *
 * The bug: "Start terminal agent" answered
 * `Failed to start a terminal for chat '<id>' (404 Not Found): {"error":"Session '<id>' not found"}`.
 * The daemon was right to refuse — the session really was gone, and the app had deleted it itself.
 *
 * Three behaviours meet. `pruneEmptySessions` deletes every session with no messages, `ChatView`
 * runs that prune on unmount, and opening a terminal pane *is* what unmounts it: the pane's id
 * becomes `activeNav`, so `renderActiveView`'s switch no longer matches `"chat"`. Then the last
 * piece — a terminal session never gains a message at all. `AgentTerminalView` renders raw bytes and
 * writes nothing back to the session, so `messages.length === 0` is its permanent state rather than
 * a sign it was abandoned. The prune could not tell the difference and deleted the session between
 * `chatLauncher.startNew` creating it and `startAgentTerminal` asking the daemon to spawn into it.
 *
 * The 404 itself is not the defect and is not softened: `start_terminal_handler`'s existence check is
 * what stops a route carrying the daemon's authority from spawning an arbitrary process. The fix is
 * on the other side — an open pane marks its session as in use, so the prune leaves it alone.
 */

const session = (id: string): ChatSession => ({
  id,
  title: "New Chat",
  createdAt: "2026-09-21T12:00:00Z",
  updatedAt: "2026-09-21T12:00:00Z",
  messages: [],
  spawnedJobIds: [],
});

/**
 * A daemon that remembers what it was told: it lists `listed`, and `createSession` adds `created`.
 *
 * `chatStore.fetchSessions` *replaces* the list with whatever `listSessions` answers, and it runs
 * whenever `init` gets to it — after the agent catalogue, which is its own await. A `listSessions`
 * stubbed to one fixed answer describes a daemon that forgets a session the moment it has created
 * it, so a fetch landing after `startNew` emptied the list and failed the test as though the prune
 * had struck: `expected [] to include 'term-1'`, on whichever run was slow enough to let it land
 * there. Here a created session stays listed until something deletes it — which is the one thing
 * the prune must not do — so the list the assertion reads is the daemon's, whenever it was fetched.
 */
const fakeDaemon = (listed: ChatSession[], created?: ChatSession) => {
  const sessions = new Map(listed.map((s) => [s.id, s]));
  vi.spyOn(chatApi, "listSessions").mockImplementation(async () => [...sessions.values()]);
  vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => {
    const found = sessions.get(id);
    if (!found) throw new Error(`Session '${id}' not found`);
    return found;
  });
  vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  vi.spyOn(chatApi, "createSession").mockImplementation(async () => {
    if (!created) throw new Error("this test creates no session");
    sessions.set(created.id, created);
    return created;
  });
  const deleteSession = vi.spyOn(chatApi, "deleteSession").mockImplementation(async (id) => {
    sessions.delete(id);
  });
  return { deleteSession };
};

/** Takes down whatever panes a test opened, without disturbing navigation's subscribers. */
const closeOpenPanes = () => {
  for (const pane of [...navigation.getState().sessions]) uiStore.closeTab(pane.id);
};

describe("a terminal session is not pruned while its pane is open", () => {
  beforeEach(() => {
    // Both stores are module singletons that outlive a render, so a pane or a session left by the
    // previous test would still be there — and a stale pane is exactly what the guard under test
    // reads. Panes are closed rather than reset: `navigation.resetForTesting` also clears the
    // listener `uiStore` registered when the module loaded, which would unwire the two for good.
    closeOpenPanes();
    chatStore.resetForTesting();
    chatLauncher.resetForTesting();
    vi.spyOn(bridge, "listPlans").mockResolvedValue([]);
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
    // There is no Tauri here, so the real `listAgents` throws, and `loadAgents` answers a failure by
    // waiting `AGENT_CATALOG_RETRY_DELAY_MS` and trying again before `init` fetches the sessions.
    // That put a 400ms timer in the middle of every run and the session fetch at the far end of
    // it; an answered catalogue takes the timer out and lets `init` finish before the test acts.
    vi.spyOn(agentsApi, "listAgents").mockResolvedValue([]);
    uiStore.setActiveNav("chat");
  });

  afterEach(() => {
    // `App` is a real mount holding store subscriptions and a poll, and the stores are module
    // singletons shared with the rest of the worker, so it comes down before the spies do.
    cleanup();
    closeOpenPanes();
    uiStore.setActiveNav("dashboard");
    vi.restoreAllMocks();
  });

  it("survives the prune the Chat page runs as the pane unmounts it", async () => {
    const daemon = fakeDaemon([], session("term-1"));
    const prune = vi.spyOn(chatStore, "pruneEmptySessions");

    await act(async () => {
      render(<App />);
    });
    // The prune runs in `ChatView`'s unmount cleanup, so the page has to be on screen first.
    await waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());

    chatLauncher.setMode("terminal");
    await act(async () => {
      await chatLauncher.startNew();
    });

    // The pane is up, which is what takes the Chat page down and fires the prune.
    await waitFor(() => expect(uiStore.getState().activeNav).toBe("term-1"));
    await waitFor(() => expect(prune).toHaveBeenCalled());

    // The session the terminal is about to spawn into is still there, daemon-side and in the list.
    expect(daemon.deleteSession).not.toHaveBeenCalledWith("term-1");
    expect(chatStore.getState().sessions.map((s) => s.id)).toContain("term-1");
  });

  it("still prunes an empty session that has no pane open on it", async () => {
    const daemon = fakeDaemon([session("abandoned-1")]);

    await act(async () => {
      render(<App />);
    });
    await waitFor(() => expect(chatStore.getState().sessions).toHaveLength(1));

    await act(async () => {
      await chatStore.pruneEmptySessions();
    });

    // The guard is about panes, not about emptiness: a session nothing is showing is still swept.
    expect(daemon.deleteSession).toHaveBeenCalledWith("abandoned-1");
  });
});
