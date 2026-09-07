import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

// Stub scrollIntoView in jsdom
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

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
      expect(screen.getByText("Architecture Planning")).toBeInTheDocument();
      expect(screen.getByText("What database should we use?")).toBeInTheDocument();
    });

    // Check assistant markdown rendered question title
    expect(screen.getByText("Which database should we use?")).toBeInTheDocument();
  });

  it("invokes chatStore.sendMessage when typing in ChatInput and sending", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const postSpy = vi.spyOn(chatApi, "postMessage").mockResolvedValue({ started: true });

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Architecture Planning")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Ask Tendril or discuss plans/i);
    fireEvent.change(textarea, { target: { value: "Let us discuss API design." } });

    const sendBtn = screen.getByTitle("Send message");
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("session-10", "Let us discuss API design.", undefined);
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

    // PlanMarkdown renders questions. Find the SQLite option or radio/button
    const sqliteOption = screen.getByText("SQLite");
    expect(sqliteOption).toBeInTheDocument();
    fireEvent.click(sqliteOption);

    // If there is a Submit button rendered by QuestionsCallout:
    const submitBtn = screen.queryByRole("button", { name: /Submit Response/i });
    if (submitBtn) {
      fireEvent.click(submitBtn);
    }

    // Verify submitAnswer is called or routed
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith(
        "msg-asst-1",
        "db-flavor",
        expect.anything()
      );
    });
  });

  it("opens intake modal prefilled when clicking Create Plan button on message", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const onCreatePlanMock = vi.fn();

    render(<ChatView onCreatePlan={onCreatePlanMock} />);

    await waitFor(() => {
      expect(screen.getByText("Architecture Planning")).toBeInTheDocument();
    });

    const createPlanButtons = screen.getAllByTitle("Create Plan from message");
    expect(createPlanButtons.length).toBeGreaterThan(0);

    fireEvent.click(createPlanButtons[0]);
    expect(onCreatePlanMock).toHaveBeenCalledWith("What database should we use?");
  });

  it("adds attachment chips to the list on drag-and-drop file drop onto composer", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Architecture Planning")).toBeInTheDocument();
    });

    const file = new File(["dummy content"], "test-dropped-file.ts", { type: "text/plain" });
    Object.defineProperty(file, "path", { value: "/path/to/test-dropped-file.ts" });

    const composerArea = screen.getByPlaceholderText(/Ask Tendril or discuss plans/i).closest("div[class*='border-t']");
    expect(composerArea).toBeInTheDocument();

    fireEvent.dragEnter(composerArea!, {
      dataTransfer: { files: [file] },
    });
    expect(screen.getByText("Drop files here to attach")).toBeInTheDocument();

    fireEvent.drop(composerArea!, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText("test-dropped-file.ts")).toBeInTheDocument();
    });
    expect(screen.queryByText("Drop files here to attach")).not.toBeInTheDocument();
  });

  it("adds attachment chips when selecting files via file input", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Architecture Planning")).toBeInTheDocument();
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
      expect(screen.getByText("Architecture Planning")).toBeInTheDocument();
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

  it("passes attachments array in options on message send and clears chip list", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSessionWithQuestions]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSessionWithQuestions);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    const postSpy = vi.spyOn(chatApi, "postMessage").mockResolvedValue({ started: true });

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Architecture Planning")).toBeInTheDocument();
    });

    const file = new File(["data"], "payload.txt", { type: "text/plain" });
    Object.defineProperty(file, "path", { value: "/data/payload.txt" });

    const fileInput = screen.getByTestId("file-upload-input");
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("payload.txt")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Ask Tendril or discuss plans/i);
    fireEvent.change(textarea, { target: { value: "Review this file" } });

    const sendBtn = screen.getByTitle("Send message");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("session-10", "Review this file", {
        attachments: [
          {
            name: "payload.txt",
            path: "/data/payload.txt",
            mimeType: "text/plain",
          },
        ],
      });
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
});
