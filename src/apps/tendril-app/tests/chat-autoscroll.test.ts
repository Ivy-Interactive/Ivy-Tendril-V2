import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatAutoScroll, PIN_TOP_PADDING } from "../src/hooks/useChatAutoScroll";

describe("useChatAutoScroll hook unit tests", () => {
  const scrollIntoViewMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  it("initializes with default states: isLockedToTail=true, isAtBottom=true", () => {
    const { result } = renderHook(() => useChatAutoScroll());
    expect(result.current.isLockedToTail).toBe(true);
    expect(result.current.isAtBottom).toBe(true);
  });

  it("detaches tail locking when scrolled up past threshold, and re-attaches when scrolled back to bottom", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    let currentScrollTop = 580;
    Object.defineProperty(container, "scrollTop", {
      get: () => currentScrollTop,
      set: (v) => {
        currentScrollTop = v;
      },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useChatAutoScroll({ threshold: 32, scrollContainerRef: { current: container } }),
    );

    expect(result.current.isAtBottom).toBe(true);
    expect(result.current.isLockedToTail).toBe(true);

    // User scrolls up (distance to bottom = 400 > 32)
    currentScrollTop = 200;
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(false);
    expect(result.current.isLockedToTail).toBe(false);

    // User scrolls back to bottom (distance to bottom = 30 <= 32)
    currentScrollTop = 570;
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(true);
    expect(result.current.isLockedToTail).toBe(true);
  });

  it("executes scrollToTail and resets state to bottom and tail locked", () => {
    const container = document.createElement("div");
    const anchor = document.createElement("div");
    anchor.scrollIntoView = scrollIntoViewMock;

    Object.defineProperty(container, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    let currentScrollTop = 100;
    Object.defineProperty(container, "scrollTop", {
      get: () => currentScrollTop,
      set: (v) => {
        currentScrollTop = v;
      },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useChatAutoScroll({
        scrollContainerRef: { current: container },
        anchorRef: { current: anchor },
      }),
    );

    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(false);
    expect(result.current.isLockedToTail).toBe(false);

    act(() => {
      result.current.scrollToTail(true);
    });
    expect(result.current.isAtBottom).toBe(true);
    expect(result.current.isLockedToTail).toBe(true);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("executes resetToTail and resets state and scrolls anchor with behavior auto", () => {
    const container = document.createElement("div");
    const anchor = document.createElement("div");
    anchor.scrollIntoView = scrollIntoViewMock;

    const { result } = renderHook(() =>
      useChatAutoScroll({
        scrollContainerRef: { current: container },
        anchorRef: { current: anchor },
      }),
    );

    act(() => {
      result.current.resetToTail();
    });
    expect(result.current.isAtBottom).toBe(true);
    expect(result.current.isLockedToTail).toBe(true);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "auto" });
  });

  it("triggers notifyContentUpdate when content updates and isLockedToTail is true", () => {
    const anchor = document.createElement("div");
    anchor.scrollIntoView = scrollIntoViewMock;

    const { rerender } = renderHook(
      ({ content, isGenerating }) =>
        useChatAutoScroll({
          content,
          isGenerating,
          anchorRef: { current: anchor },
        }),
      {
        initialProps: { content: "initial", isGenerating: true },
      },
    );

    expect(scrollIntoViewMock).toHaveBeenCalled();
    scrollIntoViewMock.mockClear();

    rerender({ content: "updated delta", isGenerating: true });
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "auto" });
  });
});

describe("useChatAutoScroll message pinning", () => {
  /**
   * The pin effect measures with getBoundingClientRect, so the harness has to describe a layout
   * rather than just set heights: a 400px viewport holding a 40px row that starts 900px down.
   *
   * `scrollHeight` grows with the spacer because that is what the effect reads to find the end of
   * the content: the thread renders a scroll anchor below the spacer, so the spacer's own top is
   * short of the true bottom and the reservation has to be worked back from the scroll height
   * instead. Here nothing follows the spacer, so the two agree and the expectations are unchanged.
   */
  function buildThread({ rowTop = 900, contentEnd = 1000, clientHeight = 400 } = {}) {
    const container = document.createElement("div");
    const row = document.createElement("div");
    row.setAttribute("data-message-id", "m-pinned");
    const spacer = document.createElement("div");
    container.append(row, spacer);

    const spacerHeight = () => parseFloat(spacer.style.height || "0") || 0;

    let scrollTop = 0;
    Object.defineProperty(container, "scrollTop", {
      get: () => scrollTop,
      set: (v) => {
        scrollTop = v;
      },
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", { value: clientHeight, configurable: true });
    Object.defineProperty(container, "scrollHeight", {
      get: () => contentEnd + spacerHeight(),
      configurable: true,
    });

    // Absolute page coordinates: the container's own top is 0, so a row at document offset
    // `rowTop` reads back as `rowTop - scrollTop` once the container has scrolled.
    container.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    row.getBoundingClientRect = () => ({ top: rowTop - scrollTop }) as DOMRect;
    spacer.getBoundingClientRect = () =>
      ({ top: contentEnd - scrollTop, height: spacerHeight() }) as DOMRect;

    // Stable ref objects: a fresh one per render would re-run the follow-the-tail effect, which
    // scrolls to `scrollHeight` — 0 under jsdom — and would undo the pin's own scroll.
    return {
      container,
      row,
      spacer,
      refs: { scrollContainerRef: { current: container }, spacerRef: { current: spacer } },
    };
  }

  it("sizes the spacer so the pinned row can reach the top, and scrolls to it once", () => {
    const { container, spacer, refs } = buildThread();

    const { result, rerender } = renderHook(() => useChatAutoScroll(refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();

    // 400 viewport - 100 of content below the pin - 10 padding.
    expect(spacer.style.height).toBe("290px");
    expect(container.scrollTop).toBe(900 - PIN_TOP_PADDING);

    // A second pass must not scroll again: the reader may have scrolled away deliberately.
    container.scrollTop = 0;
    rerender();
    expect(container.scrollTop).toBe(0);
  });

  it("never asks for a negative spacer once the reply outgrows the viewport", () => {
    const { spacer, refs } = buildThread({ contentEnd: 2000 });

    const { result, rerender } = renderHook(() => useChatAutoScroll(refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();

    expect(spacer.style.height).toBe("0px");
  });

  it("keeps the pin when the optimistic row is replaced by the server's copy", () => {
    const { row, spacer, refs } = buildThread();

    const { result, rerender } = renderHook(() => useChatAutoScroll(refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();
    spacer.style.height = "";

    row.setAttribute("data-message-id", "m-server");
    act(() => {
      result.current.retargetPin("m-pinned", "m-server");
    });
    rerender();

    expect(spacer.style.height).toBe("290px");
  });

  it("ignores a retarget aimed at a message that is not pinned", () => {
    const { row, spacer, refs } = buildThread();

    const { result, rerender } = renderHook(() => useChatAutoScroll(refs));

    act(() => {
      result.current.pinMessage("m-pinned");
      result.current.retargetPin("m-other", "m-server");
    });
    row.setAttribute("data-message-id", "m-server");
    rerender();

    // The pin still names m-pinned, which no longer exists, so nothing is measured.
    expect(spacer.style.height).toBe("");
  });

  it("collapses the spacer when the pin is cleared", () => {
    const { spacer, refs } = buildThread();

    const { result, rerender } = renderHook(() => useChatAutoScroll(refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();
    expect(spacer.style.height).toBe("290px");

    act(() => {
      result.current.clearPin();
    });
    rerender();
    expect(spacer.style.height).toBe("0px");
  });
});
