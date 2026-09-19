import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChatView } from "../src/views/ChatView";
import { bridge } from "../src/api/bridge";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";
import type { DragDropEvent } from "@tauri-apps/api/webview";

/**
 * Staging: the composer copies every attached file into Tendril's own attachment directory and puts the
 * copy's path on the message.
 *
 * This is what makes a chat attachment previewable at all. The daemon serves `/ivy/local-file` only from
 * the configured local-file roots — the Tendril home, the plans folder, the project repos — and a
 * screenshot picked from `~/Desktop` is in none of them, so a message carrying the picked path could
 * never render more than a paperclip chip. So the assertions here are about *which path* travels: the
 * staged one, on both the chip and the turn's `[Attached Files]:` block, and the picked one only when
 * staging failed.
 */

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

const PICKED = "/Users/me/Desktop/shot.png";
const STAGED = "/Users/me/.tendril/Attachments/session-staging/shot.png";

/**
 * A fresh session per test, deliberately not a shared constant: `sendMessage` pushes its optimistic user
 * message onto the session object the store is holding, so a shared one would carry the previous test's
 * attachment — and its chip — into the next render.
 */
const newSession = (): ChatSession => ({
  id: "session-staging",
  title: "Staging Session",
  createdAt: "2026-09-16T12:00:00Z",
  updatedAt: "2026-09-16T12:00:00Z",
  spawnedJobIds: [],
  messages: [],
});

function emitDrop(paths: string[]) {
  act(() => {
    dragHandler?.({ payload: { type: "drop", paths } as unknown as DragDropEvent });
  });
}

describe("Chat attachment staging", () => {
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
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([newSession()]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(newSession());
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getAllByText("Staging Session").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(dragHandler).not.toBeNull();
    });
  }

  /** Stages every file at `STAGED`, keeping the name it was picked by. */
  function stubStaging() {
    return vi.spyOn(bridge, "uploadChatAttachment").mockResolvedValue({
      name: "shot.png",
      path: STAGED,
    });
  }

  const chip = () => screen.getByText("shot.png").closest("div");

  it("copies a dropped file into the attachment directory and re-points the chip at the copy", async () => {
    const upload = stubStaging();
    await renderChatView();

    emitDrop([PICKED]);

    // The chip appears immediately with the picked path, so the file the user just dropped is visible
    // without waiting on a copy...
    await waitFor(() => expect(chip()).toHaveAttribute("title", PICKED));
    // ...and settles on the staged path, which is the one the daemon will serve a preview from.
    await waitFor(() => expect(chip()).toHaveAttribute("title", STAGED));

    // The label is the name the user picked the file by, not the path it was stored at.
    expect(screen.getByText("shot.png")).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(PICKED, "session-staging");
  });

  it("sends the staged path to the agent and puts it on the message", async () => {
    stubStaging();
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();
    await renderChatView();

    emitDrop([PICKED]);
    await waitFor(() => expect(chip()).toHaveAttribute("title", STAGED));

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i);
    act(() => {
      textarea.focus();
    });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Look at this" } });
      fireEvent.click(screen.getByTitle("Send message"));
    });

    // The agent process can only read a path, and this is the path that exists on disk *and* inside a
    // root — so the file the agent opens is the file the thumbnail shows.
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("session-staging", {
        prompt: `Look at this\n\n[Attached Files]:\n- ${STAGED}`,
        agentId: "claude",
        modelId: undefined,
        effort: undefined,
      });
    });
    expect(chatStore.getState().activeSession?.messages.at(-1)).toMatchObject({
      role: "user",
      attachments: [{ name: "shot.png", path: STAGED }],
    });
  });

  it("stages a file chosen through the file dialog", async () => {
    const upload = stubStaging();
    vi.mocked(open).mockResolvedValue(PICKED as never);
    await renderChatView();

    fireEvent.click(screen.getByTitle("Attach file"));

    await waitFor(() => expect(upload).toHaveBeenCalledWith(PICKED, "session-staging"));
    await waitFor(() => expect(chip()).toHaveAttribute("title", STAGED));
  });

  it("keeps the picked path when the copy fails, so the agent is still told about a real file", async () => {
    vi.spyOn(bridge, "uploadChatAttachment").mockRejectedValue(new Error("daemon is not running"));
    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue();
    await renderChatView();

    emitDrop([PICKED]);
    await waitFor(() => expect(chip()).toHaveAttribute("title", PICKED));

    fireEvent.change(screen.getByPlaceholderText(/Ask Tendril anything/i), {
      target: { value: "Look at this" },
    });
    fireEvent.click(screen.getByTitle("Send message"));

    // Degraded, not broken: the thumbnail falls back to a chip, which is what a file outside every root
    // rendered as before staging existed at all.
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("session-staging", {
        prompt: `Look at this\n\n[Attached Files]:\n- ${PICKED}`,
        agentId: "claude",
        modelId: undefined,
        effort: undefined,
      });
    });
  });

  it("copies a file dropped twice only once, and leaves one chip", async () => {
    const upload = stubStaging();
    await renderChatView();

    emitDrop([PICKED]);
    await waitFor(() => expect(chip()).toHaveAttribute("title", STAGED));

    // The chip now carries the staged path, so nothing de-duplicates the second drop on its own.
    emitDrop([PICKED]);
    await waitFor(() => expect(screen.getAllByText("shot.png")).toHaveLength(1));
    expect(chip()).toHaveAttribute("title", STAGED);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
