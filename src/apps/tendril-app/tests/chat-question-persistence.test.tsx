import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { ChatMessageRow } from "../src/views/ChatMessageRow";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import { isWriteInAnswer } from "../src/utils/questionMarkdown";
import type { ChatSession, ChatMessage } from "../src/types/chat";
import { QuestionsCallout } from "@ivy-interactive/components/tendril";

if (!window.HTMLElement.prototype.scrollTo) {
  window.HTMLElement.prototype.scrollTo = vi.fn();
}

const scrollIntoViewMock = vi.fn();

const { planMarkdownMountCounts } = vi.hoisted(() => ({
  planMarkdownMountCounts: new Map<string, number>(),
}));

vi.mock("@ivy-interactive/components/tendril", async (importOriginal) => {
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
          <button
            data-testid={`select-postgres-${id}`}
            onClick={() => {
              eventHandler?.("OnAnswersChange", id, [
                { questionId: "db-flavor", answer: ["postgres"] },
              ]);
            }}
          >
            Select Postgres
          </button>
          <input
            data-testid={`input-other-${id}`}
            onChange={(e) => {
              eventHandler?.("OnAnswersChange", id, [
                { questionId: "db-flavor", answer: [e.target.value] },
              ]);
            }}
          />
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
      'answer: "sqlite"',
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
            "Which database should we use?\n    answer: sqlite",
          ),
        },
        ...session.messages.slice(4),
      ],
    });
  });
});

