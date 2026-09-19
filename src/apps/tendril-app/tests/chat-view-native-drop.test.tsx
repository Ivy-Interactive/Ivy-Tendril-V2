import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";
import type { DragDropEvent } from "@tauri-apps/api/webview";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const unlistenMock = vi.fn();
let dragHandler: ((e: { payload: DragDropEvent }) => void) | null = null;

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (e: { payload: DragDropEvent }) => void) => {
      dragHandler = handler;
      return Promise.resolve(unlistenMock);
    },
  }),
}));

const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

const mockSession: ChatSession = {
  id: "session-native-drop",
  title: "Native Drop Session",
  createdAt: "2026-09-07T12:00:00Z",
  updatedAt: "2026-09-07T12:00:00Z",
  spawnedJobIds: [],
  messages: [],
};

function emit(payload: { type: DragDropEvent["type"]; paths?: string[] }) {
  act(() => {
    dragHandler?.({ payload: payload as unknown as DragDropEvent });
  });
}

describe("ChatView native webview drag-drop", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    scrollIntoViewMock.mockClear();
    unlistenMock.mockClear();
    dragHandler = null;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderChatView() {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Native Drop Session").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(dragHandler).not.toBeNull();
    });
  }

  it("adds a chip with basename text and absolute-path title on a native drop", async () => {
    await renderChatView();

    emit({ type: "drop", paths: ["/Users/me/notes.md"] });

    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeInTheDocument();
    });
    expect(screen.getByText("notes.md").closest("div")).toHaveAttribute(
      "title",
      "/Users/me/notes.md",
    );
  });

  it("shows the drop overlay on enter and hides it on leave", async () => {
    await renderChatView();

    emit({ type: "enter", paths: [] });
    expect(screen.getByText("Drop files here to attach to message")).toBeInTheDocument();

    emit({ type: "leave" });
    expect(screen.queryByText("Drop files here to attach to message")).not.toBeInTheDocument();
  });

  it("hides the drop overlay on drop", async () => {
    await renderChatView();

    emit({ type: "enter", paths: [] });
    expect(screen.getByText("Drop files here to attach to message")).toBeInTheDocument();

    emit({ type: "drop", paths: ["/tmp/a.txt"] });
    expect(screen.queryByText("Drop files here to attach to message")).not.toBeInTheDocument();
  });

  it("does not add a duplicate chip for a path already attached", async () => {
    await renderChatView();

    emit({ type: "drop", paths: ["/Users/me/notes.md"] });
    await waitFor(() => {
      expect(screen.getAllByText("notes.md")).toHaveLength(1);
    });

    emit({ type: "drop", paths: ["/Users/me/notes.md"] });
    expect(screen.getAllByText("notes.md")).toHaveLength(1);
  });

  it("ignores an HTML5 dataTransfer drop while the native listener is active", async () => {
    await renderChatView();

    const file = new File(["dummy"], "ignored.ts", { type: "text/plain" });
    const composerArea = screen.getByTestId("chat-composer-area");
    expect(composerArea).toBeInTheDocument();

    fireEvent.drop(composerArea!, {
      dataTransfer: { files: [file] },
    });

    expect(screen.queryByText("ignored.ts")).not.toBeInTheDocument();
  });

  it("forwards the absolute native-drop path when sending a message", async () => {
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();
    await renderChatView();

    emit({ type: "drop", paths: ["/Users/me/notes.md"] });
    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);
    fireEvent.change(textarea, { target: { value: "Look at this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    // The absolute path travels on the turn, appended under `[Attached Files]:` as
    // `ChatExecutionService.SendMessageAsync` does, since that is all the agent process can read.
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("session-native-drop", {
        prompt: "Look at this\n\n[Attached Files]:\n- /Users/me/notes.md",
        agentId: "claude",
        modelId: undefined,
        effort: undefined,
      });
    });

    // It also travels as a structured chip on the message the thread renders.
    expect(chatStore.getState().activeSession?.messages.at(-1)).toMatchObject({
      role: "user",
      attachments: [{ name: "notes.md", path: "/Users/me/notes.md" }],
    });
  });

  it("calls unlisten when ChatView unmounts", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([mockSession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(mockSession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    const { unmount } = render(<ChatView />);

    await waitFor(() => {
      expect(dragHandler).not.toBeNull();
    });

    unmount();

    expect(unlistenMock).toHaveBeenCalled();
  });
});
