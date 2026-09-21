import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({
  default: "/assets/pdf.worker-TGcf_-kp.mjs",
}));

import {
  ContentInput,
  type ContentInputProps,
  loadPdfJs,
  PdfThumbnail,
  resetPdfJsCacheForTest,
} from "./ContentInput";

describe("ContentInput", () => {
  it("does not declare the superseded models/projects/selectedProject props", () => {
    const props: ContentInputProps = { id: "civ-1" };
    // @ts-expect-error models was never read; the component renders no model picker
    props.models = ["Build"];
    // @ts-expect-error projects was superseded by slots.ProjectPicker
    props.projects = ["Tendril-App"];
    // @ts-expect-error selectedProject was superseded by slots.ProjectPicker
    props.selectedProject = "Tendril-App";
    expect(props.selectedModel).toBeUndefined();
  });

  it("enables the submit button when only a file is attached (no text)", () => {
    render(<ContentInput id="civ-1" value=" [file: /tmp/foo.png]" />);
    const submitButton = screen.getByTitle("Send");
    expect(submitButton).toBeEnabled();
  });

  it("dispatches OnSubmit with a value containing the file reference when clicked", () => {
    const onIvyEvent = vi.fn();
    render(<ContentInput id="civ-1" value=" [file: /tmp/foo.png]" onIvyEvent={onIvyEvent} />);

    const submitButton = screen.getByTitle("Send");
    fireEvent.click(submitButton);

    expect(onIvyEvent).toHaveBeenCalledWith(
      "OnSubmit",
      "civ-1",
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.stringContaining("[file: /tmp/foo.png]"),
        }),
      ]),
    );
  });

  it("keeps the submit button disabled when there is no text and no file", () => {
    render(<ContentInput id="civ-1" value="" />);
    const submitButton = screen.getByTitle("Send");
    expect(submitButton).toBeDisabled();
  });

  it("renders the enter symbol (↵) in the shortcut label on non-Mac platforms", () => {
    render(<ContentInput id="civ-1" value="test" submitLabel="Send" />);
    const shortcut = document.querySelector(".civ-submit-shortcut");
    expect(shortcut).toBeTruthy();
    expect(shortcut?.textContent).toContain("↵");
  });

  it("does not overwrite the input text with incoming value prop while focused", () => {
    const { rerender } = render(<ContentInput id="civ-1" value="initial" autoFocus={true} />);
    const textarea = screen.getByPlaceholderText(
      "How can I help you today?",
    ) as HTMLTextAreaElement;

    // Simulate user typing (which updates local state)
    fireEvent.change(textarea, { target: { value: "initial typed" } });

    // Simulate backend sending updated value (which includes typed text or whatever)
    rerender(<ContentInput id="civ-1" value="initial" autoFocus={true} />);
    expect(textarea.value).toBe("initial typed");
  });

  it("overwrites the input text with incoming value prop when not focused", () => {
    const { rerender } = render(<ContentInput id="civ-1" value="initial" autoFocus={false} />);
    const textarea = screen.getByPlaceholderText(
      "How can I help you today?",
    ) as HTMLTextAreaElement;

    // Simulate backend sending updated value
    rerender(<ContentInput id="civ-1" value="updated" autoFocus={false} />);
    expect(textarea.value).toBe("updated");
  });

  it("shows an actionable error instead of a TypeError when navigator.mediaDevices is undefined", async () => {
    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    // Stub AudioContext for jsdom
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        close() {
          return Promise.resolve();
        }
        resume() {
          return Promise.resolve();
        }
      },
    );

    const onIvyEvent = vi.fn();
    render(
      <ContentInput id="civ-1" value="" onIvyEvent={onIvyEvent} transcriptionUrl="ws://test" />,
    );

    const micButton = screen.getByRole("button", { name: "Voice input transcription" });
    await act(async () => {
      fireEvent.click(micButton);
    });

    await vi.waitFor(() => {
      const errorBanner = document.querySelector(".civ-error-banner");
      expect(errorBanner?.textContent).toContain("not available in this window");
      expect(errorBanner?.textContent).not.toContain("TypeError");
    });
  });

  it("does not open a WebSocket when the mediaDevices API is missing", async () => {
    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    // Stub AudioContext for jsdom
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        close() {
          return Promise.resolve();
        }
        resume() {
          return Promise.resolve();
        }
      },
    );

    const mockWebSocket = vi.fn();
    vi.stubGlobal("WebSocket", mockWebSocket);

    render(<ContentInput id="civ-1" value="" transcriptionUrl="ws://test" />);

    const micButton = screen.getByRole("button", { name: "Voice input transcription" });
    await act(async () => {
      fireEvent.click(micButton);
    });

    await vi.waitFor(() => {
      expect(mockWebSocket).not.toHaveBeenCalled();
    });
  });

  it("returns to idle status when the mediaDevices API is missing", async () => {
    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    // Stub AudioContext for jsdom
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        close() {
          return Promise.resolve();
        }
        resume() {
          return Promise.resolve();
        }
      },
    );

    render(<ContentInput id="civ-1" value="" transcriptionUrl="ws://test" />);

    const micButton = screen.getByRole("button", { name: "Voice input transcription" });
    await act(async () => {
      fireEvent.click(micButton);
    });

    await vi.waitFor(() => {
      expect(micButton).toHaveClass("civ-status-idle");
      expect(micButton).not.toHaveClass("civ-status-connecting");
    });
  });

  it("reports a permission denial distinctly from an unsupported environment", async () => {
    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
      },
    });

    // Stub AudioContext for jsdom
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        close() {
          return Promise.resolve();
        }
        resume() {
          return Promise.resolve();
        }
      },
    );

    // jsdom doesn't implement AudioWorkletNode; stub it so the environment
    // check doesn't short-circuit before the mocked getUserMedia rejection.
    vi.stubGlobal("AudioWorkletNode", class {});

    render(<ContentInput id="civ-1" value="" transcriptionUrl="ws://test" />);

    const micButton = screen.getByRole("button", { name: "Voice input transcription" });
    await act(async () => {
      fireEvent.click(micButton);
    });

    await vi.waitFor(() => {
      const errorBanner = document.querySelector(".civ-error-banner");
      expect(errorBanner?.textContent).toContain("System Settings");
    });
  });

  it("does not render a job execution mode selector", () => {
    render(<ContentInput id="civ-1" value="" />);
    expect(document.querySelector(".civ-mode-selector-container")).toBeNull();
    expect(screen.queryByTitle("Select job execution mode")).toBeNull();
  });

  /**
   * Pins the packaged-app worker fix. pdf.js decides a `workerSrc` is cross-origin whenever
   * `window.location`'s origin serialises to the string `"null"` — which is what the packaged
   * webview's `tauri://localhost` does on macOS and Linux, `tauri:` being a custom URL scheme. It
   * then tries to load the worker through a `blob:` URL, the CSP refuses it, and pdf.js silently
   * degrades to main-thread parsing, freezing the UI on every PDF thumbnail.
   *
   * Handing it a ready-made `workerPort` sidesteps that check entirely, so these assert we set the
   * port and never the src. Reverting to `workerSrc` reintroduces the freeze and cannot be caught
   * anywhere else in this suite: jsdom has no `Worker`, dev serves from a real origin, and pdf.js
   * logs nothing when it falls back.
   */
  describe("pdf.js worker wiring", () => {
    class FakeWorker {
      static instances: { url: string | URL; options?: WorkerOptions }[] = [];
      constructor(url: string | URL, options?: WorkerOptions) {
        FakeWorker.instances.push({ url, options });
      }
      postMessage() {}
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    }

    const withFakeWorker = async () => {
      resetPdfJsCacheForTest();
      FakeWorker.instances = [];
      const pdfjs = (await import("pdfjs-dist")) as unknown as {
        GlobalWorkerOptions: { workerSrc?: string; workerPort?: unknown };
      };
      pdfjs.GlobalWorkerOptions.workerSrc = undefined;
      pdfjs.GlobalWorkerOptions.workerPort = undefined;
      vi.stubGlobal("Worker", FakeWorker);
      return pdfjs;
    };

    afterEach(() => {
      vi.unstubAllGlobals();
      resetPdfJsCacheForTest();
    });

    it("gives pdf.js a workerPort rather than a workerSrc", async () => {
      const pdfjs = await withFakeWorker();
      await loadPdfJs();

      expect(pdfjs.GlobalWorkerOptions.workerPort).toBeInstanceOf(FakeWorker);
      // A workerSrc is what sends pdf.js through the blocked blob: path under tauri://localhost.
      expect(pdfjs.GlobalWorkerOptions.workerSrc).toBeUndefined();
    });

    it("constructs the worker from the bundled asset as an ES module", async () => {
      await withFakeWorker();
      await loadPdfJs();

      expect(FakeWorker.instances).toHaveLength(1);
      expect(FakeWorker.instances[0].url).toBe("/assets/pdf.worker-TGcf_-kp.mjs");
      // The emitted worker is ESM; a classic worker fails to parse its top-level imports.
      expect(FakeWorker.instances[0].options).toEqual({ type: "module" });
    });

    it("builds one shared worker no matter how many callers ask for pdf.js", async () => {
      await withFakeWorker();
      await Promise.all([loadPdfJs(), loadPdfJs()]);
      await loadPdfJs();

      expect(FakeWorker.instances).toHaveLength(1);
    });

    // jsdom (this suite) and SSR have no Worker constructor, so a port cannot be built there.
    it("falls back to workerSrc where the Worker constructor is unavailable", async () => {
      resetPdfJsCacheForTest();
      const pdfjs = (await import("pdfjs-dist")) as unknown as {
        GlobalWorkerOptions: { workerSrc?: string; workerPort?: unknown };
      };
      pdfjs.GlobalWorkerOptions.workerSrc = undefined;
      pdfjs.GlobalWorkerOptions.workerPort = undefined;
      vi.stubGlobal("Worker", undefined);

      await loadPdfJs();

      expect(pdfjs.GlobalWorkerOptions.workerPort).toBeUndefined();
      expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("/assets/pdf.worker-TGcf_-kp.mjs");
    });
  });

  it("loads PDF.js dynamically and renders canvas when given a PDF URL", async () => {
    resetPdfJsCacheForTest();
    const mockRender = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    const mockPage = {
      getViewport: vi.fn().mockReturnValue({ width: 140, height: 105 }),
      render: mockRender,
    };
    const mockPdf = {
      getPage: vi.fn().mockResolvedValue(mockPage),
    };
    const mockGetDocument = vi.fn().mockReturnValue({
      promise: Promise.resolve(mockPdf),
    });

    const pdfjs = await import("pdfjs-dist");
    (pdfjs as any).getDocument = mockGetDocument;

    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as any);

    let container: HTMLElement;
    await act(async () => {
      const rendered = render(<PdfThumbnail url="blob:http://localhost/doc.pdf" />);
      container = rendered.container;
    });

    await vi.waitFor(() => {
      expect(mockGetDocument).toHaveBeenCalledWith({ url: "blob:http://localhost/doc.pdf" });
      expect(mockPdf.getPage).toHaveBeenCalledWith(1);
      expect(mockRender).toHaveBeenCalled();
    });

    const canvas = container!.querySelector("canvas");
    expect(canvas).toBeInTheDocument();

    getContextSpy.mockRestore();
  });
});

