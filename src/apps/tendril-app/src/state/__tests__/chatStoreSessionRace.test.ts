/**
 * `activeSessionId` and `activeSession.id` must never disagree.
 *
 * Every per-event guard in `handleChatEvent` decides whether a frame belongs to the pane on screen
 * by comparing `activeSession.id` to the frame's `sessionId`. Those guards are correct, so the only
 * way another conversation's output reaches the wrong pane is if the two fields drift apart - which
 * they do whenever a fetch started for one session resolves after the selection has moved on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatStore } from "../chatStore";
import { chatApi } from "../../api/chatApi";
import type { ChatSession } from "../../types/chat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../api/events", () => ({
  onChatEvent: vi.fn(async () => () => {}),
}));

function session(id: string): ChatSession {
  return {
    id,
    title: `Session ${id}`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    // Non-empty: `selectSession` prunes an *empty* previous session before switching, which would
    // drag unrelated API calls into a test that is only about which reply wins.
    messages: [{ id: `${id}-m1`, role: "user", content: "hi", timestamp: "2026-01-01T00:00:00Z" }],
    spawnedJobIds: [],
  };
}

/** A `getSession` whose replies are released by hand, so the race is deterministic. */
function deferredSessions() {
  const gates = new Map<string, () => void>();
  const getSession = vi.fn(
    (id: string) =>
      new Promise<ChatSession>((resolve) => {
        gates.set(id, () => resolve(session(id)));
      }),
  );
  return { getSession, release: (id: string) => gates.get(id)?.() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatStore session selection races", () => {
  it("drops a selectSession reply that lost the race to a later switch", async () => {
    const { getSession, release } = deferredSessions();
    vi.spyOn(chatApi, "getSession").mockImplementation(getSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const store = new ChatStore();
    const first = store.selectSession("A");
    const second = store.selectSession("B");

    // B wins the selection, then A's slower fetch lands.
    release("B");
    await second;
    release("A");
    await first;

    const state = store.getState();
    expect(state.activeSessionId).toBe("B");
    // The whole point: not "A". A mismatch here is the crosstalk bug.
    expect(state.activeSession?.id).toBe("B");
  });

  it("drops a refreshActiveSession reply when the user switched chats mid-flight", async () => {
    const { getSession, release } = deferredSessions();
    vi.spyOn(chatApi, "getSession").mockImplementation(getSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const store = new ChatStore();
    const selectA = store.selectSession("A");
    release("A");
    await selectA;
    expect(store.getState().activeSession?.id).toBe("A");

    // A turn ends on A - `chat.generating_state` fires this - while the user moves to B.
    const refresh = store.refreshActiveSession();
    const selectB = store.selectSession("B");
    release("B");
    await selectB;
    release("A");
    await refresh;

    const state = store.getState();
    expect(state.activeSessionId).toBe("B");
    expect(state.activeSession?.id).toBe("B");
  });
});
