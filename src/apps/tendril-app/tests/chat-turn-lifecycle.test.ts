import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPromptWithAttachments, chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import { agentsApi } from "../src/api/agentsApi";
import type { AgentOption } from "../src/types/agents";
import type { ChatSession } from "../src/types/chat";

/**
 * Behavioural parity for a chat turn's lifecycle, against V1's `ChatExecutionService`,
 * `ChatHistoryService` and `ChatApp`/`ContentView`.
 */

const session = (id: string, overrides: Partial<ChatSession> = {}): ChatSession => ({
  id,
  title: `Session ${id}`,
  createdAt: "2026-09-14T10:00:00Z",
  updatedAt: "2026-09-14T10:00:00Z",
  messages: [{ id: `${id}-m1`, role: "user", content: "hi", timestamp: "2026-09-14T10:00:00Z" }],
  spawnedJobIds: [],
  ...overrides,
});

const CATALOG: AgentOption[] = [
  {
    id: "claude",
    label: "Claude",
    models: [
      { id: "default", displayName: "Default" },
      { id: "claude-opus-5", displayName: "Claude Opus 5" },
    ],
    supportsEffort: true,
    efforts: [
      { id: "default", displayName: "Default" },
      { id: "high", displayName: "High" },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    models: [
      { id: "default", displayName: "Default" },
      { id: "gpt-5.5", displayName: "GPT-5.5" },
    ],
    supportsEffort: false,
    efforts: [{ id: "default", displayName: "Default" }],
  },
];

describe("chat turn lifecycle parity", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const withSessions = async (sessions: ChatSession[]) => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue(sessions);
    vi.spyOn(chatApi, "getSession").mockImplementation(
      async (id: string) => sessions.find((s) => s.id === id) ?? sessions[0],
    );
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    await chatStore.fetchSessions();
  };

  describe("generating state is per session", () => {
    it("does not report the active chat as working when another one is", async () => {
      await withSessions([session("a"), session("b")]);
      expect(chatStore.getState().activeSessionId).toBe("a");

      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "b",
        isGenerating: true,
      });

      expect(chatStore.getState().isGenerating).toBe(false);
      expect(chatStore.isSessionGenerating("b")).toBe(true);
      // `ChatApp.BuildRowState`
      expect(chatStore.sessionRowState("b")).toBe("working");
      expect(chatStore.sessionRowState("a")).toBeNull();
    });

    it("follows the session on screen when switching away from a working chat", async () => {
      await withSessions([session("a"), session("b")]);
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });
      expect(chatStore.getState().isGenerating).toBe(true);

      await chatStore.selectSession("b");
      expect(chatStore.getState().isGenerating).toBe(false);

      await chatStore.selectSession("a");
      expect(chatStore.getState().isGenerating).toBe(true);
    });

    it("marks a chat completed until it is opened, as ClearSessionCompleted does", async () => {
      await withSessions([session("a"), session("b")]);
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "b",
        isGenerating: true,
      });
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "b",
        isGenerating: false,
      });

      expect(chatStore.sessionRowState("b")).toBe("completed");
      await chatStore.selectSession("b");
      expect(chatStore.sessionRowState("b")).toBeNull();
    });

    it("treats a delta for another session as that session working", async () => {
      await withSessions([session("a"), session("b")]);
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: "b",
        messageId: "b-asst",
        delta: "working",
      });

      expect(chatStore.getState().isGenerating).toBe(false);
      expect(chatStore.sessionRowState("b")).toBe("working");
    });
  });

  describe("a finished turn is re-read", () => {
    it("re-reads the active session when its turn ends, without truncating the stream", async () => {
      const settled = session("a", {
        messages: [
          { id: "a-m1", role: "user", content: "hi", timestamp: "2026-09-14T10:00:00Z" },
          {
            id: "a-asst",
            role: "assistant",
            content: "done",
            timestamp: "2026-09-14T10:00:01Z",
            rawStream: '{"kind":"text","text":"done"}',
          },
        ],
      });
      await withSessions([settled]);

      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: "a",
        messageId: "a-asst",
        delta: " and then some",
      });
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: false,
      });

      await vi.waitFor(() => {
        const asst = chatStore.getState().activeSession?.messages.find((m) => m.id === "a-asst");
        // The raw stream only exists on the daemon's copy, so the re-read is what surfaces it...
        expect(asst?.rawStream).toBe('{"kind":"text","text":"done"}');
        // ...and the longer streamed text is kept rather than replaced by the shorter copy.
        expect(asst?.content).toBe("done and then some");
      });
    });
  });

  describe("optimistic user message", () => {
    it("is replaced by the daemon's copy rather than doubled up", async () => {
      await withSessions([session("a", { messages: [] })]);
      vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);

      await chatStore.sendMessage("look at this", {
        attachments: [{ name: "a.txt", path: "/tmp/a.txt" }],
      });
      expect(chatStore.getState().activeSession?.messages).toHaveLength(1);

      chatStore.handleChatEvent({
        type: "chat.message_added",
        sessionId: "a",
        message: {
          id: "server-1",
          role: "user",
          // The daemon's copy carries the appended block, so only a prefix match retires the row.
          content: "look at this\n\n[Attached Files]:\n- /tmp/a.txt",
          timestamp: "2026-09-14T10:00:02Z",
        },
      });

      const messages = chatStore.getState().activeSession!.messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe("server-1");
      // Attachments live only on this client, so the chips survive the swap.
      expect(messages[0].attachments).toEqual([{ name: "a.txt", path: "/tmp/a.txt" }]);
    });
  });

  describe("a refused turn", () => {
    it("leaves a running session generating and drops the row nothing will answer", async () => {
      await withSessions([session("a", { messages: [] })]);
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });
      vi.spyOn(chatApi, "executeTurn").mockRejectedValue(
        new Error("Session 'a' is already generating"),
      );

      await expect(chatStore.sendMessage("hurry up")).rejects.toThrow(/already generating/);

      expect(chatStore.getState().isGenerating).toBe(true);
      expect(chatStore.getState().activeSession?.messages).toHaveLength(0);
    });

    it("does not claim a quiet session started working", async () => {
      await withSessions([session("a", { messages: [] })]);
      vi.spyOn(chatApi, "executeTurn").mockRejectedValue(new Error("no daemon"));

      await expect(chatStore.sendMessage("hello")).rejects.toThrow(/no daemon/);

      expect(chatStore.getState().isGenerating).toBe(false);
      expect(chatStore.isSessionGenerating("a")).toBe(false);
    });
  });

  describe("cancellation", () => {
    it("clears the queue before stopping, as OnCancelStream does", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(session("a"));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([
        { id: "q1", prompt: "next", createdAt: "2026-09-14T10:00:00Z" },
      ]);
      await chatStore.fetchSessions();
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });

      const calls: string[] = [];
      vi.spyOn(chatApi, "clearQueue").mockImplementation(async () => {
        calls.push("clearQueue");
      });
      vi.spyOn(chatApi, "cancelTurn").mockImplementation(async () => {
        calls.push("cancelTurn");
        return { cancelled: true };
      });

      await chatStore.cancelGeneration();

      expect(calls).toEqual(["clearQueue", "cancelTurn"]);
      expect(chatStore.getState().queuedItems).toEqual([]);
      expect(chatStore.getState().isGenerating).toBe(false);
    });

    it("puts the queue back when it could not be cleared", async () => {
      const queued = [{ id: "q1", prompt: "next", createdAt: "2026-09-14T10:00:00Z" }];
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(session("a"));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue(queued);
      await chatStore.fetchSessions();

      vi.spyOn(chatApi, "clearQueue").mockRejectedValue(new Error("offline"));
      vi.spyOn(chatApi, "cancelTurn").mockResolvedValue({ cancelled: true });

      await chatStore.cancelGeneration();
      expect(chatStore.getState().queuedItems).toEqual(queued);
    });
  });

  describe("send a queued prompt now", () => {
    it("interrupts the turn in flight and then sends, as ForceSend does", async () => {
      let queued = [{ id: "q1", prompt: "do this first", createdAt: "2026-09-14T10:00:00Z" }];
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(session("a"));
      vi.spyOn(chatApi, "getQueue").mockImplementation(async () => queued);
      await chatStore.fetchSessions();
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });

      const deleteSpy = vi.spyOn(chatApi, "deleteQueuedItem").mockImplementation(async () => {
        queued = [];
      });
      const cancelSpy = vi.spyOn(chatApi, "cancelTurn").mockResolvedValue({ cancelled: true });
      const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);

      const pending = chatStore.sendQueuedNow("q1");
      await vi.waitFor(() => expect(cancelSpy).toHaveBeenCalledWith("a"));
      // Nothing is sent until the interrupted turn actually ends: the daemon refuses a second one.
      expect(executeSpy).not.toHaveBeenCalled();

      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: false,
      });
      await pending;

      expect(deleteSpy).toHaveBeenCalledWith("a", "q1");
      expect(executeSpy).toHaveBeenCalledWith(
        "a",
        expect.objectContaining({
          prompt: "do this first",
        }),
      );
      expect(chatStore.getState().queuedItems.map((i) => i.id)).not.toContain("q1");
    });

    it("never loses the prompt when the send fails", async () => {
      const queued = [{ id: "q1", prompt: "do this first", createdAt: "2026-09-14T10:00:00Z" }];
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(session("a"));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue(queued);
      await chatStore.fetchSessions();

      vi.spyOn(chatApi, "deleteQueuedItem").mockResolvedValue(undefined);
      vi.spyOn(chatApi, "executeTurn").mockRejectedValue(new Error("no daemon"));
      const enqueueSpy = vi.spyOn(chatApi, "enqueueItem").mockResolvedValue({
        id: "q2",
        prompt: "do this first",
        createdAt: "2026-09-14T10:00:05Z",
      });

      await chatStore.sendQueuedNow("q1");

      expect(enqueueSpy).toHaveBeenCalledWith("a", "do this first", undefined);
      expect(chatStore.getState().queuedItems.map((i) => i.prompt)).toEqual(["do this first"]);
    });
  });

  describe("a session's own agent selection", () => {
    it("is restored when the session is opened", async () => {
      vi.spyOn(agentsApi, "listAgents").mockResolvedValue(CATALOG);
      await chatStore.loadAgents();
      await withSessions([
        session("a", { agentId: "claude", modelId: "claude-opus-5", effort: "high" }),
        session("b", { agentId: "codex", modelId: "gpt-5.5" }),
      ]);

      // `fetchSessions` opened the first session, so its selection is already live.
      expect(chatStore.getState().selectedAgentId).toBe("claude");
      expect(chatStore.getState().selectedModelId).toBe("claude-opus-5");
      expect(chatStore.getState().selectedEffort).toBe("high");

      await chatStore.selectSession("b");
      expect(chatStore.getState().selectedAgentId).toBe("codex");
      expect(chatStore.getState().selectedModelId).toBe("gpt-5.5");
    });

    it("drops a model or effort the agent no longer offers", async () => {
      vi.spyOn(agentsApi, "listAgents").mockResolvedValue(CATALOG);
      await chatStore.loadAgents();
      await withSessions([session("a", { agentId: "claude", modelId: "retired-model" })]);

      // `ChatApp.ResolveModel` falls back to the catalog's default rather than passing a dead id
      // through to `--model`.
      expect(chatStore.getState().selectedModelId).toBe("default");
      expect(chatStore.resolveEffort("claude", "extreme")).toBe("default");
      expect(chatStore.resolveEffort("claude", "high")).toBe("high");
    });

    it("keeps a remembered choice while the catalog is unknown", () => {
      expect(chatStore.resolveModel("claude", "claude-opus-5")).toBe("claude-opus-5");
      expect(chatStore.resolveEffort("claude", "high")).toBe("high");
    });
  });

  describe("buildPromptWithAttachments", () => {
    it("appends the paths under the heading the agent reads", () => {
      expect(
        buildPromptWithAttachments("look", [
          { name: "a.txt", path: "/tmp/a.txt" },
          { name: "b.png", path: "/tmp/b.png" },
        ]),
      ).toBe("look\n\n[Attached Files]:\n- /tmp/a.txt\n- /tmp/b.png");
    });

    it("omits the empty prompt line when only files were sent", () => {
      expect(buildPromptWithAttachments("  ", [{ name: "a.txt", path: "/tmp/a.txt" }])).toBe(
        "[Attached Files]:\n- /tmp/a.txt",
      );
    });

    it("leaves a prompt with no attachments alone", () => {
      expect(buildPromptWithAttachments("look", [])).toBe("look");
      expect(buildPromptWithAttachments("look")).toBe("look");
    });
  });
});