describe("ContentInput split-button menu keyboard support", () => {
  it("opens the menu with role=menu/menuitem, navigates with arrows, and closes with Escape without touching the composer", async () => {
    const user = userEvent.setup();
    render(<ContentInput id="civ-1" value="hello" menuOptions={["Plan", "Chat", "Build"]} />);

    await user.click(screen.getByTitle("More options"));
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual(["Plan", "Chat", "Build"]);

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Plan" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Chat" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Plan" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(menu).not.toBeInTheDocument();
    expect(screen.getByTitle("More options")).toHaveFocus();
  });

  it("never lets the menu's Escape/arrow handling reach the composer once focus is back there", async () => {
    const user = userEvent.setup();
    render(<ContentInput id="civ-1" value="hello" menuOptions={["Plan", "Chat"]} />);

    const textarea = screen.getByRole("textbox");
    await user.click(textarea);
    await user.keyboard("{ArrowDown}{ArrowUp}{Escape}");

    // None of these are menu keys from the hook's point of view: the menu was never opened, so
    // there is nothing to close and the textarea keeps focus and its content untouched.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(textarea).toHaveFocus();
  });
});

/**
 * Attaching a file is what `files` state means: it is what the thumbnail strip renders, what
 * `canSubmit` consults, and what `handleSubmit` turns into the ` [file: ...]` refs that are the only
 * channel an attachment has to the consumer.
 *
 * THE BUG these pin: `handleFiles` uploaded the bytes and never registered the name, so every attach
 * path produced no chip, no `OnChange` and no change to the disabled Send button. A picked file was
 * indistinguishable from a dead control -- which is how it was reported.
 */
