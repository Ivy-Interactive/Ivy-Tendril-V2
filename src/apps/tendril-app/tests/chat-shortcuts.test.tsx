import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("ChatView Keyboard Shortcuts", () => {
  const mockSession: ChatSession = {
    id: "session-shortcuts",
    title: "Shortcuts Session",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    spawnedJobIds: [],
    messages: [
      {
        id: "msg-init",
        role: "user",
        content: "Existing conversation",
        timestamp: "2026-09-07T12:00:00Z",
      },
    ],
  };

  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits message with Ctrl+Enter", async () => {
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();
    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Shortcuts Session").length).toBeGreaterThan(0);
    });

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);
    fireEvent.change(textarea, { target: { value: "Sending via Ctrl+Enter" } });

    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("session-shortcuts", {
        prompt: "Sending via Ctrl+Enter",
        agentId: "claude",
        modelId: undefined,
        effort: undefined,
      });
    });
  });

  it("submits message with Cmd+Enter (metaKey)", async () => {
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();
    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Shortcuts Session").length).toBeGreaterThan(0);
    });

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);
    fireEvent.change(textarea, { target: { value: "Sending via Cmd+Enter" } });

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("session-shortcuts", {
        prompt: "Sending via Cmd+Enter",
        agentId: "claude",
        modelId: undefined,
        effort: undefined,
      });
    });
  });

  it("submits message with plain Enter and preserves newline on Shift+Enter", async () => {
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();
    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Shortcuts Session").length).toBeGreaterThan(0);
    });

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);

    // Shift+Enter should NOT submit
    fireEvent.change(textarea, { target: { value: "Line one\n" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(executeSpy).not.toHaveBeenCalled();

    // Plain Enter should submit
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("session-shortcuts", {
        prompt: "Line one",
        agentId: "claude",
        modelId: undefined,
        effort: undefined,
      });
    });
  });
});
