import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chatStore, PINNED_SESSIONS_STORAGE_KEY } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

describe("Chat Session Pinning & Sorting", () => {
  const sessionA: ChatSession = {
    id: "session-a",
    title: "Session A (Old)",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    spawnedJobIds: [],
    messages: [{ id: "m1", role: "user", content: "hi", timestamp: "2026-09-01T10:00:00Z" }],
  };

  const sessionB: ChatSession = {
    id: "session-b",
    title: "Session B (New)",
    createdAt: "2026-09-05T10:00:00Z",
    updatedAt: "2026-09-05T10:00:00Z",
    spawnedJobIds: [],
    messages: [{ id: "m2", role: "user", content: "hello", timestamp: "2026-09-05T10:00:00Z" }],
  };

  const sessionC: ChatSession = {
    id: "session-c",
    title: "Session C (Newest)",
    createdAt: "2026-09-07T10:00:00Z",
    updatedAt: "2026-09-07T10:00:00Z",
    spawnedJobIds: [],
    messages: [{ id: "m3", role: "user", content: "hey", timestamp: "2026-09-07T10:00:00Z" }],
  };

  beforeEach(() => {
    localStorage.clear();
    chatStore.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("toggles pin status and persists to localStorage under tendril:chat:pinned_sessions", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([sessionA, sessionB]);
    vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => {
      return [sessionA, sessionB].find((s) => s.id === id) || sessionA;
    });
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.fetchSessions();

    expect(chatStore.getState().sessions.every((s) => !s.isPinned)).toBe(true);
    expect(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)).toBeNull();

    // Pin session A
    chatStore.togglePinSession("session-a");

    const stateAfterPin = chatStore.getState();
    const pinnedA = stateAfterPin.sessions.find((s) => s.id === "session-a");
    expect(pinnedA?.isPinned).toBe(true);
    expect(pinnedA?.pinnedAt).toBeDefined();

    const storedJson = localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY);
    expect(storedJson).not.toBeNull();
    const storedMap = JSON.parse(storedJson!);
    expect(storedMap["session-a"]).toBeDefined();

    // Toggle again to unpin
    chatStore.togglePinSession("session-a");
    const stateAfterUnpin = chatStore.getState();
    const unpinnedA = stateAfterUnpin.sessions.find((s) => s.id === "session-a");
    expect(unpinnedA?.isPinned).toBe(false);
    expect(unpinnedA?.pinnedAt).toBeUndefined();
    expect(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)).toBeNull();
  });

  it("sorts pinned sessions first by pinnedAt descending, then unpinned by updatedAt descending", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([sessionA, sessionB, sessionC]);
    vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => {
      return [sessionA, sessionB, sessionC].find((s) => s.id === id) || sessionA;
    });
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.fetchSessions();

    // Initial order: C (newest), B, A (oldest)
    let sessionIds = chatStore.getState().sessions.map((s) => s.id);
    expect(sessionIds).toEqual(["session-c", "session-b", "session-a"]);

    // Pin session A (oldest) at 10:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
    chatStore.togglePinSession("session-a");

    // Now session A should be at the top because it is pinned
    sessionIds = chatStore.getState().sessions.map((s) => s.id);
    expect(sessionIds).toEqual(["session-a", "session-c", "session-b"]);

    // Pin session B at 10:05
    vi.setSystemTime(new Date("2026-09-08T10:05:00Z"));
    chatStore.togglePinSession("session-b");
    vi.useRealTimers();

    // Both A and B are pinned. B was pinned later than A, so B comes first, then A, then unpinned C
    sessionIds = chatStore.getState().sessions.map((s) => s.id);
    expect(sessionIds).toEqual(["session-b", "session-a", "session-c"]);

    // Unpin session B restores it to the recent list (ordered by updatedAt)
    chatStore.togglePinSession("session-b");
    sessionIds = chatStore.getState().sessions.map((s) => s.id);
    expect(sessionIds).toEqual(["session-a", "session-c", "session-b"]);
  });

  it("restores pinned sessions on initial fetchSessions from localStorage", async () => {
    const fakePinnedTimestamp = "2026-09-08T12:00:00Z";
    localStorage.setItem(
      PINNED_SESSIONS_STORAGE_KEY,
      JSON.stringify({ "session-a": fakePinnedTimestamp }),
    );

    // Re-initialize store with saved localStorage
    await chatStore.init();

    vi.spyOn(chatApi, "listSessions").mockResolvedValue([sessionA, sessionB]);
    vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => {
      return [sessionA, sessionB].find((s) => s.id === id) || sessionA;
    });
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const sessions = await chatStore.fetchSessions();
    expect(sessions[0].id).toBe("session-a");
    expect(sessions[0].isPinned).toBe(true);
    expect(sessions[0].pinnedAt).toBe(fakePinnedTimestamp);
  });
});