describe("ContentInput attachments", () => {
  const imageItem = (file: File | null) => ({
    kind: "file",
    type: file?.type ?? "image/png",
    getAsFile: () => file,
  });

  const chips = () => screen.queryAllByLabelText("Remove file");

  it("registers a file picked through the paperclip", async () => {
    const onIvyEvent = vi.fn();
    const { container } = render(<ContentInput id="civ-1" value="" onIvyEvent={onIvyEvent} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["bytes"], "shot.png", { type: "image/png" })] },
      });
    });

    expect(chips()).toHaveLength(1);
    // Enabling submit with no text is the whole point of attaching a file on its own.
    expect(screen.getByTitle("Send")).toBeEnabled();
    expect(onIvyEvent).toHaveBeenCalledWith(
      "OnChange",
      "civ-1",
      expect.arrayContaining([expect.stringContaining("[file: shot.png]")]),
    );
  });

  /**
   * The regression the paste fix was written for: a screenshot from a capture tool arrives as an item
   * of kind `"file"` and need not appear in `clipboardData.files` at all, so a reader that consults
   * only `files` drops it silently.
   */
  it("attaches an image pasted through clipboardData.items with files empty", async () => {
    const onIvyEvent = vi.fn();
    render(<ContentInput id="civ-1" value="" onIvyEvent={onIvyEvent} />);
    const shot = new File(["bytes"], "image.png", { type: "image/png" });

    await act(async () => {
      fireEvent.paste(screen.getByRole("textbox"), {
        clipboardData: { items: [imageItem(shot)], files: [] },
      });
    });

    expect(chips()).toHaveLength(1);
    expect(screen.getByTitle("Send")).toBeEnabled();
    // Renamed off the placeholder so a second pasted screenshot cannot collide with the first.
    const change = onIvyEvent.mock.calls.find(([event]) => event === "OnChange");
    expect(change?.[2][0]).toMatch(/\[file: screenshot_\d+_0\.png\]/);
  });

  it("carries a pasted image into the submitted value", async () => {
    const onIvyEvent = vi.fn();
    render(<ContentInput id="civ-1" value="" onIvyEvent={onIvyEvent} />);

    await act(async () => {
      fireEvent.paste(screen.getByRole("textbox"), {
        clipboardData: {
          items: [imageItem(new File(["bytes"], "image.png", { type: "image/png" }))],
          files: [],
        },
      });
    });
    fireEvent.click(screen.getByTitle("Send"));

    const submit = onIvyEvent.mock.calls.find(([event]) => event === "OnSubmit");
    expect((submit?.[2][0] as { value: string }).value).toMatch(/\[file: screenshot_\d+_0\.png\]/);
  });

  // A paste with no file has to fall through to the textarea, or typing by paste stops working.
  it("leaves a text-only paste to the textarea", async () => {
    const onIvyEvent = vi.fn();
    render(<ContentInput id="civ-1" value="" onIvyEvent={onIvyEvent} />);

    await act(async () => {
      fireEvent.paste(screen.getByRole("textbox"), {
        clipboardData: {
          items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
          files: [],
        },
      });
    });

    expect(chips()).toHaveLength(0);
    expect(onIvyEvent).not.toHaveBeenCalledWith("OnChange", "civ-1", expect.anything());
  });

  it("attaches a dropped file", async () => {
    render(<ContentInput id="civ-1" value="" />);
    const file = new File(["bytes"], "dropped.png", { type: "image/png" });

    await act(async () => {
      fireEvent.drop(screen.getByRole("textbox").closest(".civ-input-card")!, {
        dataTransfer: { files: [file] },
      });
    });

    expect(chips()).toHaveLength(1);
  });

  /**
   * The bug this whole group pins: a declared attachment carried a name, a type and a size and no
   * bytes, so the strip had nothing to draw and every chip -- image, PDF or archive alike -- rendered
   * the same grey extension pill. `previewSource` is the channel for those bytes, and these assert the
   * chip actually uses them, cleans up after them, and still shows the pill for everything it cannot
   * decode.
   */
  describe("attachment previews", () => {
    const PIXEL_PNG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const previewImg = () =>
      document.querySelector<HTMLImageElement>(".civ-thumbnail-image-preview");
    const pills = () => document.querySelectorAll(".civ-thumbnail-doc-meta");

    it("renders a declared image attachment as a preview pointed at its source", () => {
      render(
        <ContentInput
          id="civ-1"
          value=" [file: shot.png]"
          attachedFiles={[{ name: "shot.png", type: "image/png", previewSource: PIXEL_PNG }]}
        />,
      );

      expect(previewImg()).toHaveAttribute("src", PIXEL_PNG);
      // A decorative background: the filename beside it already names the attachment, so alt text
      // here would only make a screen reader announce the same thing twice.
      expect(previewImg()).toHaveAttribute("alt", "");
      // The "Document" line is what the preview replaces; the filename has to survive it.
      expect(pills()).toHaveLength(0);
      expect(screen.getByText("shot.png")).toBeInTheDocument();
    });

    it("mints an object URL for a Blob source and revokes it on unmount", () => {
      const createObjectURL = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:http://localhost/preview-1");
      const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

      const blob = new Blob(["bytes"], { type: "image/png" });
      const { unmount } = render(
        <ContentInput
          id="civ-1"
          value=" [file: shot.png]"
          attachedFiles={[{ name: "shot.png", type: "image/png", previewSource: blob }]}
        />,
      );

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(previewImg()).toHaveAttribute("src", "blob:http://localhost/preview-1");

      // The leak this pins is real: without the unmount revoke the blob is pinned in memory for the
      // lifetime of the document, and a composer that opens and closes per message leaks one per
      // attachment per open.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/preview-1");

      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    });

    it("falls back to the extension pill when the image fails to decode", () => {
      render(
        <ContentInput
          id="civ-1"
          value=" [file: broken.png]"
          attachedFiles={[
            { name: "broken.png", type: "image/png", size: "4 KB", previewSource: PIXEL_PNG },
          ]}
        />,
      );

      const img = previewImg();
      expect(img).toBeInTheDocument();

      // What the browser does for bytes that will not decode. Leaving the <img> mounted paints the
      // broken-image glyph across the card, which reads as a bug rather than as "no preview".
      fireEvent.error(img!);

      expect(previewImg()).not.toBeInTheDocument();
      // Exactly the pre-existing pill rendering, down to the "Document" line: the fallback is the
      // correct answer for content we could not show, so a decode failure has to land on it rather
      // than on some third state invented for the occasion.
      expect(pills()).toHaveLength(1);
      expect(screen.getByText("Document")).toBeInTheDocument();
      expect(screen.getByText("PNG")).toBeInTheDocument();
    });

    it("keeps the extension pill for a type that cannot be previewed", () => {
      render(
        <ContentInput
          id="civ-1"
          value=" [file: bundle.zip]"
          attachedFiles={[
            { name: "bundle.zip", type: "application/zip", size: "8 MB", previewSource: PIXEL_PNG },
          ]}
        />,
      );

      // Even handed a decodable source: a `.zip` has no first frame, so the pill is the correct
      // rendering and the source is ignored rather than rendered as something it is not.
      expect(previewImg()).not.toBeInTheDocument();
      expect(pills()).toHaveLength(1);
      expect(screen.getByText("ZIP")).toBeInTheDocument();
    });

    // A background that swallowed the one control on the card would be a worse bug than no preview.
    it("keeps the remove button working with a preview present", () => {
      const onIvyEvent = vi.fn();
      render(
        <ContentInput
          id="civ-1"
          value=" [file: shot.png]"
          attachedFiles={[{ name: "shot.png", type: "image/png", previewSource: PIXEL_PNG }]}
          onIvyEvent={onIvyEvent}
        />,
      );

      expect(previewImg()).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Remove file"));

      expect(onIvyEvent).toHaveBeenCalledWith("OnRemoveAttachment", "civ-1", ["shot.png"]);
      expect(chips()).toHaveLength(0);
    });

    // A path is not bytes: the webview cannot load `file://` under the app's CSP, so attempting it
    // only trades the pill for the broken-image glyph.
    it("ignores a preview source the webview could not load", () => {
      render(
        <ContentInput
          id="civ-1"
          value=" [file: shot.png]"
          attachedFiles={[
            {
              name: "shot.png",
              type: "image/png",
              size: "1 MB",
              previewSource: "file:///Users/me/shot.png",
            },
          ]}
        />,
      );

      expect(previewImg()).not.toBeInTheDocument();
      expect(pills()).toHaveLength(1);
    });
  });

  // Attaching the same file twice is one attachment: the name is the key everything else is stored by.
  it("does not duplicate a file attached twice", async () => {
    const { container } = render(<ContentInput id="civ-1" value="" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.change(input, {
          target: { files: [new File(["bytes"], "same.png", { type: "image/png" })] },
        });
      });
    }

    expect(chips()).toHaveLength(1);
  });
});
