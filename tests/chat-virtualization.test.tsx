import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession, ChatMessage } from "../src/types/chat";

const { planMarkdownMountCounts } = vi.hoisted(() => ({
  planMarkdownMountCounts: new Map<string, number>(),
}));

vi.mock("@spacecorps/components-storybook/tendril", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // The real PlanMarkdown pulls in react-markdown + math plugins, which is
    // both slow for a 200-message fixture and irrelevant to the windowing
    // contract under test here. Track mounts (not renders) via an
    // empty-deps effect so "does row identity survive a re-render" is
    // testable without asserting on internal implementation details.
    PlanMarkdown: ({ id, content }: { id: string; content: string }) => {
      useEffect(() => {
        planMarkdownMountCounts.set(id, (planMarkdownMountCounts.get(id) ?? 0) + 1);
      }, [id]);
      return React.createElement("div", { "data-testid": `plan-markdown-${id}` }, content);
    },
  };
});

const scrollIntoViewMock = vi.fn();

function buildLongSession(count: number): ChatSession {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0;
    messages.push({
      id: `msg-${i}`,
      role: isUser ? "user" : "assistant",
      content: isUser ? `User message ${i}` : `Assistant reply ${i}`,
      timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
    });
  }
  return {
    id: "session-long",
    title: "Long Session",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    spawnedJobIds: [],
    messages,
  };
}

