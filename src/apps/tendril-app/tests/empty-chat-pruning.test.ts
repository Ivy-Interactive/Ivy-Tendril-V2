import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

describe("Empty Chat Pruning", () => {
  const emptySession1: ChatSession = {
    id: "empty-1",
    title: "New Chat 1",
    createdAt: "2026-09-07T10:00:00Z",
    updatedAt: "2026-09-07T10:00:00Z",
    messages: [],
    spawnedJobIds: [],
  };

  const emptySession2: ChatSession = {
    id: "empty-2",
    title: "New Chat 2",
    createdAt: "2026-09-07T10:05:00Z",
    updatedAt: "2026-09-07T10:05:00Z",
    messages: [],
    spawnedJobIds: [],
  };

  const nonEmptySession: ChatSession = {
    id: "non-empty-1",
    title: "Conversation with History",
    createdAt: "2026-09-07T10:10:00Z",
    updatedAt: "2026-09-07T10:10:00Z",
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "What is the architecture?",
        timestamp: "2026-09-07T10:10:00Z",
      },
    ],
    spawnedJobIds: [],
  };

  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prunes empty sessions (0 messages) via chatApi.deleteSession", async () => {
    const deleteSpy = vi.spyOn(chatApi, "deleteSession").mockResolvedValue();
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([
      emptySession1,
      emptySession2,
      nonEmptySession,
    ]);
    vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => {
      return (
        [emptySession1, emptySession2, nonEmptySession].find((s) => s.id === id) || emptySession1
      );
    });
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.fetchSessions();
    expect(chatStore.getState().sessions).toHaveLength(3);

    await chatStore.pruneEmptySessions();

    expect(deleteSpy).toHaveBeenCalledWith("empty-1");
    expect(deleteSpy).toHaveBeenCalledWith("empty-2");
    expect(deleteSpy).not.toHaveBeenCalledWith("non-empty-1");

    const remaining = chatStore.getState().sessions;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("non-empty-1");
  });

  it("automatically prunes previously active session in selectSession if it had 0 messages", async () => {
    const deleteSpy = vi.spyOn(chatApi, "deleteSession").mockResolvedValue();
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([emptySession1, nonEmptySession]);
    vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => {
      return [emptySession1, nonEmptySession].find((s) => s.id === id) || emptySession1;
    });
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.fetchSessions();
    await chatStore.selectSession("empty-1");
    expect(chatStore.getState().activeSessionId).toBe("empty-1");

    // Switch from empty-1 to non-empty-1
    await chatStore.selectSession("non-empty-1");

    expect(deleteSpy).toHaveBeenCalledWith("empty-1");
    const sessionIds = chatStore.getState().sessions.map((s) => s.id);
    expect(sessionIds).not.toContain("empty-1");
    expect(sessionIds).toContain("non-empty-1");
    expect(chatStore.getState().activeSessionId).toBe("non-empty-1");
  });

  it("never deletes sessions with messages or currently active session when keepSessionId is passed", async () => {
    const deleteSpy = vi.spyOn(chatApi, "deleteSession").mockResolvedValue();
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([emptySession1, nonEmptySession]);
    vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => {
      return [emptySession1, nonEmptySession].find((s) => s.id === id) || emptySession1;
    });
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.fetchSessions();
    await chatStore.selectSession("empty-1");

    // Call prune with keepSessionId = empty-1
    await chatStore.pruneEmptySessions("empty-1");

    expect(deleteSpy).not.toHaveBeenCalledWith("empty-1");
    expect(deleteSpy).not.toHaveBeenCalledWith("non-empty-1");
    expect(chatStore.getState().sessions).toHaveLength(2);
  });
});
