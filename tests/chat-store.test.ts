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

  it("includes attachments in optimistic user message and passes attachments to chatApi.postMessage", async () => {
    const testSession: ChatSession = {
      ...mockSession,
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Hello",
          timestamp: "2026-09-07T12:00:00Z",
        },
      ],
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([testSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(testSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const postSpy = vi.spyOn(chatApi, "postMessage").mockResolvedValue({ started: true });

    await chatStore.fetchSessions();

    const attachments = [{ name: "screenshot.png", path: "/tmp/screenshot.png", mimeType: "image/png" }];
    await chatStore.sendMessage("Take a look at this", { attachments });

    const activeSession = chatStore.getState().activeSession;
    expect(activeSession?.messages).toHaveLength(2);
    const lastMsg = activeSession?.messages[1];
    expect(lastMsg?.content).toBe("Take a look at this");
    expect(lastMsg?.attachments).toEqual(attachments);

    expect(postSpy).toHaveBeenCalledWith("session-1", "Take a look at this", {
      attachments,
    });
  });

  describe("In-Progress Question Answers", () => {
    it("manages in-progress question selections (set, get, clear) and syncs to storage", () => {
      // 1. Initially undefined
      expect(chatStore.getInProgressAnswers("msg-1")).toBeUndefined();

      // 2. Set answer for question
      chatStore.setInProgressAnswer("msg-1", "q-db", "sqlite");
      expect(chatStore.getInProgressAnswers("msg-1")).toEqual({
        "q-db": ["sqlite"],
      });

      // 3. Set multi-select answer
      chatStore.setInProgressAnswer("msg-1", "q-features", ["auth", "logging"]);
      expect(chatStore.getInProgressAnswers("msg-1")).toEqual({
        "q-db": ["sqlite"],
        "q-features": ["auth", "logging"],
      });

      // 4. Verify storage persistence
      const stored = sessionStorage.getItem("tendril:chat:in_progress_answers");
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual({
        "msg-1": {
          "q-db": ["sqlite"],
          "q-features": ["auth", "logging"],
        },
      });

      // 5. Clear specific question
      chatStore.clearInProgressAnswers("msg-1", "q-db");
      expect(chatStore.getInProgressAnswers("msg-1")).toEqual({
        "q-features": ["auth", "logging"],
      });

      // 6. Clear entire message
      chatStore.clearInProgressAnswers("msg-1");
      expect(chatStore.getInProgressAnswers("msg-1")).toBeUndefined();
    });

    it("records selection in inProgressAnswers and clears upon successful server response", async () => {
      const sessionWithQuestion: ChatSession = {
        ...mockSession,
        messages: [
          {
            id: "msg-q",
            role: "assistant",
            content: "```questions\nquestions:\n  - id: db\n    title: Choose db\n```",
            timestamp: "2026-09-07T12:00:00Z",
          },
        ],
      };

      vi.spyOn(chatApi, "listSessions").mockResolvedValue([sessionWithQuestion]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(sessionWithQuestion);
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

      let resolveApi!: (val: ChatSession) => void;
      const apiPromise = new Promise<ChatSession>((resolve) => {
        resolveApi = resolve;
      });
      vi.spyOn(chatApi, "answerQuestions").mockReturnValue(apiPromise);

      await chatStore.fetchSessions();

      // Initiate submission
      const submitPromise = chatStore.submitAnswer("msg-q", "db", "postgres");

      // While in flight, inProgressAnswers has the selection
      expect(chatStore.getInProgressAnswers("msg-q")).toEqual({
        db: ["postgres"],
      });
      // In-memory message content is optimistically patched
      expect(chatStore.getState().activeSession?.messages[0].content).toContain('answer: "postgres"');

      // Resolve server response
      const updatedSession: ChatSession = {
        ...sessionWithQuestion,
        messages: [
          {
            id: "msg-q",
            role: "assistant",
            content: "```questions\nquestions:\n  - id: db\n    answer: postgres\n    title: Choose db\n```",
            timestamp: "2026-09-07T12:01:00Z",
          },
        ],
      };
      resolveApi(updatedSession);
      await submitPromise;

      // Upon completion, cleared from inProgressAnswers
      expect(chatStore.getInProgressAnswers("msg-q")).toBeUndefined();
      expect(chatStore.getState().activeSession?.messages[0].content).toContain("answer: postgres");
    });

    it("retains in-progress selection and records error when chatApi.answerQuestions rejects", async () => {
      const sessionWithQuestion: ChatSession = {
        ...mockSession,
        messages: [
          {
            id: "msg-q2",
            role: "assistant",
            content: "```questions\nquestions:\n  - id: db\n    title: Choose db\n```",
            timestamp: "2026-09-07T12:00:00Z",
          },
        ],
      };

      vi.spyOn(chatApi, "listSessions").mockResolvedValue([sessionWithQuestion]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(sessionWithQuestion);
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      vi.spyOn(chatApi, "answerQuestions").mockRejectedValue(new Error("Network timeout"));

      await chatStore.fetchSessions();

      await expect(chatStore.submitAnswer("msg-q2", "db", "sqlite")).rejects.toThrow("Network timeout");

      // Selection must be retained so user input is not lost
      expect(chatStore.getInProgressAnswers("msg-q2")).toEqual({
        db: ["sqlite"],
      });
      expect(chatStore.getState().error).toBe("Network timeout");
    });

    it("clears inProgressAnswers and storage on resetForTesting and deleteSession", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      vi.spyOn(chatApi, "deleteSession").mockResolvedValue();

      await chatStore.fetchSessions();
      chatStore.setInProgressAnswer("msg-1", "q-test", "val");
      expect(chatStore.getInProgressAnswers("msg-1")).toBeDefined();

      // resetForTesting
      chatStore.resetForTesting();
      expect(chatStore.getInProgressAnswers("msg-1")).toBeUndefined();
      expect(sessionStorage.getItem("tendril:chat:in_progress_answers")).toBeNull();

      // Set again and test deleteSession
      await chatStore.fetchSessions();
      chatStore.setInProgressAnswer("msg-1", "q-test", "val");
      await chatStore.deleteSession("session-1");
      expect(chatStore.getInProgressAnswers("msg-1")).toBeUndefined();
      expect(sessionStorage.getItem("tendril:chat:in_progress_answers")).toBeNull();
    });
  });
});
