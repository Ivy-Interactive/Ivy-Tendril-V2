import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { ChatMessageRow } from "../src/views/ChatMessageRow";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
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
  const { BlockHandler } = actual as {
    BlockHandler: React.FC<React.HTMLAttributes<HTMLElement>>;
  };
  return {
    ...actual,
    /**
     * Stands in for the renderer, not for the questions block. react-markdown and the math plugins
     * are slow and irrelevant here, but `BlockHandler` is what reads `QuestionsSubmitContext` and
     * picks the chat branch of `QuestionsCallout`, so the real one is mounted against the fence
     * this content carries. A stub that fabricated its own buttons would assert the mock's wiring
     * rather than the row's.
     */
    PlanMarkdown: ({ id, content }: { id: string; content: string }) => {
      useEffect(() => {
        planMarkdownMountCounts.set(id, (planMarkdownMountCounts.get(id) ?? 0) + 1);
      }, [id]);

      const fence = /```questions\n([\s\S]*?)```/.exec(content);

      return (
        <div data-testid={`plan-markdown-${id}`}>
          <pre data-testid={`plan-markdown-content-${id}`}>{content}</pre>
          {fence && <BlockHandler className="language-questions">{`${fence[1]}\n`}</BlockHandler>}
        </div>
      );
    },
  };
});

/** Clicks the option card carrying this title inside the given message's rendered block. */
function selectOption(messageId: string, title: string): void {
  const block = screen.getByTestId(`plan-markdown-chat-msg-${messageId}`);
  const option = Array.from(block.querySelectorAll(".tq-option-title")).find((el) =>
    el.textContent?.startsWith(title),
  );
  if (!option) throw new Error(`No option titled "${title}" in message ${messageId}`);
  fireEvent.click(option.closest(".tq-option") as HTMLElement);
}

/** The block's Submit button, which is disabled until something is answered. */
function submitButton(messageId: string): HTMLButtonElement {
  const block = screen.getByTestId(`plan-markdown-chat-msg-${messageId}`);
  return block.querySelector("button.tq-submit") as HTMLButtonElement;
}

/** Types into the block's Other field, opening it first. */
function writeOther(messageId: string, text: string): void {
  const block = screen.getByTestId(`plan-markdown-chat-msg-${messageId}`);
  const other = block.querySelector(".tq-option--other .tq-option-input") as HTMLInputElement;
  fireEvent.click(other);
  const input = block.querySelector("input.tq-text-input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
}

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

  it("preserves an unsubmitted question selection when the row unmounts and remounts across scroll", async () => {
    const session = buildSessionWithQuestion(200, 3);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const answerSpy = vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));

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

    // User selects SQLite but does not submit
    selectOption(targetMsgId, "SQLite");
    expect(answerSpy).not.toHaveBeenCalled();

    // 1. Scroll far down to the tail so row 3 unmounts
    act(() => {
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 25000 });
      fireEvent.scroll(scroller);
    });

    await waitFor(() => {
      expect(screen.queryByTestId(`plan-markdown-${targetMarkdownKey}`)).not.toBeInTheDocument();
    });

    // 2. Scroll back to the top so row 3 remounts
    act(() => {
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });
      fireEvent.scroll(scroller);
    });

    await waitFor(() => {
      expect(screen.getByTestId(`plan-markdown-${targetMarkdownKey}`)).toBeInTheDocument();
    });
    expect(planMarkdownMountCounts.get(targetMarkdownKey)).toBe(2);

    // 3. The remounted block still carries the selection rather than reverting to unanswered.
    const block = screen.getByTestId(`plan-markdown-${targetMarkdownKey}`);
    const selected = Array.from(block.querySelectorAll(".tq-option[data-selected='true']"));
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("SQLite");
    expect(submitButton(targetMsgId).disabled).toBe(false);
  });
});

/**
 * V1 batches a chat question block: `ChatQuestionsBlock` drafts answers locally and Submit fires
 * `OnAnswerQuestion` once, which applies the whole map and then sends the summary as the next user
 * turn (`ContentView.cs:264-279`). The live `OnAnswersChange` path V2 had instead meant one round
 * trip per keystroke, which is why it carried a 300ms debounce; these cover the batched contract
 * that replaced it.
 */
