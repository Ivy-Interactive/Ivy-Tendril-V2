import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatQueuedItem, ChatSession } from "../src/types/chat";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

const session: ChatSession = {
  id: "session-queue",
  title: "Queued Session",
  createdAt: "2026-09-07T12:00:00Z",
  updatedAt: "2026-09-07T12:00:00Z",
  spawnedJobIds: [],
  messages: [],
};

const queued: ChatQueuedItem[] = [
  { id: "q1", prompt: "First queued prompt", createdAt: "2026-09-07T12:01:00Z" },
  { id: "q2", prompt: "Second queued prompt", createdAt: "2026-09-07T12:02:00Z" },
];

describe("ChatView queued prompt editing", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    scrollIntoViewMock.mockClear();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Renders the view and opens the queue drawer, which starts collapsed. */
  async function renderWithQueue() {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue(queued);

    render(<ChatView />);

    const drawer = await screen.findByText(/Queued Prompts \(2\)/);
    fireEvent.click(drawer);
    await waitFor(() => {
      expect(screen.getAllByTestId("queued-item")).toHaveLength(2);
    });
  }

  const editInput = () => screen.getByTestId("queued-item-input") as HTMLInputElement;

  it("edits a queued prompt in place and keeps its position in the queue", async () => {
    const updateSpy = vi
      .spyOn(chatApi, "updateQueuedItem")
      .mockImplementation(async (_sessionId, itemId, prompt) => ({
        id: itemId,
        prompt,
        createdAt: "2026-09-07T12:01:00Z",
      }));
    await renderWithQueue();

    fireEvent.click(screen.getAllByTestId("queued-item-edit")[0]);
    expect(editInput().value).toBe("First queued prompt");
    // Focus is taken so the prompt can be retyped without reaching for the mouse.
    expect(document.activeElement).toBe(editInput());

    fireEvent.change(editInput(), { target: { value: "Rewritten prompt" } });
    fireEvent.click(screen.getByTestId("queued-item-save"));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith("session-queue", "q1", "Rewritten prompt");
    });
    expect(chatStore.getState().queuedItems.map((i) => i.prompt)).toEqual([
      "Rewritten prompt",
      "Second queued prompt",
    ]);
    expect(screen.queryByTestId("queued-item-input")).not.toBeInTheDocument();
  });

  it("saves on Enter and cancels on Escape", async () => {
    const updateSpy = vi
      .spyOn(chatApi, "updateQueuedItem")
      .mockImplementation(async (_sessionId, itemId, prompt) => ({
        id: itemId,
        prompt,
        createdAt: "2026-09-07T12:02:00Z",
      }));
    await renderWithQueue();

    fireEvent.click(screen.getAllByTestId("queued-item-edit")[1]);
    fireEvent.change(editInput(), { target: { value: "Via Enter" } });
    fireEvent.keyDown(editInput(), { key: "Enter" });

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith("session-queue", "q2", "Via Enter");
    });

    updateSpy.mockClear();
    fireEvent.click(screen.getAllByTestId("queued-item-edit")[0]);
    fireEvent.change(editInput(), { target: { value: "Discarded" } });
    fireEvent.keyDown(editInput(), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("queued-item-input")).not.toBeInTheDocument();
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.getByText("First queued prompt")).toBeInTheDocument();
  });

  it("drops the item when its text is cleared, which is how the legacy widget deleted one", async () => {
    const deleteSpy = vi.spyOn(chatApi, "deleteQueuedItem").mockResolvedValue();
    const updateSpy = vi.spyOn(chatApi, "updateQueuedItem");
    await renderWithQueue();

    fireEvent.click(screen.getAllByTestId("queued-item-edit")[0]);
    fireEvent.change(editInput(), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("queued-item-save"));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("session-queue", "q1");
    });
    expect(updateSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getAllByTestId("queued-item")).toHaveLength(1);
    });
  });

  it("restores the prompt when the update is refused", async () => {
    vi.spyOn(chatApi, "updateQueuedItem").mockRejectedValue(new Error("queue is locked"));
    await renderWithQueue();

    fireEvent.click(screen.getAllByTestId("queued-item-edit")[0]);
    fireEvent.change(editInput(), { target: { value: "Doomed" } });
    fireEvent.click(screen.getByTestId("queued-item-save"));

    await waitFor(() => {
      expect(screen.getByText("queue is locked")).toBeInTheDocument();
    });
    expect(chatStore.getState().queuedItems.map((i) => i.prompt)).toEqual([
      "First queued prompt",
      "Second queued prompt",
    ]);
  });

  it("edits one row at a time", async () => {
    vi.spyOn(chatApi, "updateQueuedItem").mockResolvedValue(queued[1]);
    await renderWithQueue();

    fireEvent.click(screen.getAllByTestId("queued-item-edit")[0]);
    expect(editInput().value).toBe("First queued prompt");

    fireEvent.click(screen.getByTestId("queued-item-edit"));
    expect(screen.getAllByTestId("queued-item-input")).toHaveLength(1);
    expect(editInput().value).toBe("Second queued prompt");
  });
});
