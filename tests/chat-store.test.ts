import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatQueuedItem, ChatSession } from "../src/types/chat";

describe("ChatStore State Management & Event Handling", () => {
  const mockSession: ChatSession = {
    id: "session-1",
    title: "Initial Session",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "Hello",
        timestamp: "2026-09-07T12:00:00Z",
      },
    ],
    spawnedJobIds: [],
  };

  const mockQueuedItem: ChatQueuedItem = {
    id: "queue-1",
    prompt: "Queued question",
    createdAt: "2026-09-07T12:05:00Z",
  };

  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles initial session fetch, selection, and error handling", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([mockQueuedItem]);

    await chatStore.fetchSessions();

    const state = chatStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe("session-1");
    expect(state.activeSession?.title).toBe("Initial Session");
    expect(state.queuedItems).toHaveLength(1);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();

    // Verify error handling
    vi.spyOn(chatApi, "listSessions").mockRejectedValue(new Error("Network failure"));
    await chatStore.fetchSessions();
    expect(chatStore.getState().error).toBe("Network failure");
  });

  it("accumulates stream deltas in real-time on chat.stream_delta events", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.fetchSessions();

    // 1. Initial delta for a new assistant message
    chatStore.handleChatEvent({
      type: "chat.stream_delta",
      sessionId: "session-1",
      messageId: "asst-msg-1",
      delta: "Hello ",
    });

    let state = chatStore.getState();
    expect(state.isGenerating).toBe(true);
    let messages = state.activeSession!.messages;
    expect(messages).toHaveLength(2);
    expect(messages[1].id).toBe("asst-msg-1");
    expect(messages[1].content).toBe("Hello ");

    // 2. Subsequent deltas append chunks
    chatStore.handleChatEvent({
      type: "chat.stream_delta",
      sessionId: "session-1",
      messageId: "asst-msg-1",
      delta: "World!",
    });

    state = chatStore.getState();
    messages = state.activeSession!.messages;
    expect(messages[1].content).toBe("Hello World!");

    // 3. Generating state event updates flag
    chatStore.handleChatEvent({
      type: "chat.generating_state",
      sessionId: "session-1",
      isGenerating: false,
    });

    expect(chatStore.getState().isGenerating).toBe(false);
  });

  it("dispatches expected payload to chatApi.answerQuestions on submitAnswer", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const updatedSession: ChatSession = {
      ...mockSession,
      messages: [
        {
          id: "asst-msg-q",
          role: "assistant",
          content: "Answered: SQLite",
          timestamp: "2026-09-07T12:01:00Z",
        },
      ],
    };

    const answerSpy = vi.spyOn(chatApi, "answerQuestions").mockResolvedValue(updatedSession);

    await chatStore.fetchSessions();

    // Call submitAnswer with single option string
    await chatStore.submitAnswer("asst-msg-q", "db-choice", "sqlite");

    expect(answerSpy).toHaveBeenCalledWith("session-1", "asst-msg-q", {
      "db-choice": ["sqlite"],
    });

    expect(chatStore.getState().activeSession?.messages[0].content).toBe("Answered: SQLite");

    // Call submitAnswer with array of options
    await chatStore.submitAnswer("asst-msg-q", "features", ["auth", "logging"]);
    expect(answerSpy).toHaveBeenCalledWith("session-1", "asst-msg-q", {
      features: ["auth", "logging"],
    });
  });

  it("handles queue addition and deletion", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([mockQueuedItem]);
    const deleteQueueSpy = vi.spyOn(chatApi, "deleteQueuedItem").mockResolvedValue();

    await chatStore.fetchSessions();
    expect(chatStore.getState().queuedItems).toHaveLength(1);

    await chatStore.deleteQueuedMessage("queue-1");
    expect(deleteQueueSpy).toHaveBeenCalledWith("session-1", "queue-1");
    expect(chatStore.getState().queuedItems).toHaveLength(0);
  });
});
