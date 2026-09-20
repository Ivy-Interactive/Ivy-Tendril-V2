import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

describe("Cross-Window Question Answer Synchronization", () => {
  const mockSession: ChatSession = {
    id: "session-multiwindow-1",
    title: "Multiwindow Sync Session",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    spawnedJobIds: [],
    messages: [
      {
        id: "msg-user-1",
        role: "user",
        content: "Which database should we choose?",
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        id: "msg-asst-1",
        role: "assistant",
        content: `Please make a choice:

\`\`\`questions
questions:
  - id: db-choice
    title: Which database should we use?
    options:
      - title: SQLite
        value: sqlite
      - title: PostgreSQL
        value: postgres
\`\`\`
`,
        timestamp: "2026-09-07T12:00:05Z",
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    chatStore.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * `inProgressAnswers` is what holds a *submitted* answer on screen until the document catches up
   * - an unsubmitted draft lives in the store's `questionDrafts`, which is deliberately neither
   * persisted nor broadcast. So what crosses windows here is a decision, and the second window
   * presents it as one: the chat block settles into its read-only form as soon as the answer is
   * patched into the message, and reverts to the pickers if that answer goes away again.
   */
  it("synchronizes submitted question answers reactively across windows via StorageEvent", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const { container } = render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText("Which database should we use?")).toBeInTheDocument();
    });

    const sqliteRadio = screen.getByRole("radio", { name: /SQLite/i }) as HTMLInputElement;
    const postgresRadio = screen.getByRole("radio", { name: /PostgreSQL/i }) as HTMLInputElement;
    expect(sqliteRadio.checked).toBe(false);
    expect(postgresRadio.checked).toBe(false);

    // Simulate the answer being submitted in a secondary window, dispatching a StorageEvent
    const externalAnswer = {
      "msg-asst-1": { "db-choice": ["sqlite"] },
    };
    act(() => {
      localStorage.setItem("tendril:chat:in_progress_answers", JSON.stringify(externalAnswer));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "tendril:chat:in_progress_answers",
          newValue: JSON.stringify(externalAnswer),
        }),
      );
    });

    // This window re-renders reactively and presents the decision rather than the pickers.
    await waitFor(() => {
      expect(container.querySelector(".tq-answer-value")?.textContent).toBe("SQLite");
    });
    expect(container.querySelectorAll("input.tq-option-input")).toHaveLength(0);
    expect(chatStore.getInProgressAnswers("msg-asst-1")).toEqual({
      "db-choice": ["sqlite"],
    });

    // Simulate the answer being retracted in the secondary window
    act(() => {
      localStorage.removeItem("tendril:chat:in_progress_answers");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "tendril:chat:in_progress_answers",
          newValue: null,
        }),
      );
    });

    // The block reverts to its interactive form, with nothing selected.
    await waitFor(() => {
      const clearedSqliteRadio = screen.getByRole("radio", { name: /SQLite/i }) as HTMLInputElement;
      expect(clearedSqliteRadio.checked).toBe(false);
    });
    expect(container.querySelector(".tq-answer-value")).toBeNull();
    expect(chatStore.getInProgressAnswers("msg-asst-1")).toBeUndefined();
  });
});
