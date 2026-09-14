// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

if (typeof window.PointerEvent === "undefined") {
  // @ts-expect-error polyfill for jsdom
  window.PointerEvent = FakePointerEvent;
  // @ts-expect-error polyfill for jsdom
  globalThis.PointerEvent = FakePointerEvent;
}

if (typeof Element.prototype.setPointerCapture === "undefined") {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
}

const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

describe("ChatView Sidebar Resize Interaction Tests", () => {
  beforeEach(() => {
    localStorage.clear();
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    vi.mocked(open).mockReset();
    scrollIntoViewMock.mockClear();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders ChatView with default sidebar width of 256px", async () => {
    let container: HTMLElement;
    await act(async () => {
      const res = render(<ChatView />);
      container = res.container;
    });
    const aside = container!.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside?.style.width).toBe("256px");
  });

  it("restores stored sidebar width from localStorage on mount", async () => {
    localStorage.setItem("tendril:chat:sidebar_width", "350");
    let container: HTMLElement;
    await act(async () => {
      const res = render(<ChatView />);
      container = res.container;
    });
    const aside = container!.querySelector("aside");
    expect(aside?.style.width).toBe("350px");
  });

  it("resizes sidebar on pointer drag and persists to localStorage", async () => {
    let container: HTMLElement;
    await act(async () => {
      const res = render(<ChatView />);
      container = res.container;
    });
    const aside = container!.querySelector("aside");
    const resizer = container!.querySelector('[role="separator"]') as HTMLElement;
    expect(resizer).not.toBeNull();

    // Start drag
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
    });
    // Drag to 320px
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 320, pointerId: 1, bubbles: true }),
      );
    });
    // End drag
    act(() => {
      resizer.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });

    expect(aside?.style.width).toBe("320px");
    expect(localStorage.getItem("tendril:chat:sidebar_width")).toBe("320");
  });

  it("clamps sidebar width to min (180px) and max (480px)", async () => {
    let container: HTMLElement;
    await act(async () => {
      const res = render(<ChatView />);
      container = res.container;
    });
    const aside = container!.querySelector("aside");
    const resizer = container!.querySelector('[role="separator"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
    });

    // Below min (180)
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 100, pointerId: 1, bubbles: true }),
      );
    });
    expect(aside?.style.width).toBe("180px");
    expect(localStorage.getItem("tendril:chat:sidebar_width")).toBe("180");

    // Above max (480)
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 600, pointerId: 1, bubbles: true }),
      );
    });
    expect(aside?.style.width).toBe("480px");
    expect(localStorage.getItem("tendril:chat:sidebar_width")).toBe("480");

    act(() => {
      resizer.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });
  });

  it("resets sidebar width to default (256px) on double click", async () => {
    let container: HTMLElement;
    await act(async () => {
      const res = render(<ChatView />);
      container = res.container;
    });
    const aside = container!.querySelector("aside");
    const resizer = container!.querySelector('[role="separator"]') as HTMLElement;

    // Resize first
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 390, pointerId: 1, bubbles: true }),
      );
      resizer.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });
    expect(aside?.style.width).toBe("390px");

    // Double click reset
    act(() => {
      resizer.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(aside?.style.width).toBe("256px");
    expect(localStorage.getItem("tendril:chat:sidebar_width")).toBe("256");
  });

  it("applies focus-visible ring styling to the resizer handle", async () => {
    let container: HTMLElement;
    await act(async () => {
      const res = render(<ChatView />);
      container = res.container;
    });
    const resizer = container!.querySelector('[role="separator"]') as HTMLElement;
    expect(resizer).not.toBeNull();
    expect(resizer.className).toContain("focus-visible:ring-2");
    expect(resizer.className).toContain("focus-visible:ring-emerald-500");
  });
});
