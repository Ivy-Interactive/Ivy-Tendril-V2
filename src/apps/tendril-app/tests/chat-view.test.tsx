import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { jobsStore } from "../src/state/jobsStore";
import type { ChatSession } from "../src/types/chat";
import type { Job } from "../src/types/api";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

describe("ChatView Component & Interaction Tests", () => {
  const mockSessionWithQuestions: ChatSession = {
    id: "session-10",
    title: "Architecture Planning",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    spawnedJobIds: [],
    messages: [
      {
        id: "msg-user-1",
        role: "user",
        content: "What database should we use?",
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        id: "msg-asst-1",
        role: "assistant",
        content: `Here is a decision to make:

\`\`\`questions
questions:
  - id: db-flavor
    title: Which database should we use?
    options:
      - title: SQLite
        value: sqlite
        recommended: true
      - title: Postgres
        value: postgres
\`\`\`
`,
        timestamp: "2026-09-07T12:01:00Z",
      },
    ],
  };

  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    vi.mocked(open).mockReset();
    scrollIntoViewMock.mockClear();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders ChatView with sessions and active messages", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
      expect(screen.getByText("What database should we use?")).toBeInTheDocument();
    });

    expect(screen.getByText("Which database should we use?")).toBeInTheDocument();
  });

  it("invokes chatStore.sendMessage when typing in ChatInput and sending", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);
    fireEvent.change(textarea, { target: { value: "Let us discuss API design." } });

    const sendBtn = screen.getByTitle("Send message");
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("session-10", {
        prompt: "Let us discuss API design.",
        agentId: "claude",
        modelId: undefined,
        effort: undefined,
      });
    });
  });

  it("submits question answers when interacting with QuestionsCallout", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const submitSpy = vi.spyOn(chatStore, "submitAnswer").mockResolvedValue();

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Which database should we use?")).toBeInTheDocument();
    });

    const sqliteOption = screen.getByText("SQLite");
    expect(sqliteOption).toBeInTheDocument();
    fireEvent.click(sqliteOption);

    const submitBtn = screen.queryByRole("button", { name: /Submit Response/i });
    if (submitBtn) {
      fireEvent.click(submitBtn);
    }

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith("msg-asst-1", "db-flavor", expect.anything());
    });
  });

  /**
   * V1's assistant turn ends at its meta line - `AssistantTurn.tsx` renders duration, tokens and
   * cost and stops. The Copy and Create Plan buttons V2 grew are not a V1 affordance, and a row of
   * them under every reply is the difference the operator sees. Guarded rather than deleted because
   * they have come back once already.
   */
  it("hangs no per-message actions off an assistant turn, as V1 does not", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    expect(screen.queryByTitle("Create Plan from message")).toBeNull();
    expect(screen.queryByTitle("Copy message")).toBeNull();
  });

  it("adds attachment chips to the list on drag-and-drop file drop onto composer", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const file = new File(["dummy content"], "test-dropped-file.ts", { type: "text/plain" });
    Object.defineProperty(file, "path", { value: "/path/to/test-dropped-file.ts" });

    const composerArea = screen.getByTestId("chat-composer-area");
    expect(composerArea).toBeInTheDocument();

    fireEvent.dragEnter(composerArea!, {
      dataTransfer: { files: [file] },
    });
    expect(screen.getByText("Drop files here to attach to message")).toBeInTheDocument();

    fireEvent.drop(composerArea!, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText("test-dropped-file.ts")).toBeInTheDocument();
    });
    expect(screen.queryByText("Drop files here to attach to message")).not.toBeInTheDocument();
  });

  it("adds attachment chips when selecting files via file input", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const file = new File(["selected content"], "config.json", { type: "application/json" });
    Object.defineProperty(file, "path", { value: "/repos/config.json" });

    const fileInput = screen.getByTestId("file-upload-input");
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("config.json")).toBeInTheDocument();
    });
  });

  it("removes attachment chip when clicking its remove button", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const file = new File(["hello"], "to-remove.md", { type: "text/markdown" });
    const fileInput = screen.getByTestId("file-upload-input");
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("to-remove.md")).toBeInTheDocument();
    });

    const removeBtn = screen.getByTitle("Remove to-remove.md");
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByText("to-remove.md")).not.toBeInTheDocument();
    });
  });

  it("sends attachments alongside prompt and clears them upon sending", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const file = new File(["payload"], "payload.txt", { type: "text/plain" });
    Object.defineProperty(file, "path", { value: "/data/payload.txt" });
    const fileInput = screen.getByTestId("file-upload-input");
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("payload.txt")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);
    fireEvent.change(textarea, { target: { value: "Review this file" } });

    const sendBtn = screen.getByTitle("Send message");
    fireEvent.click(sendBtn);

    // The turn carries the attachment paths appended to the prompt, which is the only channel the
    // agent process has for them (`ChatExecutionService.SendMessageAsync`'s `promptWithAttachments`).
    // The optimistic message keeps them as structured chips for the thread to render.
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("session-10", {
        prompt: "Review this file\n\n[Attached Files]:\n- /data/payload.txt",
        agentId: "claude",
        modelId: undefined,
        effort: undefined,
      });
    });

    expect(chatStore.getState().activeSession?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "Review this file",
      attachments: [{ name: "payload.txt", path: "/data/payload.txt", mimeType: "text/plain" }],
    });

    await waitFor(() => {
      expect(screen.queryByTestId("composer-attachment-chips")).not.toBeInTheDocument();
    });
  });

  it("displays attachment chips on messages rendered in the chat thread", async () => {
    const sessionWithAttachments: ChatSession = {
      ...mockSessionWithQuestions,
      messages: [
        {
          id: "msg-with-att",
          role: "user",
          content: "Here is the log file",
          timestamp: "2026-09-07T12:00:00Z",
          attachments: [
            {
              name: "system.log",
              path: "/var/log/system.log",
              mimeType: "text/plain",
            },
          ],
        },
      ],
    };

    vi.spyOn(chatApi, "listSessions").mockResolvedValue([sessionWithAttachments]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(sessionWithAttachments);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Here is the log file")).toBeInTheDocument();
    });

    const attachmentChip = screen.getByText("system.log");
    expect(attachmentChip).toBeInTheDocument();
    expect(attachmentChip.closest("div")).toHaveAttribute("title", "/var/log/system.log");
  });

  it("renders the auto-scroll lock with initial state ON and toggles state on click", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    // The header is keyed on the session, so it remounts once the session list arrives; wait for
    // that before holding on to the control.
    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const toggle = () => screen.getByTestId("chat-autoscroll-toggle");
    expect(toggle()).toHaveTextContent("Auto-scroll: ON");

    fireEvent.click(toggle());
    expect(toggle()).toHaveTextContent("Auto-scroll: OFF");

    fireEvent.click(toggle());
    expect(toggle()).toHaveTextContent("Auto-scroll: ON");
  });

  it("renders bottom anchor element with data-testid chat-scroll-anchor", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    const anchor = await screen.findByTestId("chat-scroll-anchor");
    expect(anchor).toBeInTheDocument();
  });

  it("calls scrollIntoView on anchor when stream delta arrives and autoScrollEnabled is true", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await screen.findByTestId("chat-scroll-anchor");
    scrollIntoViewMock.mockClear();

    act(() => {
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: "session-10",
        messageId: "msg-asst-1",
        delta: " More content streamed.",
      });
    });

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });
  });

  it("detaches tail locking when container is scrolled up and does not scroll on stream deltas", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const { container } = render(<ChatView />);

    await screen.findByTestId("chat-scroll-anchor");
    const scrollContainer = container.querySelector("main .overflow-y-auto");
    expect(scrollContainer).toBeInTheDocument();

    if (scrollContainer) {
      Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
      let currentScrollTop = 100;
      Object.defineProperty(scrollContainer, "scrollTop", {
        get: () => currentScrollTop,
        set: (v) => {
          currentScrollTop = v;
        },
        configurable: true,
      });

      act(() => {
        fireEvent.scroll(scrollContainer);
      });

      const tailBtn = await screen.findByTestId("chat-scroll-tail-button");
      expect(tailBtn).toBeInTheDocument();

      scrollIntoViewMock.mockClear();

      act(() => {
        chatStore.handleChatEvent({
          type: "chat.stream_delta",
          sessionId: "session-10",
          messageId: "msg-asst-1",
          delta: " More streamed text while scrolled up.",
        });
      });

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    }
  });

  it("renders floating anchor button when scrolled up, shows streaming status, and scrolls to tail on click", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const { container } = render(<ChatView />);

    await screen.findByTestId("chat-scroll-anchor");
    const scrollContainer = container.querySelector("main .overflow-y-auto");
    expect(scrollContainer).toBeInTheDocument();

    if (scrollContainer) {
      Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
      let currentScrollTop = 100;
      Object.defineProperty(scrollContainer, "scrollTop", {
        get: () => currentScrollTop,
        set: (v) => {
          currentScrollTop = v;
        },
        configurable: true,
      });

      act(() => {
        chatStore.handleChatEvent({
          type: "chat.generating_state",
          sessionId: "session-10",
          isGenerating: true,
        });
        fireEvent.scroll(scrollContainer);
      });

      const tailBtn = await screen.findByTestId("chat-scroll-tail-button");
      expect(tailBtn).toHaveTextContent(/Scroll to streaming tail/i);

      scrollIntoViewMock.mockClear();
      fireEvent.click(tailBtn);

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
    }
  });

  it("does not call scrollIntoView on stream deltas when autoScrollEnabled is toggled OFF", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const toggle = () => screen.getByTestId("chat-autoscroll-toggle");
    fireEvent.click(toggle());
    expect(toggle()).toHaveTextContent("Auto-scroll: OFF");

    scrollIntoViewMock.mockClear();

    act(() => {
      chatStore.handleChatEvent({
        type: "chat.stream_delta",
        sessionId: "session-10",
        messageId: "msg-asst-1",
        delta: " Delta while OFF",
      });
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("re-locks and scrolls to tail when sending a new message", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    vi.spyOn(chatApi, "postMessage").mockResolvedValue({ started: true });

    const { container } = render(<ChatView />);

    await screen.findByTestId("chat-scroll-anchor");
    const scrollContainer = container.querySelector("main .overflow-y-auto");

    if (scrollContainer) {
      Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
      let currentScrollTop = 100;
      Object.defineProperty(scrollContainer, "scrollTop", {
        get: () => currentScrollTop,
        set: (v) => {
          currentScrollTop = v;
        },
        configurable: true,
      });

      act(() => {
        fireEvent.scroll(scrollContainer);
      });

      expect(await screen.findByTestId("chat-scroll-tail-button")).toBeInTheDocument();
    }

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);
    fireEvent.change(textarea, { target: { value: "New question" } });

    scrollIntoViewMock.mockClear();
    const sendBtn = screen.getByTitle("Send message");
    fireEvent.click(sendBtn);

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("invokes native dialog open() and adds attachments when clicking attach button", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    vi.mocked(open).mockResolvedValue([
      "/Users/user/project/file1.ts",
      "/Users/user/project/docs/spec.md",
    ]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const attachBtn = screen.getByTestId("composer-attach-button");
    fireEvent.click(attachBtn);

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith({
        multiple: true,
        title: "Select Files to Attach",
      });
      expect(screen.getByText("file1.ts")).toBeInTheDocument();
      expect(screen.getByText("spec.md")).toBeInTheDocument();
    });

    expect(screen.getByText("file1.ts").closest("div")).toHaveAttribute(
      "title",
      "/Users/user/project/file1.ts",
    );
  });

  it("does not add attachments or trigger file input when native dialog is cancelled", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    vi.mocked(open).mockResolvedValue(null);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const fileInput = screen.getByTestId("file-upload-input");
    const clickSpy = vi.spyOn(fileInput, "click");

    const attachBtn = screen.getByTestId("composer-attach-button");
    fireEvent.click(attachBtn);

    await waitFor(() => {
      expect(open).toHaveBeenCalled();
    });

    expect(clickSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("composer-attachment-chips")).not.toBeInTheDocument();
  });

  it("falls back to standard file input when native dialog open() throws", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    vi.mocked(open).mockRejectedValue(new Error("Native dialog error"));

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    const fileInput = screen.getByTestId("file-upload-input");
    const clickSpy = vi.spyOn(fileInput, "click");

    const attachBtn = screen.getByTestId("composer-attach-button");
    fireEvent.click(attachBtn);

    await waitFor(() => {
      expect(open).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  it("greets an empty thread with the headline and the prompts it suggests", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("What Are We Producing Today?")).toBeInTheDocument();
    });
    expect(screen.getByText(/^Good (Morning|Afternoon|Evening)!$/)).toBeInTheDocument();

    // The chip drafts the full prompt, not its own label.
    const chip = screen.getByText("What should I work on next?");
    expect(chip).toHaveAttribute(
      "title",
      "Look at my draft plans across all projects and recommend which two to execute next, with reasons.",
    );
    fireEvent.click(chip);
    expect(screen.getByPlaceholderText(/Ask Tendril anything/i)).toHaveValue(
      "Look at my draft plans across all projects and recommend which two to execute next, with reasons.",
    );
  });

  /**
   * `ChatApp.BuildSidebarList`'s own `OnSearch` and `OnNew`, which the shell's Chats section calls:
   * search opens `Apps/Chat/Dialogs/ChatSearchDialog` (an absent `OnSearch` would open the *plan*
   * search dialog), and New is the new-chat action.
   */
  it("searches chats from the list's own search action and selects the one picked", async () => {
    const other: ChatSession = {
      id: "session-11",
      title: "Deployment Pipeline",
      createdAt: "2026-09-07T11:00:00Z",
      updatedAt: "2026-09-07T11:00:00Z",
      spawnedJobIds: [],
      messages: [],
    };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions, other]);
    vi.spyOn(chatApi, "getSession").mockImplementation(async (id: string) =>
      id === other.id ? other : mockSessionWithQuestions,
    );
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);
    await waitFor(() => expect(sidebarListStore.getState()?.items.length).toBe(2));

    act(() => {
      sidebarListStore.getState()?.onSearch?.();
    });

    const dialog = await screen.findByTestId("chat-search-dialog");
    fireEvent.change(within(dialog).getByLabelText("Search chats"), {
      target: { value: "deploy" },
    });

    const results = within(dialog).getAllByTestId("chat-search-result");
    expect(results).toHaveLength(1);
    fireEvent.click(results[0]);

    await waitFor(() => {
      expect(sidebarListStore.getState()?.selectedId).toBe("session-11");
    });
    expect(screen.queryByTestId("chat-search-dialog")).not.toBeInTheDocument();
  });

  it("starts a new chat from the list's New action", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const createSession = vi.spyOn(chatApi, "createSession").mockResolvedValue({
      id: "session-12",
      title: "New Chat",
      createdAt: "2026-09-07T13:00:00Z",
      updatedAt: "2026-09-07T13:00:00Z",
      spawnedJobIds: [],
      messages: [],
    });

    render(<ChatView />);
    await waitFor(() => expect(sidebarListStore.getState()?.items.length).toBe(1));

    act(() => {
      sidebarListStore.getState()?.onNew?.();
    });

    await waitFor(() => expect(createSession).toHaveBeenCalled());
  });

  it("renames and pins through the list's row actions", async () => {
    // A copy, because the store renames the session object it was handed in place - and the shared
    // fixture would then reach every test after this one already renamed.
    const session: ChatSession = { ...mockSessionWithQuestions };
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const rename = vi
      .spyOn(chatApi, "updateSession")
      .mockResolvedValue({ ...session, title: "Renamed" });

    render(<ChatView />);
    await waitFor(() => expect(sidebarListStore.getState()?.items.length).toBe(1));

    act(() => {
      sidebarListStore.getState()?.onRename?.("session-10", "Renamed");
    });
    await waitFor(() => expect(rename).toHaveBeenCalledWith("session-10", "Renamed"));

    act(() => {
      sidebarListStore.getState()?.onTogglePin?.("session-10");
    });
    await waitFor(() => expect(sidebarListStore.getState()?.items[0].pinned).toBe(true));

    // The pin is persisted, so it has to be dropped again or it follows this session into the tests
    // after it.
    act(() => {
      sidebarListStore.getState()?.onTogglePin?.("session-10");
    });
  });

  it("confirms before deleting a chat and only then deletes it", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const deleteSpy = vi.spyOn(chatApi, "deleteSession").mockResolvedValue();

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    // The row's own Delete is a shell sidebar row action now (the list's `onDelete`), which V1
    // routes to exactly this dialog (`id => deletingSessionId.Set(id)`).
    act(() => {
      sidebarListStore.getState()?.onDelete?.("session-10");
    });
    const dialog = await screen.findByTestId("chat-delete-session-dialog");
    expect(dialog).toHaveTextContent('Are you sure you want to delete "Architecture Planning"?');
    expect(deleteSpy).not.toHaveBeenCalled();

    // Deleting a chat goes through the app's `ConfirmDialog`, so the confirm carries the destructive
    // treatment and the shared `dialog-confirm` id rather than a primary-styled one of its own.
    const confirm = screen.getByTestId("dialog-confirm");
    expect(confirm).toHaveTextContent("Delete");
    expect(confirm.className).toContain("destructive");
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("session-10");
    });
  });

  it("keeps the delete dialog open and shows why when the daemon refuses", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    vi.spyOn(chatApi, "deleteSession").mockRejectedValue(new Error("session is still generating"));

    render(<ChatView />);
    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    act(() => {
      sidebarListStore.getState()?.onDelete?.("session-10");
    });
    await screen.findByTestId("chat-delete-session-dialog");
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    // A rejected delete used to have nowhere to report itself: the bare `AlertDialog` closed on
    // click and swallowed the error.
    await waitFor(() => {
      expect(screen.getByTestId("chat-delete-session-dialog")).toHaveTextContent(
        "session is still generating",
      );
    });
  });

  it("queues a prompt typed while the agent is still working instead of refusing it", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();
    const postSpy = vi.spyOn(chatApi, "postMessage").mockResolvedValue({ queued: true });

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
    });

    act(() => {
      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "session-10",
        isGenerating: true,
      });
    });

    // While the agent works the composer offers the queue and the stop, never a send.
    expect(screen.getByTitle("Stop agent")).toBeInTheDocument();
    expect(screen.queryByTitle("Send message")).not.toBeInTheDocument();
    expect(screen.queryByTestId("composer-queue-button")).not.toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);
    fireEvent.change(textarea, { target: { value: "And after that, deploy it" } });

    fireEvent.click(screen.getByTestId("composer-queue-button"));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        "session-10",
        "And after that, deploy it",
        expect.objectContaining({ enqueue: true }),
      );
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("renders thread list without CSS scroll-button hack and suppresses library scroll button", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("What database should we use?")).toBeInTheDocument();
    });

    const messageElement = screen.getByText("What database should we use?");
    const threadContainer = messageElement.closest(".overflow-hidden.relative");
    expect(threadContainer).toBeInTheDocument();
    expect(threadContainer?.className).not.toContain(
      "[&_button[aria-label='Scroll to bottom']]:hidden",
    );
    expect(threadContainer?.className).toContain("flex-1 overflow-hidden relative");

    expect(screen.queryByLabelText("Scroll to bottom")).not.toBeInTheDocument();
  });

  /**
   * The header's jobs pill, and the two independent sources it is allowed to believe — V1's
   * `ChatApp.ToSessionDto` unions the same pair.
   *
   * `spawnedJobIds` alone is not enough: it is maintained by scraping `Job started: <id>` out of the
   * agent's stream, so it is empty for a job started through the MCP tool, from the interactive
   * terminal, on a request whose confirmation was lost, or in a turn that was running while another
   * conversation was on screen. The job's own `chatSessionId` is the durable record the daemon wrote
   * when it accepted the submission, and it is what makes the pill right after a reload.
   */
  describe("the header's spawned-jobs pill", () => {
    const session = (spawnedJobIds: string[]): ChatSession => ({
      id: "session-10",
      title: "Architecture Planning",
      createdAt: "2026-09-07T12:00:00Z",
      updatedAt: "2026-09-07T12:00:00Z",
      spawnedJobIds,
      messages: [],
    });

    const job = (overrides: Partial<Job> = {}): Job => ({
      id: "03589",
      type: "CreatePlan",
      project: "namecheap-cli",
      status: "Running",
      ...overrides,
    });

    const renderWith = async (active: ChatSession, jobs: Job[]) => {
      jobsStore.getState().jobs = jobs;
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([active]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(active);
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      render(<ChatView />);
      await waitFor(() => {
        expect(screen.getAllByText("Architecture Planning").length).toBeGreaterThan(0);
      });
    };

    afterEach(() => {
      jobsStore.getState().jobs = [];
    });

    it("lists a job the daemon linked to this chat even with nothing scraped from the stream", async () => {
      await renderWith(session([]), [job({ chatSessionId: "session-10" })]);

      expect(await screen.findByTestId("chat-jobs-badge")).toBeInTheDocument();
      expect(screen.getByTestId("chat-jobs-badge")).toHaveTextContent("1 running");
    });

    it("leaves another conversation's jobs out of this one's header", async () => {
      await renderWith(session([]), [job({ chatSessionId: "session-99" })]);

      expect(screen.queryByTestId("chat-jobs-badge")).not.toBeInTheDocument();
    });

    it("counts a job once when both sources name it", async () => {
      await renderWith(session(["03589"]), [job({ chatSessionId: "session-10" })]);

      expect(await screen.findByTestId("chat-jobs-badge")).toHaveTextContent("1 running");
    });

    it("still hides the pill when a chat has started nothing", async () => {
      await renderWith(session([]), [job({ chatSessionId: undefined })]);

      expect(screen.queryByTestId("chat-jobs-badge")).not.toBeInTheDocument();
    });

    /**
     * The live path: the daemon announces a job mid-turn and the pill appears without waiting for the
     * job list to catch up. This is the case a `push` onto `spawnedJobIds` could not serve — the memo
     * is keyed on that array, so mutating it in place left the key referentially equal and the memo
     * returned its previous value however many times the component re-rendered.
     */
    it("shows a job announced by chat.job_spawned, before it reaches the job list", async () => {
      await renderWith(session([]), []);
      expect(screen.queryByTestId("chat-jobs-badge")).not.toBeInTheDocument();

      await act(async () => {
        chatStore.handleChatEvent({
          type: "chat.job_spawned",
          sessionId: "session-10",
          jobId: "03589",
        });
      });

      // Resolved from the transcript's terminal event, since the live list has not caught up yet.
      await act(async () => {
        chatStore.handleChatEvent({
          type: "chat.message_added",
          sessionId: "session-10",
          message: {
            id: "sys-1",
            role: "system",
            content:
              "[System Event] Job 03589 (CreatePlan) for '00681: Add Test Coverage' has finished " +
              "with status: Completed. Review the outcome and advise on next steps.",
            timestamp: "2026-09-17T10:39:00Z",
          },
        });
      });

      expect(await screen.findByTestId("chat-jobs-badge")).toBeInTheDocument();
    });
  });
});
