import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { ImageLightbox } from "../src/components/chat/ImageLightbox";
import { isImageAttachment, resetAttachmentPreviewsForTesting } from "../src/views/ChatMessageRow";
import { bridge } from "../src/api/bridge";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

/** What the daemon's `/ivy/local-file` read of `mockup.png` comes back as. */
const MOCKUP_DATA_URL = "data:image/png;base64,aVZ5";

const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

const session: ChatSession = {
  id: "session-lightbox",
  title: "Attachment Session",
  createdAt: "2026-09-07T12:00:00Z",
  updatedAt: "2026-09-07T12:00:00Z",
  spawnedJobIds: [],
  messages: [
    {
      id: "msg-1",
      role: "user",
      content: "Here is the mockup",
      timestamp: "2026-09-07T12:00:00Z",
      attachments: [
        { name: "mockup.png", path: "/Users/me/mockup.png", mimeType: "image/png" },
        { name: "notes.md", path: "/Users/me/notes.md", mimeType: "text/markdown" },
      ],
    },
  ],
};

describe("Chat image lightbox", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    // The previews are cached by path for the life of the module, so one case's stub would otherwise
    // answer the next one's read.
    resetAttachmentPreviewsForTesting();
    scrollIntoViewMock.mockClear();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Stubs the daemon read every image attachment goes through. */
  function stubPreview(
    answer: (path: string) => Promise<string> = async () => MOCKUP_DATA_URL,
  ): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(bridge, "getLocalFilePreview").mockImplementation(answer);
  }

  async function renderChatView() {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);
    await screen.findByTestId("attachment-thumbnail");
  }

  it("shows an image attachment as a thumbnail and a document as a chip", async () => {
    const preview = stubPreview();
    await renderChatView();

    const thumbnails = screen.getAllByTestId("attachment-thumbnail");
    expect(thumbnails).toHaveLength(1);
    expect(thumbnails[0]).toHaveAttribute("aria-label", "Open mockup.png");
    // The bytes the daemon served, not a `file://` path or an `asset://` URL: the webview can load
    // neither, and only the guarded route decides what may be read.
    expect(thumbnails[0].querySelector("img")).toHaveAttribute("src", MOCKUP_DATA_URL);
    expect(screen.getByTitle("/Users/me/notes.md")).toBeInTheDocument();

    // The image is read through the guard; the markdown document is not read at all.
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith("/Users/me/mockup.png");
  });

  it("falls back to a chip when the daemon refuses the path", async () => {
    // What `/ivy/local-file` answers for a path outside every configured root: a 404 the app surfaces
    // as NOT_FOUND, deliberately indistinguishable from a file that is simply gone.
    const preview = stubPreview(async () => {
      throw { code: "NOT_FOUND", message: "Tendril will not serve '/Users/me/mockup.png' (404)" };
    });
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);

    // The refused image reads as an attachment chip, and never as a broken thumbnail.
    await waitFor(() => {
      expect(screen.getByTitle("/Users/me/mockup.png")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("attachment-thumbnail")).not.toBeInTheDocument();
    expect(screen.queryByAltText("mockup.png")).not.toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("opens the thumbnail full size and closes again", async () => {
    const preview = stubPreview();
    await renderChatView();

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("attachment-thumbnail"));

    const lightbox = await screen.findByTestId("image-lightbox");
    expect(lightbox).toHaveAttribute("aria-label", "mockup.png");
    // The thumbnail carries the same alt text, so the query is scoped to the lightbox.
    expect(within(lightbox).getByAltText("mockup.png")).toHaveAttribute("src", MOCKUP_DATA_URL);
    // The full-size view reuses what the thumbnail already resolved rather than reading the file again.
    expect(preview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("image-lightbox-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
    });
  });

  it("closes on Escape", async () => {
    stubPreview();
    await renderChatView();

    fireEvent.click(screen.getByTestId("attachment-thumbnail"));
    const lightbox = await screen.findByTestId("image-lightbox");

    fireEvent.keyDown(lightbox, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
    });
  });

  it("renders nothing until an image is given", () => {
    const onClose = vi.fn();
    const { rerender } = render(<ImageLightbox image={null} onClose={onClose} />);
    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();

    rerender(<ImageLightbox image={{ url: "asset://x.png" }} onClose={onClose} />);
    // Without a title it still needs an accessible name.
    expect(screen.getByTestId("image-lightbox")).toHaveAttribute("aria-label", "Image preview");
  });

  describe("isImageAttachment", () => {
    it("trusts the mime type first", () => {
      expect(isImageAttachment({ name: "a", path: "/a/blob", mimeType: "image/webp" })).toBe(true);
      expect(isImageAttachment({ name: "a", path: "/a/blob", mimeType: "text/plain" })).toBe(false);
    });

    it("falls back to the extension when the mime type is missing", () => {
      expect(isImageAttachment({ name: "a", path: "/a/shot.JPEG" })).toBe(true);
      expect(isImageAttachment({ name: "a", path: "/a/diagram.svg" })).toBe(true);
      expect(isImageAttachment({ name: "a", path: "/a/report.pdf" })).toBe(false);
      expect(isImageAttachment({ name: "a", path: "/a/pngfolder/notes.txt" })).toBe(false);
    });
  });
});
