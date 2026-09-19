import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