describe("ChatView message virtualization", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    planMarkdownMountCounts.clear();
    scrollIntoViewMock.mockClear();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    window.HTMLElement.prototype.scrollTo = vi.fn();

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      value: 20000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error - restoring jsdom's own (non-configurable-by-default) getter
    delete HTMLElement.prototype.clientHeight;
    // @ts-expect-error - restoring jsdom's own (non-configurable-by-default) getter
    delete HTMLElement.prototype.scrollHeight;
  });

  it("renders far fewer DOM rows than messages for a long session", async () => {
    const session = buildLongSession(200);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    const container = await screen.findByTestId("chat-virtual-container");
    expect(container).toBeInTheDocument();

    const rows = screen.getAllByTestId("chat-virtual-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(40);
  });

  it("always keeps the last message in the DOM, at rest and while streaming", async () => {
    const session = buildLongSession(200);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await screen.findByTestId("chat-virtual-container");
    const lastIndex = session.messages.length - 1;
    expect(screen.getByText(`Assistant reply ${lastIndex}`)).toBeInTheDocument();

    act(() => {
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: session.id,
        isGenerating: true,
      });
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: session.id,
        messageId: `msg-${lastIndex}`,
        delta: " streamed more",
      });
    });

    expect(screen.getByText(`Assistant reply ${lastIndex} streamed more`)).toBeInTheDocument();
  });

  it("does not virtualize a session below the threshold, rendering every message", async () => {
    const session = buildLongSession(3);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await screen.findByTestId("chat-scroll-anchor");
    expect(screen.queryByTestId("chat-virtual-container")).not.toBeInTheDocument();
    for (const msg of session.messages) {
      expect(screen.getByText(msg.content)).toBeInTheDocument();
    }
  });

  it("keeps the scroll anchor last and scrolls to tail on click while virtualized", async () => {
    const session = buildLongSession(200);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const { container } = render(<ChatView />);

    await screen.findByTestId("chat-virtual-container");
    const anchor = screen.getByTestId("chat-scroll-anchor");
    const scroller = container.querySelector("main .overflow-y-auto");
    expect(scroller).toBeInTheDocument();
    // The anchor must sort after every virtual row so useChatAutoScroll's
    // scrollIntoView keeps landing on the true tail of the thread.
    const rows = screen.getAllByTestId("chat-virtual-row");
    for (const row of rows) {
      expect(row.compareDocumentPosition(anchor)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }

    const tailBtn = screen.queryByTestId("chat-scroll-tail-button");
    if (tailBtn) {
      scrollIntoViewMock.mockClear();
      act(() => {
        tailBtn.click();
      });
      expect(scrollIntoViewMock).toHaveBeenCalled();
    }
  });

  it("does not remount unaffected rows when the tail message streams", async () => {
    const session = buildLongSession(200);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);
    await screen.findByTestId("chat-virtual-container");

    // The window widens across a couple of effect passes as the hook picks up
    // the scroll container and its real (stubbed) clientHeight; wait for it to
    // settle before taking the "before" snapshot, or this test would flake on
    // the transient narrower window from the first paint.
    await waitFor(() => {
      expect(screen.getAllByTestId("chat-virtual-row").length).toBeGreaterThan(8);
    });

    const rowsBefore = screen
      .getAllByTestId("chat-virtual-row")
      .map((el) => el.getAttribute("data-index"));
    const visibleAssistantIndex = rowsBefore
      .map((v) => Number(v))
      .find((i) => i % 2 === 1 && i !== session.messages.length - 1);
    expect(visibleAssistantIndex).toBeDefined();

    const unaffectedKey = `chat-msg-msg-${visibleAssistantIndex}`;
    const mountsBefore = planMarkdownMountCounts.get(unaffectedKey);
    expect(mountsBefore).toBe(1);

    const lastIndex = session.messages.length - 1;
    act(() => {
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: session.id,
        messageId: `msg-${lastIndex}`,
        delta: " more",
      });
    });

    const rowsAfter = screen
      .getAllByTestId("chat-virtual-row")
      .map((el) => el.getAttribute("data-index"));
    expect(rowsAfter).toEqual(rowsBefore);
    expect(planMarkdownMountCounts.get(unaffectedKey)).toBe(1);
  });

  it("displays jump affordance when an unanswered question block is scrolled out of view and jumps to it", async () => {
    const session = buildLongSession(60);
    session.messages[10] = {
      id: "msg-10",
      role: "assistant",
      content: `Here is a pending question:
\`\`\`questions
questions:
  - id: choice-arch
    title: Which architecture?
    options:
      - title: Option A
        value: a
\`\`\``,
      timestamp: new Date(2026, 0, 1, 0, 10).toISOString(),
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const { container } = render(<ChatView />);
    await screen.findByTestId("chat-virtual-container");

    const scroller = container.querySelector("main .overflow-y-auto") as HTMLDivElement;
    expect(scroller).toBeInTheDocument();

    // Scroll to the tail (message 59)
    act(() => {
      scroller.scrollTop = 9000;
      scroller.dispatchEvent(new Event("scroll"));
    });

    // Jump affordance button should be visible with upward direction
    const jumpBtn = await screen.findByTestId("chat-jump-to-question-button");
    expect(jumpBtn).toBeInTheDocument();
    expect(jumpBtn).toHaveTextContent(/Jump to pending question ↑/i);

    // Verify message 10 is currently unmounted from the DOM
    expect(screen.queryByTestId("plan-markdown-chat-msg-msg-10")).not.toBeInTheDocument();

    // Clicking the jump affordance calls scrollToIndex(10)
    act(() => {
      jumpBtn.click();
      scroller.dispatchEvent(new Event("scroll"));
    });

    // Message 10 is now mounted in the virtualized DOM window
    await waitFor(() => {
      expect(screen.getByTestId("plan-markdown-chat-msg-msg-10")).toBeInTheDocument();
    });
  });

  it("confirms jump affordance still functions below the virtualization threshold when scrolled away", async () => {
    const session = buildLongSession(5);
    session.messages[0] = {
      id: "msg-0",
      role: "assistant",
      content: `Question at 0:
\`\`\`questions
questions:
  - id: q0
    title: First?
    options:
      - title: Yes
        value: yes
\`\`\``,
      timestamp: new Date(2026, 0, 1, 0, 0).toISOString(),
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const { container } = render(<ChatView />);
    await screen.findByTestId("chat-scroll-anchor");

    const scroller = container.querySelector("main .overflow-y-auto") as HTMLDivElement;
    expect(scroller).toBeInTheDocument();

    // Scroll down away from message 0
    act(() => {
      scroller.scrollTop = 1000;
      scroller.dispatchEvent(new Event("scroll"));
    });

    const jumpBtn = await screen.findByTestId("chat-jump-to-question-button");
    expect(jumpBtn).toBeInTheDocument();
    expect(jumpBtn).toHaveTextContent(/Jump to pending question ↑/i);

    // Clicking the jump button triggers scroll
    scrollIntoViewMock.mockClear();
    act(() => {
      jumpBtn.click();
    });
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("dismisses the jump affordance when the question is answered", async () => {
    const session = buildLongSession(60);
    session.messages[10] = {
      id: "msg-10",
      role: "assistant",
      content: `Question:
\`\`\`questions
questions:
  - id: choice-arch
    title: Which arch?
    options:
      - title: Option A
        value: a
\`\`\``,
      timestamp: new Date(2026, 0, 1, 0, 10).toISOString(),
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const { container } = render(<ChatView />);
    await screen.findByTestId("chat-virtual-container");

    const scroller = container.querySelector("main .overflow-y-auto") as HTMLDivElement;
    act(() => {
      scroller.scrollTop = 9000;
      scroller.dispatchEvent(new Event("scroll"));
    });

    const jumpBtn = await screen.findByTestId("chat-jump-to-question-button");
    expect(jumpBtn).toBeInTheDocument();

    const answeredSession: ChatSession = {
      ...session,
      messages: session.messages.map((m) =>
        m.id === "msg-10"
          ? {
              ...m,
              content: `Question:
\`\`\`questions
questions:
  - id: choice-arch
    title: Which arch?
    options:
      - title: Option A
        value: a
    answer:
      - a
\`\`\``,
            }
          : m,
      ),
    };
    vi.spyOn(chatApi, "answerQuestions").mockResolvedValue(answeredSession);

    // Answer the question via chatStore.submitAnswer
    await act(async () => {
      await chatStore.submitAnswer("msg-10", "choice-arch", ["a"]);
    });

    // Jump button is dismissed
    await waitFor(() => {
      expect(screen.queryByTestId("chat-jump-to-question-button")).not.toBeInTheDocument();
    });
  });
});
