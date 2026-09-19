import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { WebViewer } from "./WebViewer.tsx";
import { WebViewerProvider } from "@/contexts/webviewer-context";

describe("WebViewer", () => {
  const mockRegistration = {
    active: { scriptURL: "/sw.js", state: "activated" },
    installing: null,
    waiting: null,
    scope: "http://localhost/__view/",
    unregister: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const msg = args.map((a) => String(a)).join(" ");
      if (
        msg.includes("NetworkError") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("AbortError")
      ) {
        return;
      }
      console.warn(...args);
    });

    Object.defineProperty(navigator, "serviceWorker", {
      writable: true,
      configurable: true,
      value: {
        getRegistrations: vi.fn().mockResolvedValue([]),
        register: vi.fn().mockResolvedValue(mockRegistration),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders empty state when no URL is provided", async () => {
    await act(async () => {
      render(<WebViewer id="test-viewer" />);
    });
    expect(screen.getByText("No URL -- set the Url prop to load a page.")).toBeDefined();
  });

  it("renders desktop framing with full size iframe by default", async () => {
    const { container } = render(
      <WebViewer id="test-viewer" url="https://example.com" device="Desktop" />,
    );
    const iframe = await screen.findByTitle("Web content");
    expect(iframe).not.toBeNull();
    expect(iframe.style.width).toBe("100%");
    expect(iframe.style.height).toBe("100%");

    const stage = container.querySelector(".wvr-stage");
    expect(stage?.classList.contains("wvr-device")).toBe(false);
  });

  it("frames mobile device viewport correctly", async () => {
    const { container } = render(
      <WebViewer id="test-viewer" url="https://example.com" device="Mobile" />,
    );
    const iframe = await screen.findByTitle("Web content");
    expect(iframe).not.toBeNull();
    expect(iframe.style.width).toBe("390px");
    expect(iframe.style.height).toBe("844px");

    const stage = container.querySelector(".wvr-stage");
    expect(stage?.classList.contains("wvr-device")).toBe(true);
  });

  it("frames tablet device viewport correctly", async () => {
    const { container } = render(
      <WebViewer id="test-viewer" url="https://example.com" device="Tablet" />,
    );
    const iframe = await screen.findByTitle("Web content");
    expect(iframe).not.toBeNull();
    expect(iframe.style.width).toBe("820px");
    expect(iframe.style.height).toBe("1180px");

    const stage = container.querySelector(".wvr-stage");
    expect(stage?.classList.contains("wvr-device")).toBe(true);
  });

  it("applies scale and custom width/height styles", async () => {
    const { container } = render(
      <WebViewer id="test-viewer" url="https://example.com" width="px:1024" height="px:768" />,
    );
    // Mounting starts acquireProxyWorker(); let its promise chain settle inside act so the
    // resulting setSwReady(true) is not applied outside an act scope.
    await act(async () => {});
    const shell = container.querySelector(".wvr-shell") as HTMLElement;
    expect(shell).not.toBeNull();
    expect(shell.style.width).toBe("1024px");
    expect(shell.style.height).toBe("768px");
  });

  it("opens comment overlay when receiving selected message and allows comment submission", async () => {
    const eventHandler = vi.fn();
    const { container } = render(
      <WebViewer
        id="test-viewer"
        url="https://example.com"
        eventHandler={eventHandler}
        events={["OnEvent"]}
      />,
    );

    const iframe = (await screen.findByTitle("Web content")) as HTMLIFrameElement;
    const iframeWindow = iframe.contentWindow;

    // Simulate postMessage from proxied frame selecting an element for a comment pin
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            __proxy: true,
            type: "selected",
            xpath: "/html/body/div[1]/button",
            selector: "#submit-btn",
            meta: { tag: "BUTTON", text: "Submit Order" },
            debug: { source: { file: "src/Button.tsx", line: 42, col: 10 } },
          },
          source: iframeWindow,
        }),
      );
    });

    // Verify comment dialog is open
    expect(screen.getByText("BUTTON")).toBeDefined();
    expect(screen.getByText(/Submit Order/)).toBeDefined();
    expect(screen.getByText("src/Button.tsx:42:10")).toBeDefined();

    // Type comment text
    const textarea = screen.getByPlaceholderText("Type a comment… (Ctrl+Enter to submit)");
    fireEvent.change(textarea, { target: { value: "Please change button color to primary" } });

    // Submit comment
    const addBtn = screen.getByRole("button", { name: "Add" });
    fireEvent.click(addBtn);

    // Verify comment dialog is closed
    expect(container.querySelector(".wvr-overlay")).toBeNull();

    // Check eventHandler was called with comment details (after resolveSource Promise resolves)
    await vi.waitFor(() => {
      expect(eventHandler).toHaveBeenCalledWith(
        "OnEvent",
        "test-viewer",
        expect.arrayContaining([
          expect.objectContaining({
            kind: "comment",
            comment: "Please change button color to primary",
            xpath: "/html/body/div[1]/button",
            selector: "#submit-btn",
            // The marker's own id and tag. `comment-edit` and `comment-delete` name a comment by id,
            // so a host that was never told one cannot apply either of them.
            id: expect.stringMatching(/^m_\d+_\d+$/),
            tag: "BUTTON",
          }),
        ]),
      );
    });
  });

  // The component no longer registers a service worker: the proxied document does it, from the
  // origin that serves it. What is worth pinning down here is that the frame always goes to
  // view-space, and on whichever origin was configured — that single decision is what makes the
  // feature behave identically under Tauri and in a browser.

  it("frames view-space on the page's own origin by default", async () => {
    render(<WebViewer id="test-viewer" url="https://example.com" />);
    const iframe = (await screen.findByTitle("Web content")) as HTMLIFrameElement;
    expect(iframe.src).toContain("/__view/@");
    expect(iframe.src).toContain("https://example.com");
    expect(iframe.src.startsWith(window.location.origin)).toBe(true);
  });

  it("frames view-space on the configured proxy origin", async () => {
    // The Tauri case: the shell is on tauri://localhost and serves none of these paths, so the
    // daemon's own origin has to carry them or the page loads without the agent in it.
    render(
      <WebViewer id="test-viewer" url="https://example.com" proxyOrigin="http://127.0.0.1:5010" />,
    );
    const iframe = (await screen.findByTitle("Web content")) as HTMLIFrameElement;
    expect(iframe.src.startsWith("http://127.0.0.1:5010/__view/@")).toBe(true);
    expect(iframe.src).toContain("https://example.com");
  });

  it("takes the proxy origin from the provider, so callers need not pass it", async () => {
    render(
      <WebViewerProvider proxyOrigin="http://127.0.0.1:5010/">
        <WebViewer id="test-viewer" url="https://example.com" />
      </WebViewerProvider>,
    );
    const iframe = (await screen.findByTitle("Web content")) as HTMLIFrameElement;
    // The trailing slash the provider was given must not survive into the path.
    expect(iframe.src.startsWith("http://127.0.0.1:5010/__view/@")).toBe(true);
  });

  it("never registers a service worker from the host page", async () => {
    const register = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      writable: true,
      configurable: true,
      value: {
        getRegistrations: vi.fn().mockResolvedValue([]),
        register,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    render(<WebViewer id="test-viewer" url="https://example.com" />);
    await screen.findByTitle("Web content");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Registering here is what failed under Tauri: the shell's origin serves no /sw.js.
    expect(register).not.toHaveBeenCalled();
  });

  it("frames without waiting when the browser has no service worker at all", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      writable: true,
      configurable: true,
      value: undefined,
    });

    render(<WebViewer id="test-viewer" url="https://example.com" />);
    const iframe = (await screen.findByTitle("Web content")) as HTMLIFrameElement;
    // Still view-space: the document is served rewritten with the agent inside it either way, and
    // the worker only ever improved requests the rewriter could not reach.
    expect(iframe.src).toContain("/__view/@");
    expect(screen.queryByText("Starting proxy…")).toBeNull();
  });

  it("renders Toolbar when toolbar prop is true", async () => {
    render(<WebViewer id="test-viewer" url="https://example.com" toolbar={true} />);
    expect(screen.getByRole("toolbar", { name: "Browser controls" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Back" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reload" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Address" })).toBeDefined();
  });

  it("switches device viewport via toolbar callback", async () => {
    const eventHandler = vi.fn();
    const { container } = render(
      <WebViewer
        id="test-viewer"
        url="https://example.com"
        toolbar={true}
        eventHandler={eventHandler}
        events={["OnEvent"]}
      />,
    );

    const stage = container.querySelector(".wvr-stage");
    expect(stage?.classList.contains("wvr-device")).toBe(false);

    // Open device menu and pick Mobile
    fireEvent.click(screen.getByRole("button", { name: "Viewport: Desktop" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mobile" }));

    expect(stage?.classList.contains("wvr-device")).toBe(true);
    const iframe = await screen.findByTitle("Web content");
    expect(iframe.style.width).toBe("390px");
    expect(iframe.style.height).toBe("844px");

    expect(eventHandler).toHaveBeenCalledWith(
      "OnEvent",
      "test-viewer",
      expect.arrayContaining([
        expect.objectContaining({
          kind: "device",
          device: "Mobile",
        }),
      ]),
    );
  });

  it("populates canonical page URL, attributes, and device label on comment creation", async () => {
    const eventHandler = vi.fn();
    render(
      <WebViewer
        id="test-viewer"
        url="https://example.com/products/item?tab=details#specs"
        device="Tablet"
        eventHandler={eventHandler}
        events={["OnEvent"]}
      />,
    );

    const iframe = (await screen.findByTitle("Web content")) as HTMLIFrameElement;
    const iframeWindow = iframe.contentWindow;

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            __proxy: true,
            type: "selected",
            xpath: "/html/body/div[1]/button",
            selector: "#buy-btn",
            meta: {
              tag: "BUTTON",
              text: "Buy Now",
              attrs: { "data-testid": "buy-now-button", id: "buy-btn" },
            },
            debug: { source: { file: "src/BuyButton.tsx", line: 15, col: 4 } },
          },
          source: iframeWindow,
        }),
      );
    });

    const textarea = screen.getByPlaceholderText("Type a comment… (Ctrl+Enter to submit)");
    fireEvent.change(textarea, { target: { value: "Check button padding" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() => {
      expect(eventHandler).toHaveBeenCalledWith(
        "OnEvent",
        "test-viewer",
        expect.arrayContaining([
          expect.objectContaining({
            kind: "comment",
            comment: "Check button padding",
            url: "https://example.com/products/item?tab=details",
            attrsJson: JSON.stringify({ "data-testid": "buy-now-button", id: "buy-btn" }),
            device: "Tablet",
          }),
        ]),
      );
    });
  });

  it("filters comment markers by canonical page on page navigation", async () => {
    const postMessageSpy = vi.fn();
    render(<WebViewer id="test-viewer" url="https://example.com/page-a" />);

    const iframe = (await screen.findByTitle("Web content")) as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentWindow", {
      writable: true,
      value: {
        postMessage: postMessageSpy,
        location: { pathname: "/__view/@id/https://example.com/page-a" },
      },
    });

    // Add comment on page-a
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            __proxy: true,
            type: "selected",
            xpath: "/html/body/div",
            selector: ".card",
            meta: { tag: "DIV", text: "Card A" },
          },
          source: iframe.contentWindow,
        }),
      );
    });

    const textarea = screen.getByPlaceholderText("Type a comment… (Ctrl+Enter to submit)");
    fireEvent.change(textarea, { target: { value: "Pin on Page A" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // Marker was pushed for page-a
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        __proxyCmd: "markers-set",
        markers: expect.arrayContaining([expect.objectContaining({ comment: "Pin on Page A" })]),
      }),
      "*",
    );

    postMessageSpy.mockClear();

    // Now simulate navigation to page-b reported by the agent.
    //
    // `location` is the name `agent.js` actually sends, and the reason this assertion is worth
    // making at all: the component used to listen for "navigated" — its own *outbound* event name —
    // so every real page change was dropped, and this test passed anyway by sending the name the
    // component was listening for rather than the one the agent emits.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            __proxy: true,
            type: "location",
            url: "https://example.com/page-b",
          },
          source: iframe.contentWindow,
        }),
      );
    });

    // Markers sent for page-b should be empty
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        __proxyCmd: "markers-set",
        markers: [],
      }),
      "*",
    );
  });

  it("clears active markers on clear-comments command", async () => {
    const postMessageSpy = vi.fn();
    let streamCallback: ((data: unknown) => void) | null = null;
    const subscribeToStream = vi.fn((_id: string, cb: (data: unknown) => void) => {
      streamCallback = cb;
      return () => {};
    });

    render(
      <WebViewer
        id="test-viewer"
        url="https://example.com"
        commands={{ id: "cmd-stream" }}
        subscribeToStream={subscribeToStream}
      />,
    );

    const iframe = (await screen.findByTitle("Web content")) as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentWindow", {
      writable: true,
      value: { postMessage: postMessageSpy },
    });

    // Add a comment
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            __proxy: true,
            type: "selected",
            xpath: "/html/body/div",
            selector: ".card",
            meta: { tag: "DIV", text: "Card" },
          },
          source: iframe.contentWindow,
        }),
      );
    });

    const textarea = screen.getByPlaceholderText("Type a comment… (Ctrl+Enter to submit)");
    fireEvent.change(textarea, { target: { value: "A comment to clear" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    postMessageSpy.mockClear();

    // Send clear-comments command via stream
    act(() => {
      streamCallback?.({ command: "clear-comments" });
    });

    // When markers are pushed next, markers array is empty
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        __proxyCmd: "markers-set",
        markers: [],
      }),
      "*",
    );
  });
});
