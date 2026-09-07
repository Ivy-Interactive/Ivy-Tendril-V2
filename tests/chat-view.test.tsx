import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
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
});