describe("Debounce Write-In Other Text Persistence", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const testMessage: ChatMessage = {
    id: "msg-test-1",
    role: "assistant",
    content: `\`\`\`questions
questions:
  - id: db-flavor
    title: Which database should we use?
    other: true
    options:
      - title: SQLite
        value: sqlite
      - title: Postgres
        value: postgres
\`\`\``,
    timestamp: "2026-09-07T12:00:00Z",
  };

  it("debounces rapid write-in keystrokes and executes once after 300ms", () => {
    vi.useFakeTimers();
    const setInProgressSpy = vi.spyOn(chatStore, "setInProgressAnswer");
    const submitSpy = vi.spyOn(chatStore, "submitAnswer").mockResolvedValue();

    render(
      <ChatMessageRow
        message={testMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-other-chat-msg-msg-test-1");

    // Rapid keystrokes ("c", "cu", "cust", "custom")
    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.change(input, { target: { value: "cu" } });
    fireEvent.change(input, { target: { value: "cust" } });
    fireEvent.change(input, { target: { value: "custom" } });

    // Verify intermediate keystrokes did not trigger store or submit
    expect(setInProgressSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();

    // Advance 200ms (still within 300ms debounce window)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(setInProgressSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();

    // Advance past 300ms threshold (additional 150ms => total 350ms)
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Verify executed once with final value "custom"
    expect(setInProgressSpy).toHaveBeenCalledTimes(1);
    expect(setInProgressSpy).toHaveBeenCalledWith("msg-test-1", "db-flavor", ["custom"]);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledWith("msg-test-1", "db-flavor", ["custom"]);
  });

  it("bypasses debounce and updates store immediately on discrete option click", () => {
    vi.useFakeTimers();
    const setInProgressSpy = vi.spyOn(chatStore, "setInProgressAnswer");
    const submitSpy = vi.spyOn(chatStore, "submitAnswer").mockResolvedValue();

    render(
      <ChatMessageRow
        message={testMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    const selectBtn = screen.getByTestId("select-answer-chat-msg-msg-test-1");
    fireEvent.click(selectBtn);

    // Verify immediate execution without advancing timers
    expect(setInProgressSpy).toHaveBeenCalledTimes(1);
    expect(setInProgressSpy).toHaveBeenCalledWith("msg-test-1", "db-flavor", ["sqlite"]);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledWith("msg-test-1", "db-flavor", ["sqlite"]);
  });

  it("flushes pending write-in commits to store and storage upon row unmount", () => {
    vi.useFakeTimers();
    const setInProgressSpy = vi.spyOn(chatStore, "setInProgressAnswer");
    const submitSpy = vi.spyOn(chatStore, "submitAnswer").mockResolvedValue();

    const { unmount } = render(
      <ChatMessageRow
        message={testMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-other-chat-msg-msg-test-1");
    fireEvent.change(input, { target: { value: "custom-db" } });

    // Not triggered before unmount
    expect(setInProgressSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();

    // Simulate immediate unmount (e.g. scrolling out of view in virtualization)
    unmount();

    // Verify pending commit was flushed immediately upon unmount
    expect(setInProgressSpy).toHaveBeenCalledTimes(1);
    expect(setInProgressSpy).toHaveBeenCalledWith("msg-test-1", "db-flavor", ["custom-db"]);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledWith("msg-test-1", "db-flavor", ["custom-db"]);
    expect(localStorage.getItem("tendril:chat:in_progress_answers")).toContain("custom-db");
  });

  it("cancels pending write-in timer when an option is clicked before debounce expires", () => {
    vi.useFakeTimers();
    const setInProgressSpy = vi.spyOn(chatStore, "setInProgressAnswer");
    const submitSpy = vi.spyOn(chatStore, "submitAnswer").mockResolvedValue();

    render(
      <ChatMessageRow
        message={testMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-other-chat-msg-msg-test-1");
    const selectBtn = screen.getByTestId("select-answer-chat-msg-msg-test-1");

    // Type in Other
    fireEvent.change(input, { target: { value: "cust" } });
    expect(setInProgressSpy).not.toHaveBeenCalled();

    // Before timer fires (e.g. 100ms), user clicks SQLite option
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(selectBtn);

    // Option selection executes immediately
    expect(setInProgressSpy).toHaveBeenCalledTimes(1);
    expect(setInProgressSpy).toHaveBeenCalledWith("msg-test-1", "db-flavor", ["sqlite"]);

    // Advance past the original debounce threshold
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Verify the write-in was cancelled and was never committed
    expect(setInProgressSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });
});

describe("isWriteInAnswer helper", () => {
  const contentWithOptions = `\`\`\`questions
questions:
  - id: q-db
    title: Database?
    options:
      - title: SQLite
        value: sqlite
      - title: Postgres
        value: postgres
\`\`\``;

  const contentFreeText = `\`\`\`questions
questions:
  - id: q-freetext
    title: Any feedback?
\`\`\``;

  it("returns false for predefined option clicks", () => {
    expect(isWriteInAnswer(contentWithOptions, "q-db", "sqlite")).toBe(false);
    expect(isWriteInAnswer(contentWithOptions, "q-db", ["postgres"])).toBe(false);
    expect(isWriteInAnswer(contentWithOptions, "q-db", ["sqlite", "postgres"])).toBe(false);
  });

  it("returns true for write-in values not in options", () => {
    expect(isWriteInAnswer(contentWithOptions, "q-db", "mariadb")).toBe(true);
    expect(isWriteInAnswer(contentWithOptions, "q-db", ["sqlite", "mariadb"])).toBe(true);
  });

  it("returns true for free-text questions with text", () => {
    expect(isWriteInAnswer(contentFreeText, "q-freetext", "looks good")).toBe(true);
    expect(isWriteInAnswer(contentFreeText, "q-freetext", ["some notes"])).toBe(true);
  });

  it("treats empty answers as immediate unless a debounced write-in was pending", () => {
    expect(isWriteInAnswer(contentWithOptions, "q-db", "")).toBe(false);
    expect(isWriteInAnswer(contentWithOptions, "q-db", null)).toBe(false);
    expect(isWriteInAnswer(contentWithOptions, "q-db", [])).toBe(false);

    // When pending debounce was active, backspacing to empty is debounced
    expect(isWriteInAnswer(contentWithOptions, "q-db", "", true)).toBe(true);
    expect(isWriteInAnswer(contentWithOptions, "q-db", [], true)).toBe(true);
  });
});

describe("Optimistic Question Answer State and Streaming Block Interactivity", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  const questionMessage: ChatMessage = {
    id: "msg-opt-1",
    role: "assistant",
    content: `Here is a question:

\`\`\`questions
questions:
  - id: db-flavor
    title: Which database should we use?
    other: true
    options:
      - title: SQLite
        value: sqlite
      - title: Postgres
        value: postgres
\`\`\``,
    timestamp: "2026-09-14T10:00:00Z",
  };

  it("optimistic answer display reflects selected state immediately upon option selection while answerQuestions API call is pending", async () => {
    let resolveApi!: (val: ChatSession) => void;
    const pendingPromise = new Promise<ChatSession>((resolve) => {
      resolveApi = resolve;
    });
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(pendingPromise);

    const session: ChatSession = {
      id: "session-opt-1",
      title: "Optimistic Session",
      createdAt: "2026-09-14T10:00:00Z",
      updatedAt: "2026-09-14T10:00:00Z",
      spawnedJobIds: [],
      messages: [questionMessage],
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.init();

    render(
      <ChatMessageRow
        message={questionMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    const selectBtn = screen.getByTestId("select-answer-chat-msg-msg-opt-1");

    // Click option
    act(() => {
      fireEvent.click(selectBtn);
    });

    // Content immediately reflects answer while answerQuestions is in flight
    const contentEl = screen.getByTestId("plan-markdown-content-chat-msg-msg-opt-1");
    expect(contentEl.textContent).toContain('answer: "sqlite"');

    // Clean up
    resolveApi({
      ...session,
      messages: [
        {
          ...questionMessage,
          content: questionMessage.content.replace(
            "title: Which database should we use?",
            'title: Which database should we use?\n    answer: "sqlite"',
          ),
        },
      ],
    });
  });

  it("submitting indicator is active while submitAnswer is in flight and clears once confirmed", async () => {
    let resolveApi!: (val: ChatSession) => void;
    const pendingPromise = new Promise<ChatSession>((resolve) => {
      resolveApi = resolve;
    });
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(pendingPromise);

    const session: ChatSession = {
      id: "session-opt-2",
      title: "Submitting Indicator Session",
      createdAt: "2026-09-14T10:00:00Z",
      updatedAt: "2026-09-14T10:00:00Z",
      spawnedJobIds: [],
      messages: [questionMessage],
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.init();

    render(
      <ChatMessageRow
        message={questionMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("submitting-answer-indicator")).not.toBeInTheDocument();

    const selectBtn = screen.getByTestId("select-answer-chat-msg-msg-opt-1");
    act(() => {
      fireEvent.click(selectBtn);
    });

    // Indicator is active while in flight
    expect(screen.getByTestId("submitting-answer-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("submitting-answer-indicator").textContent).toContain(
      "Submitting answer...",
    );
    expect(chatStore.isSubmittingAnswer("msg-opt-1", "db-flavor")).toBe(true);

    // Resolve API
    await act(async () => {
      resolveApi({
        ...session,
        messages: [
          {
            ...questionMessage,
            content: questionMessage.content.replace(
              "title: Which database should we use?",
              'title: Which database should we use?\n    answer: "sqlite"',
            ),
          },
        ],
      });
    });

    // Submitting indicator clears once confirmed
    await waitFor(() => {
      expect(screen.queryByTestId("submitting-answer-indicator")).not.toBeInTheDocument();
      expect(chatStore.isSubmittingAnswer("msg-opt-1", "db-flavor")).toBe(false);
    });
  });

  it("question block does not flicker or revert to unanswered during the submission-to-turn transition when API resolves or chat.question_answered event fires", async () => {
    let resolveApi!: (val: ChatSession) => void;
    const pendingPromise = new Promise<ChatSession>((resolve) => {
      resolveApi = resolve;
    });
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(pendingPromise);

    const session: ChatSession = {
      id: "session-opt-3",
      title: "No Flicker Session",
      createdAt: "2026-09-14T10:00:00Z",
      updatedAt: "2026-09-14T10:00:00Z",
      spawnedJobIds: [],
      messages: [questionMessage],
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.init();

    render(
      <ChatMessageRow
        message={questionMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    const selectBtn = screen.getByTestId("select-answer-chat-msg-msg-opt-1");
    act(() => {
      fireEvent.click(selectBtn);
    });

    const contentEl = screen.getByTestId("plan-markdown-content-chat-msg-msg-opt-1");
    expect(contentEl.textContent).toContain('answer: "sqlite"');

    // Simulate chat.question_answered event firing before/during API transition
    act(() => {
      chatStore.handleChatEvent({
        type: "chat.question_answered",
        sessionId: session.id,
        messageId: "msg-opt-1",
        answers: { "db-flavor": ["sqlite"] },
      });
    });

    // Content stays answered, zero flicker or reversion to unanswered
    expect(screen.getByTestId("plan-markdown-content-chat-msg-msg-opt-1").textContent).toContain(
      'answer: "sqlite"',
    );

    const confirmedSession: ChatSession = {
      ...session,
      messages: [
        {
          ...questionMessage,
          content: questionMessage.content.replace(
            "title: Which database should we use?",
            'title: Which database should we use?\n    answer: "sqlite"',
          ),
        },
      ],
    };

    await act(async () => {
      resolveApi(confirmedSession);
    });

    expect(screen.getByTestId("plan-markdown-content-chat-msg-msg-opt-1").textContent).toContain(
      'answer: "sqlite"',
    );
  });

  it("streaming interactivity allows selecting an option and submitting a question block in an assistant message while chat.stream_delta events are actively arriving, without dropping subsequent stream deltas", async () => {
    let resolveApi!: (val: ChatSession) => void;
    const pendingPromise = new Promise<ChatSession>((resolve) => {
      resolveApi = resolve;
    });
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(pendingPromise);

    const streamingMsg: ChatMessage = {
      id: "msg-stream-1",
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
      timestamp: "2026-09-14T10:00:00Z",
    };

    const session: ChatSession = {
      id: "session-stream-1",
      title: "Streaming Session",
      createdAt: "2026-09-14T10:00:00Z",
      updatedAt: "2026-09-14T10:00:00Z",
      spawnedJobIds: [],
      messages: [streamingMsg],
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.init();

    // Mark as generating
    chatStore.handleChatEvent({
      type: "chat.generating_state",
      sessionId: session.id,
      isGenerating: true,
    });

    // Start submission of question answer while streaming is active
    const submitPromise = chatStore.submitAnswer("msg-stream-1", "db-flavor", ["sqlite"]);

    // Stream deltas arrive while answer is in flight
    act(() => {
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: session.id,
        messageId: "msg-stream-1",
        delta: "\nNow beginning migration step 1...\n",
      });
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: session.id,
        messageId: "msg-stream-1",
        delta: "Step 2: Table creation completed successfully.\n",
      });
    });

    // Server responds with confirmed answered question block
    const serverSession: ChatSession = {
      ...session,
      messages: [
        {
          id: "msg-stream-1",
          role: "assistant",
          content: streamingMsg.content.replace(
            "title: Which database should we use?",
            'title: Which database should we use?\n    answer: "sqlite"',
          ),
          timestamp: "2026-09-14T10:00:01Z",
        },
      ],
    };

    await act(async () => {
      resolveApi(serverSession);
      await submitPromise;
    });

    const activeMessages = chatStore.getState().activeSession?.messages ?? [];
    const activeMsg = activeMessages.find((m) => m.id === "msg-stream-1");
    expect(activeMsg).toBeDefined();

    // Confirmed answer is present
    expect(activeMsg!.content).toContain('answer: "sqlite"');

    // And subsequent stream deltas that arrived while in flight are completely preserved!
    expect(activeMsg!.content).toContain("Now beginning migration step 1...");
    expect(activeMsg!.content).toContain("Step 2: Table creation completed successfully.");
  });

  it("typing in Other text is not wiped or reset by incoming stream deltas", () => {
    const onAnswer = vi.fn();
    const questionsBody = `questions:
  - id: custom-feedback
    title: Any feedback?
    other: true
    options:
      - title: Looks good
        value: looks-good`;

    const { container, rerender } = render(
      <QuestionsCallout content={questionsBody} onAnswer={onAnswer} />,
    );

    const otherRadio = container.querySelector(
      ".tq-option--other .tq-option-input",
    ) as HTMLInputElement;
    fireEvent.click(otherRadio);

    const input = container.querySelector("input.tq-text-input") as HTMLInputElement;
    expect(input).toBeInTheDocument();

    // User focuses the other input and types in-progress draft text
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "My custom write-in draft" } });
    expect(input.value).toBe("My custom write-in draft");

    // Incoming stream deltas modify the content prop of QuestionsCallout
    rerender(
      <QuestionsCallout
        content={questionsBody + "\n# Streaming delta token token"}
        onAnswer={onAnswer}
      />,
    );

    // Active input text must NOT be wiped or reset
    expect(input.value).toBe("My custom write-in draft");
  });

  it("answer selections and in-progress drafts persist across window resize events and component unmount/remount", () => {
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <ChatMessageRow
        message={questionMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    const selectBtn = screen.getByTestId("select-answer-chat-msg-msg-opt-1");
    act(() => {
      fireEvent.click(selectBtn);
    });

    // Selection recorded in store
    expect(chatStore.getInProgressAnswers("msg-opt-1")).toEqual({
      "db-flavor": ["sqlite"],
    });

    // Window resize event occurs
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    // Selection persists in UI
    expect(screen.getByTestId("plan-markdown-content-chat-msg-msg-opt-1").textContent).toContain(
      'answer: "sqlite"',
    );

    // Unmount
    unmount();

    // Remount
    render(
      <ChatMessageRow
        message={questionMessage}
        isCopied={false}
        onCopy={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );

    // Remounted row immediately shows the in-progress answer
    expect(screen.getByTestId("plan-markdown-content-chat-msg-msg-opt-1").textContent).toContain(
      'answer: "sqlite"',
    );
  });
});
