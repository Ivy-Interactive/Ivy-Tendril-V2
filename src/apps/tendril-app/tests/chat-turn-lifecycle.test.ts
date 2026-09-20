import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPromptWithAttachments, chatStore, ChatStore } from "../src/state/chatStore";
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

    it("says the stop was registered before the daemon has answered", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(session("a"));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      await chatStore.fetchSessions();
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });

      // `ChatExecutionService.CancelAsync` gives the agent process time to die, so the round trip
      // is the slow part the user was pressing the button twice over.
      let finishCancel: (() => void) | null = null;
      vi.spyOn(chatApi, "cancelTurn").mockImplementation(
        () =>
          new Promise((resolve) => {
            finishCancel = () => resolve({ cancelled: true });
          }),
      );

      const pending = chatStore.cancelGeneration();

      // Published synchronously, before the first await: the composer has already re-rendered by
      // the time the user could press again.
      expect(chatStore.getState().isCancelling).toBe(true);
      expect(chatStore.getState().isGenerating).toBe(true);

      finishCancel!();
      await pending;

      expect(chatStore.getState().isCancelling).toBe(false);
      expect(chatStore.getState().isGenerating).toBe(false);
    });

    it("stays pending while the dying turn is still emitting", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(session("a"));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      await chatStore.fetchSessions();
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });

      let finishCancel: (() => void) | null = null;
      vi.spyOn(chatApi, "cancelTurn").mockImplementation(
        () =>
          new Promise((resolve) => {
            finishCancel = () => resolve({ cancelled: true });
          }),
      );

      const pending = chatStore.cancelGeneration();
      expect(chatStore.getState().isCancelling).toBe(true);

      // `cancel_session` only signals the token; the agent process keeps writing until it notices,
      // so deltas keep arriving after the stop was registered. Each one proves the session is still
      // generating, and the flag has to outlive them or the button would go live again mid-stop -
      // which is the second press the user was making.
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: "a",
        messageId: "a-m2",
        delta: "still winding down",
      });
      expect(chatStore.getState().isCancelling).toBe(true);
      expect(chatStore.getState().isGenerating).toBe(true);

      finishCancel!();
      await pending;

      expect(chatStore.getState().isCancelling).toBe(false);
      expect(chatStore.getState().isGenerating).toBe(false);
    });

    it("lets the user press stop again when the stop itself failed", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(session("a"));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      await chatStore.fetchSessions();
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });
      vi.spyOn(chatApi, "cancelTurn").mockRejectedValue(new Error("daemon unreachable"));

      await chatStore.cancelGeneration();

      // The turn is still running and the stop never landed, so a pending button would be a lie
      // the user could not get out of.
      expect(chatStore.getState().isCancelling).toBe(false);
      expect(chatStore.getState().isGenerating).toBe(true);
      expect(chatStore.getState().error).toBe("daemon unreachable");
    });

    it("keeps the pending stop with its own session when another chat is opened", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a"), session("b")]);
      vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => session(id));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      await chatStore.fetchSessions();
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "a",
        isGenerating: true,
      });

      let finishCancel: (() => void) | null = null;
      vi.spyOn(chatApi, "cancelTurn").mockImplementation(
        () =>
          new Promise((resolve) => {
            finishCancel = () => resolve({ cancelled: true });
          }),
      );

      const pending = chatStore.cancelGeneration();
      expect(chatStore.getState().isCancelling).toBe(true);

      // `state.isCancelling` describes the active session only, exactly as `isGenerating` does, so
      // reading another chat while one is stopping must not show its composer a pending stop.
      await chatStore.selectSession("b");
      expect(chatStore.getState().isCancelling).toBe(false);

      await chatStore.selectSession("a");
      expect(chatStore.getState().isCancelling).toBe(true);

      finishCancel!();
      await pending;
      expect(chatStore.getState().isCancelling).toBe(false);
    });
  });

  describe("composer drafts", () => {
    it("keeps an unsent prompt against the session it was typed in", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a"), session("b")]);
      vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => session(id));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      await chatStore.fetchSessions();

      chatStore.setComposerDraft("a", "half a thought");
      chatStore.setComposerDraft("b", "a different half");

      // Per session, never one global draft: a prompt appearing in the wrong chat is worse than
      // the prompt being lost.
      expect(chatStore.composerDraft("a")).toBe("half a thought");
      expect(chatStore.composerDraft("b")).toBe("a different half");
      expect(chatStore.composerDraft("never-typed-in")).toBe("");
      expect(chatStore.composerDraft(null)).toBe("");
    });

    it("survives a store that is thrown away and built again", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(session("a"));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      await chatStore.fetchSessions();

      chatStore.setComposerDraft("a", "written before the view went away");

      // The Chat page is a lazy route, so leaving it unmounts the composer entirely. A draft that
      // only lived in React state died here.
      const reopened = new ChatStore();
      try {
        expect(reopened.composerDraft("a")).toBe("written before the view went away");
      } finally {
        reopened.destroy();
      }
    });

    it("does not prune an empty session that is holding an unsent prompt", async () => {
      const blank = session("blank", { messages: [] });
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([blank, session("a")]);
      vi.spyOn(chatApi, "getSession").mockImplementation(async (id) =>
        id === "blank" ? blank : session(id),
      );
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      const deleteSpy = vi.spyOn(chatApi, "deleteSession").mockResolvedValue();
      await chatStore.fetchSessions();

      chatStore.setComposerDraft("blank", "typed but never sent");

      // Pruning runs on the way out of the Chat page, which is the same moment the draft is being
      // saved for. Deleting the session here would take the draft with it.
      await chatStore.pruneEmptySessions("a");

      expect(deleteSpy).not.toHaveBeenCalledWith("blank");
      expect(chatStore.getState().sessions.map((s) => s.id)).toContain("blank");
      expect(chatStore.composerDraft("blank")).toBe("typed but never sent");
    });

    it("forgets the draft of a deleted session", async () => {
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a"), session("b")]);
      vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => session(id));
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      vi.spyOn(chatApi, "deleteSession").mockResolvedValue();
      await chatStore.fetchSessions();

      chatStore.setComposerDraft("a", "for a");
      chatStore.setComposerDraft("b", "for b");

      await chatStore.deleteSession("a");

      expect(chatStore.composerDraft("a")).toBe("");
      expect(chatStore.composerDraft("b")).toBe("for b");
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
