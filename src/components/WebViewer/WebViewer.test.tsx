import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { WebViewer } from "./WebViewer.tsx";

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
    expect(screen.getByText("No URL — set the Url prop to load a page.")).toBeDefined();
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
          }),
        ]),
      );
    });
  });
});