describe("Batched Chat Question Submission", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
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

  const twoQuestionMessage: ChatMessage = {
    id: "msg-test-2",
    role: "assistant",
    content: `\`\`\`questions
questions:
  - id: db-flavor
    title: Which database should we use?
    options:
      - title: SQLite
        value: sqlite
      - title: Postgres
        value: postgres
  - id: deploy-target
    title: Where should it run?
    options:
      - title: Docker
        value: docker
      - title: Bare metal
        value: metal
\`\`\``,
    timestamp: "2026-09-07T12:00:00Z",
  };

  /** Opens a session holding `message` and returns once the store has it selected. */
  async function openSessionWith(message: ChatMessage): Promise<ChatSession> {
    const session: ChatSession = {
      id: "session-batched",
      title: "Batched Session",
      createdAt: "2026-09-07T12:00:00Z",
      updatedAt: "2026-09-07T12:00:00Z",
      spawnedJobIds: [],
      messages: [message],
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    await chatStore.fetchSessions();
    return session;
  }

  it("drafts locally and reaches the daemon only once Submit is pressed", async () => {
    await openSessionWith(testMessage);
    const answerSpy = vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));
    vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);

    render(<ChatMessageRow message={testMessage} />);

    selectOption("msg-test-1", "SQLite");
    // Selecting reworks the draft, not the conversation: V1's chat block reports nothing until
    // Submit, which is the whole difference from the plan surface's live answers.
    expect(answerSpy).not.toHaveBeenCalled();

    // Changing your mind before submitting also costs nothing.
    selectOption("msg-test-1", "Postgres");
    expect(answerSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(submitButton("msg-test-1"));
    });

    expect(answerSpy).toHaveBeenCalledTimes(1);
    expect(answerSpy).toHaveBeenCalledWith("session-batched", "msg-test-1", {
      "db-flavor": ["postgres"],
    });
  });

  it("sends every question of the block in one call", async () => {
    await openSessionWith(twoQuestionMessage);
    const answerSpy = vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));
    vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);

    render(<ChatMessageRow message={twoQuestionMessage} />);

    selectOption("msg-test-2", "SQLite");
    selectOption("msg-test-2", "Docker");

    await act(async () => {
      fireEvent.click(submitButton("msg-test-2"));
    });

    expect(answerSpy).toHaveBeenCalledTimes(1);
    expect(answerSpy).toHaveBeenCalledWith("session-batched", "msg-test-2", {
      "db-flavor": ["sqlite"],
      "deploy-target": ["docker"],
    });
  });

  it("carries typed Other text through without a debounce", async () => {
    await openSessionWith(testMessage);
    const answerSpy = vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));
    vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);

    render(<ChatMessageRow message={testMessage} />);

    writeOther("msg-test-1", "MariaDB");
    // No timer to wait out: typing only touches the local draft.
    expect(answerSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(submitButton("msg-test-1"));
    });

    expect(answerSpy).toHaveBeenCalledWith("session-batched", "msg-test-1", {
      "db-flavor": ["MariaDB"],
    });
  });

  it("sends the answers summary as the next user turn, after the block is stored", async () => {
    const session = await openSessionWith(testMessage);

    const order: string[] = [];
    const answeredSession: ChatSession = {
      ...session,
      messages: [
        {
          ...testMessage,
          content: testMessage.content.replace(
            "title: Which database should we use?",
            'title: Which database should we use?\n    answer: "sqlite"',
          ),
        },
      ],
    };
    vi.spyOn(chatApi, "answerQuestions").mockImplementation(async () => {
      order.push("answerQuestions");
      return answeredSession;
    });
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockImplementation(async () => {
      order.push("executeTurn");
    });

    render(<ChatMessageRow message={testMessage} />);

    selectOption("msg-test-1", "SQLite");
    await act(async () => {
      fireEvent.click(submitButton("msg-test-1"));
    });

    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalled();
    });

    // The document is written before the agent is told about it, as `OnAnswerQuestion` orders it.
    expect(order).toEqual(["answerQuestions", "executeTurn"]);
    expect(executeSpy.mock.calls[0][1]).toMatchObject({
      prompt: "Answers:\n- **Which database should we use?**: SQLite",
    });
  });

  it("holds the drafted answers on screen while the round trip is in flight", async () => {
    await openSessionWith(testMessage);
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));
    vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);

    render(<ChatMessageRow message={testMessage} />);

    selectOption("msg-test-1", "SQLite");
    await act(async () => {
      fireEvent.click(submitButton("msg-test-1"));
    });

    // Submit does not visibly reset the form: the submitted answers are presented until the
    // document catches up, and the store carries them in the meantime.
    expect(chatStore.getInProgressAnswers("msg-test-1")).toEqual({ "db-flavor": ["sqlite"] });
    expect(
      screen.getByTestId("plan-markdown-chat-msg-msg-test-1").querySelector(".tq-answer-value")
        ?.textContent,
    ).toBe("SQLite");
  });

  it("keeps an unsubmitted draft across a remount of the row", async () => {
    await openSessionWith(testMessage);
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));

    const { unmount } = render(<ChatMessageRow message={testMessage} />);
    selectOption("msg-test-1", "Postgres");
    unmount();

    // Virtualization remounts a row every time it scrolls back into the window, and nothing has
    // been submitted yet, so the draft has to live above the row - `chatStore.questionDraftStore`,
    // which is V1's `questionDraftsRef`.
    render(<ChatMessageRow message={testMessage} />);
    const block = screen.getByTestId("plan-markdown-chat-msg-msg-test-1");
    const selected = Array.from(block.querySelectorAll(".tq-option[data-selected='true']"));
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("Postgres");
  });

  it("gates Submit on the block carrying an answer", async () => {
    await openSessionWith(testMessage);
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));

    render(<ChatMessageRow message={testMessage} />);

    // A disabled button's click is a no-op whatever the handler does, so this asserts the gate
    // itself: closed with nothing answered, open once something is.
    expect(submitButton("msg-test-1").disabled).toBe(true);
    expect(submitButton("msg-test-1").title).toBe("Answer a question to submit.");

    selectOption("msg-test-1", "SQLite");
    expect(submitButton("msg-test-1").disabled).toBe(false);
  });
});

