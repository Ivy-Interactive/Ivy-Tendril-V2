import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { ImageLightbox } from "../src/components/chat/ImageLightbox";
import { isImageAttachment } from "../src/views/ChatMessageRow";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// The webview cannot load a bare filesystem path, so the row runs one through Tauri's asset
// protocol; the real implementation needs a webview, and only the resulting src matters here.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

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
    scrollIntoViewMock.mockClear();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderChatView() {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    render(<ChatView />);
    await screen.findByTestId("attachment-thumbnail");
  }

  it("shows an image attachment as a thumbnail and a document as a chip", async () => {
    await renderChatView();

    const thumbnails = screen.getAllByTestId("attachment-thumbnail");
    expect(thumbnails).toHaveLength(1);
    expect(thumbnails[0]).toHaveAttribute("aria-label", "Open mockup.png");
    expect(thumbnails[0].querySelector("img")).toHaveAttribute(
      "src",
      "asset://localhost//Users/me/mockup.png",
    );
    expect(screen.getByTitle("/Users/me/notes.md")).toBeInTheDocument();
  });

  it("opens the thumbnail full size and closes again", async () => {
    await renderChatView();

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("attachment-thumbnail"));

    const lightbox = await screen.findByTestId("image-lightbox");
    expect(lightbox).toHaveAttribute("aria-label", "mockup.png");
    // The thumbnail carries the same alt text, so the query is scoped to the lightbox.
    expect(within(lightbox).getByAltText("mockup.png")).toHaveAttribute(
      "src",
      "asset://localhost//Users/me/mockup.png",
    );

    fireEvent.click(screen.getByTestId("image-lightbox-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
    });
  });

  it("closes on Escape", async () => {
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
