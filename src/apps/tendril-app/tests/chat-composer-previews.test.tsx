import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { bridge } from "../src/api/bridge";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import { resetAttachmentPreviewsForTesting } from "../src/views/ChatMessageRow";
import type { ChatSession } from "../src/types/chat";
import type { DragDropEvent } from "@tauri-apps/api/webview";

/**
 * What an attached image looks like *before* it is sent.
 *
 * The thread already renders a thumbnail for an image attachment, so the file the user attached was
 * only ever visible after the turn had gone out — until then it was a paperclip and a file name, and
 * whether the right screenshot had been picked was a guess. V1's composer shows the picture itself
 * (`ComposerAttachmentCard` in
 * `Ivy-Tendril/src/Ivy.Tendril.Widgets/frontend/src/ChatWidget/attachments.tsx`), which is the
 * affordance these cases pin.
 *
 * The preview comes from the same guarded daemon route the thread's thumbnails use, so what is stubbed
 * here is `getLocalFilePreview`, and staging is stubbed alongside it because the route only serves
 * paths inside a local-file root.
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

window.HTMLElement.prototype.scrollIntoView = vi.fn();

const PICKED_IMAGE = "/Users/me/Desktop/shot.png";
const STAGED_IMAGE = "/Users/me/.tendril/Attachments/session-previews/shot.png";
const PICKED_DOC = "/Users/me/Desktop/notes.md";
const STAGED_DOC = "/Users/me/.tendril/Attachments/session-previews/notes.md";
const PREVIEW_DATA_URL = "data:image/png;base64,aVZ5";

const newSession = (): ChatSession => ({
  id: "session-previews",
  title: "Preview Session",
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

/** Stages each dropped file into the attachment directory, keeping its name. */
function stubStaging() {
  return vi.spyOn(bridge, "uploadChatAttachment").mockImplementation(async (path: string) => {
    const name = path.split("/").pop() as string;
    return { name, path: path === PICKED_DOC ? STAGED_DOC : STAGED_IMAGE };
  });
}

describe("Composer attachment previews", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    resetAttachmentPreviewsForTesting();
    vi.restoreAllMocks();
    unlistenMock.mockClear();
    dragHandler = null;
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
      expect(screen.getAllByText("Preview Session").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(dragHandler).not.toBeNull();
    });
  }

  it("shows the image itself once the file has been staged", async () => {
    stubStaging();
    const preview = vi.spyOn(bridge, "getLocalFilePreview").mockResolvedValue(PREVIEW_DATA_URL);
    await renderChatView();

    emitDrop([PICKED_IMAGE]);

    const thumbnail = await screen.findByTestId("composer-attachment-preview");
    expect(thumbnail).toHaveAttribute("src", PREVIEW_DATA_URL);
    expect(thumbnail).toHaveAttribute("alt", "shot.png");

    // Only the staged copy is ever asked for: the picked path is outside every local-file root, so
    // requesting it would be a round trip that can only answer NOT_FOUND.
    await waitFor(() => expect(preview).toHaveBeenCalledWith(STAGED_IMAGE));
    expect(preview).not.toHaveBeenCalledWith(PICKED_IMAGE);
  });

  it("leaves a non-image attachment as a named chip", async () => {
    stubStaging();
    const preview = vi.spyOn(bridge, "getLocalFilePreview").mockResolvedValue(PREVIEW_DATA_URL);
    await renderChatView();

    emitDrop([PICKED_DOC]);

    await waitFor(() => expect(screen.getByText("notes.md")).toBeInTheDocument());
    expect(screen.queryByTestId("composer-attachment-preview")).not.toBeInTheDocument();
    // A markdown file has no thumbnail to fetch; the daemon would refuse it as not an allow-listed
    // image, so the chip is the whole answer and no request is worth making.
    expect(preview).not.toHaveBeenCalled();
  });

  it("falls back to the chip when the daemon will not serve the image", async () => {
    stubStaging();
    vi.spyOn(bridge, "getLocalFilePreview").mockRejectedValue(new Error("NOT_FOUND"));
    await renderChatView();

    emitDrop([PICKED_IMAGE]);

    // The file is still attached and still going to the agent, so the name has to stay visible —
    // a broken-image icon would read as "this attachment is gone", which is not what happened.
    await waitFor(() => expect(screen.getByText("shot.png")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByTestId("composer-attachment-preview")).not.toBeInTheDocument(),
    );
  });

  it("still offers to remove an attachment that is showing its preview", async () => {
    stubStaging();
    vi.spyOn(bridge, "getLocalFilePreview").mockResolvedValue(PREVIEW_DATA_URL);
    await renderChatView();

    emitDrop([PICKED_IMAGE]);
    await screen.findByTestId("composer-attachment-preview");

    // The thumbnail replaces the chip's body, not its controls.
    expect(screen.getByRole("button", { name: "Remove shot.png" })).toBeInTheDocument();
  });
});
