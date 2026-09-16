import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("Sample Prompt Chips", () => {
  const emptySession: ChatSession = {
    id: "session-empty",
    title: "Empty Session",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    spawnedJobIds: [],
    messages: [],
  };

  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([emptySession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(emptySession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders sample prompt chips when active chat has 0 messages", async () => {
    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByTestId("sample-prompts")).toBeInTheDocument();
    });

    expect(screen.getByText("Add a new project")).toBeInTheDocument();
    expect(screen.getByText("Edit verifications")).toBeInTheDocument();
    expect(screen.getByText("Create a team vault")).toBeInTheDocument();
    expect(screen.getByText("What should I work on next?")).toBeInTheDocument();
    expect(screen.getByText("What shipped this week?")).toBeInTheDocument();
  });

  it("populates composer input when clicking a sample prompt chip", async () => {
    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByTestId("sample-prompts")).toBeInTheDocument();
    });

    const chip = screen.getByText("Add a new project");
    fireEvent.click(chip);

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Add a new project to my tendril");
  });
});
