import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession, ChatMessage } from "../src/types/chat";

if (!window.HTMLElement.prototype.scrollTo) {
  window.HTMLElement.prototype.scrollTo = vi.fn();
}

const scrollIntoViewMock = vi.fn();

const { planMarkdownMountCounts } = vi.hoisted(() => ({
  planMarkdownMountCounts: new Map<string, number>(),
}));

vi.mock("@spacecorps/components-storybook/tendril", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    PlanMarkdown: ({
      id,
      content,
      eventHandler,
    }: {
      id: string;
      content: string;
      events?: string[];
      eventHandler?: (eventName: string, widgetId: string, args: unknown[]) => void;
    }) => {
      useEffect(() => {
        planMarkdownMountCounts.set(id, (planMarkdownMountCounts.get(id) ?? 0) + 1);
      }, [id]);

      return (
        <div data-testid={`plan-markdown-${id}`}>
          <pre data-testid={`plan-markdown-content-${id}`}>{content}</pre>
          <button
            data-testid={`select-answer-${id}`}
            onClick={() => {
              eventHandler?.("OnAnswersChange", id, [
                { questionId: "db-flavor", answer: ["sqlite"] },
              ]);
            }}
          >
            Select SQLite
          </button>
        </div>
      );
    },
  };
});

function buildSessionWithQuestion(count: number, questionIndex: number): ChatSession {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0;
    if (i === questionIndex) {
      messages.push({
        id: `msg-${i}`,
        role: "assistant",
        content: `Here is a decision to make:

\`\`\`questions
questions:
  - id: db-flavor
    title: Which database should we use?
    options:
      - title: SQLite
        value: sqlite
      - title: Postgres
        value: postgres
\`\`\`
`,
        timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
      });
    } else {
      messages.push({
        id: `msg-${i}`,
        role: isUser ? "user" : "assistant",
        content: isUser ? `User message ${i}` : `Assistant reply ${i}`,
        timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
      });
    }
  }
  return {
    id: "session-question-virtual",
    title: "Virtual Session with Questions",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    spawnedJobIds: [],
    messages,
  };
}

describe("Preserve Unsubmitted Question Selections Across Chat Virtualization", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    planMarkdownMountCounts.clear();
    scrollIntoViewMock.mockClear();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      value: 32000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error - restoring jsdom's own getter
    delete HTMLElement.prototype.clientHeight;
    // @ts-expect-error - restoring jsdom's own getter
    delete HTMLElement.prototype.scrollHeight;
  });

  it("preserves unsubmitted question selection when row unmounts and remounts across scroll", async () => {
    const session = buildSessionWithQuestion(200, 3);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    let resolveAnswerApi!: (val: ChatSession) => void;
    const answerPromise = new Promise<ChatSession>((resolve) => {
      resolveAnswerApi = resolve;
    });
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(answerPromise);

    const { container } = render(<ChatView />);

    await screen.findByTestId("chat-virtual-container");
    const scroller = container.querySelector("main .overflow-y-auto") as HTMLDivElement;
    expect(scroller).toBeInTheDocument();

    // Settle initial virtualization window
    await waitFor(() => {
      expect(screen.getAllByTestId("chat-virtual-row").length).toBeGreaterThan(5);
    });

    const targetMsgId = "msg-3";
    const targetMarkdownKey = `chat-msg-${targetMsgId}`;
    expect(screen.getByTestId(`plan-markdown-${targetMarkdownKey}`)).toBeInTheDocument();
    expect(planMarkdownMountCounts.get(targetMarkdownKey)).toBe(1);

    // Initial content has no answer
    const initialContentEl = screen.getByTestId(`plan-markdown-content-${targetMarkdownKey}`);
    expect(initialContentEl.textContent).not.toContain("answer:");

    // User selects SQLite on the question callout
    const selectBtn = screen.getByTestId(`select-answer-${targetMarkdownKey}`);
    act(() => {
      selectBtn.click();
    });

    // 1. Verify inProgressAnswers contains the selected answer
    expect(chatStore.getInProgressAnswers(targetMsgId)).toEqual({
      "db-flavor": ["sqlite"],
    });

    // 2. Verify content immediately reflects the selection while in flight
    expect(screen.getByTestId(`plan-markdown-content-${targetMarkdownKey}`).textContent).toContain(
      'answer: "sqlite"'
    );

    // 3. Simulate scrolling far down to tail so row 3 unmounts
    act(() => {
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 25000 });
      fireEvent.scroll(scroller);
    });

    // Verify row 3 is unmounted from the DOM
    await waitFor(() => {
      expect(screen.queryByTestId(`plan-markdown-${targetMarkdownKey}`)).not.toBeInTheDocument();
    });

    // In-progress answer is still preserved in store and session storage
    expect(chatStore.getInProgressAnswers(targetMsgId)).toEqual({
      "db-flavor": ["sqlite"],
    });

    // 4. Simulate scrolling back up to top (scrollTop = 0) so row 3 remounts
    act(() => {
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });
      fireEvent.scroll(scroller);
    });

    // Verify row 3 remounts into the DOM (mount count incremented to 2)
    await waitFor(() => {
      expect(screen.getByTestId(`plan-markdown-${targetMarkdownKey}`)).toBeInTheDocument();
    });
    expect(planMarkdownMountCounts.get(targetMarkdownKey)).toBe(2);

    // 5. Verify the question callout displays the selected answer rather than reverting to blank/unanswered
    const remountedContentEl = screen.getByTestId(`plan-markdown-content-${targetMarkdownKey}`);
    expect(remountedContentEl.textContent).toContain('answer: "sqlite"');

    // Clean up
    resolveAnswerApi({
      ...session,
      messages: [
        ...session.messages.slice(0, 3),
        {
          ...session.messages[3],
          content: session.messages[3].content.replace(
            "Which database should we use?",
            "Which database should we use?\n    answer: sqlite"
          ),
        },
        ...session.messages.slice(4),
      ],
    });
  });
});
