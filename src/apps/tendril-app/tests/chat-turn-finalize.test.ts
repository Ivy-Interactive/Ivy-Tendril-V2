import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import { agentsApi } from "../src/api/agentsApi";
import * as events from "../src/api/events";
import type { ChatEvent, ChatSession } from "../src/types/chat";

/**
 * How a turn's final content reaches the message, and why it can only reach it once.
 *
 * The bug: the chat view showed the daemon's report for a failed turn twice, concatenated with no
 * separator — "…no failure reason was found in its output.The agent exited without producing…".
 * `chat.stream_delta` is the one event handler that *appends* to the message it names, so it is only
 * correct when applied exactly once, and `init()` used to register two `chat-event` listeners when it
 * was called twice concurrently (React StrictMode invokes `ChatView`'s mount effect twice).
 */
describe("chat turn finalization", () => {
  const session: ChatSession = {
    id: "s1",
    title: "A chat",
    createdAt: "2026-09-16T10:00:00Z",
    updatedAt: "2026-09-16T10:00:00Z",
    messages: [
      { id: "m1", role: "user", content: "hi", timestamp: "2026-09-16T10:00:00Z" },
      { id: "m2", role: "assistant", content: "", timestamp: "2026-09-16T10:00:01Z" },
    ],
    spawnedJobIds: [],
  };

  /** Handlers registered through `onChatEvent`, so a frame can be delivered the way the host does. */
  let handlers: Array<(event: ChatEvent) => void> = [];

  beforeEach(() => {
    chatStore.resetForTesting();
    localStorage.clear();
    vi.restoreAllMocks();
    handlers = [];
    vi.spyOn(events, "onChatEvent").mockImplementation((handler) => {
      handlers.push(handler);
      return Promise.resolve(() => {
        handlers = handlers.filter((h) => h !== handler);
      });
    });
    vi.spyOn(agentsApi, "listAgents").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([structuredClone(session)]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(structuredClone(session));
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const deliver = (event: ChatEvent) => {
    for (const handler of handlers) handler(event);
  };

  const assistantContent = (): string | undefined =>
    chatStore.getState().activeSession?.messages.find((m) => m.id === "m2")?.content;

  it("subscribes once when two overlapping init calls race", async () => {
    await Promise.all([chatStore.init(), chatStore.init()]);

    expect(handlers).toHaveLength(1);

    deliver({ type: "chat.stream_delta", sessionId: "s1", messageId: "m2", delta: "one chunk" });

    expect(assistantContent()).toBe("one chunk");
  });

  it("applies the finished turn as an upsert, so a repeated frame cannot double it", async () => {
    await chatStore.init();

    const finalized: ChatEvent = {
      type: "chat.message_added",
      sessionId: "s1",
      message: {
        id: "m2",
        role: "assistant",
        content: "Agent execution completed with status code 1: it broke",
        timestamp: "2026-09-16T10:00:09Z",
      },
    };

    deliver(finalized);
    deliver(finalized);

    expect(assistantContent()).toBe("Agent execution completed with status code 1: it broke");
    expect(chatStore.getState().activeSession?.messages).toHaveLength(2);
  });

  it("keeps a locally known raw stream when the finalize frame omits it", async () => {
    await chatStore.init();

    deliver({
      type: "chat.message_added",
      sessionId: "s1",
      message: {
        id: "m2",
        role: "assistant",
        content: "partial",
        timestamp: "2026-09-16T10:00:05Z",
        rawStream: '{"kind":"text","text":"partial"}',
      },
    });
    deliver({
      type: "chat.message_added",
      sessionId: "s1",
      message: {
        id: "m2",
        role: "assistant",
        content: "the whole answer",
        timestamp: "2026-09-16T10:00:09Z",
      },
    });

    const message = chatStore.getState().activeSession?.messages.find((m) => m.id === "m2");
    expect(message?.content).toBe("the whole answer");
    expect(message?.rawStream).toBe('{"kind":"text","text":"partial"}');
  });
});