describe("Optimistic Question Answer State and Streaming Block Interactivity", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    // Submitting a block now posts the summary as the next user turn, so every test here reaches
    // `executeTurn` once its `answerQuestions` settles. Left unstubbed it hits the real Tauri
    // `invoke` and rejects after the test has finished, which surfaces as an unhandled rejection.
    vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);
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

    render(<ChatMessageRow message={questionMessage} />);

    selectOption("msg-opt-1", "SQLite");
    await act(async () => {
      fireEvent.click(submitButton("msg-opt-1"));
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

  it("submitting indicator is active while the submission is in flight and clears once confirmed", async () => {
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

    render(<ChatMessageRow message={questionMessage} />);

    expect(screen.queryByTestId("submitting-answer-indicator")).not.toBeInTheDocument();

    selectOption("msg-opt-1", "SQLite");
    await act(async () => {
      fireEvent.click(submitButton("msg-opt-1"));
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

    render(<ChatMessageRow message={questionMessage} />);

    selectOption("msg-opt-1", "SQLite");
    await act(async () => {
      fireEvent.click(submitButton("msg-opt-1"));
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
    const submitPromise = chatStore.submitAnswers("msg-stream-1", { "db-flavor": ["sqlite"] });

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

  it("answer selections and in-progress drafts persist across window resize events and component unmount/remount", async () => {
    vi.spyOn(chatApi, "answerQuestions").mockReturnValue(new Promise(() => {}));

    // A submission is scoped to the active session - `submitAnswers` returns early without one, so
    // the store has to be opened on the session holding this message before Submit is pressed.
    const session: ChatSession = {
      id: "session-opt-resize",
      title: "Resize Session",
      createdAt: "2026-09-14T10:00:00Z",
      updatedAt: "2026-09-14T10:00:00Z",
      spawnedJobIds: [],
      messages: [questionMessage],
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    await chatStore.init();

    const { unmount } = render(<ChatMessageRow message={questionMessage} />);

    selectOption("msg-opt-1", "SQLite");
    await act(async () => {
      fireEvent.click(submitButton("msg-opt-1"));
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
    render(<ChatMessageRow message={questionMessage} />);

    // Remounted row immediately shows the in-progress answer
    expect(screen.getByTestId("plan-markdown-content-chat-msg-msg-opt-1").textContent).toContain(
      'answer: "sqlite"',
    );
  });
});
