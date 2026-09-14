import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatAutoScroll } from "../src/hooks/useChatAutoScroll";

describe("useChatAutoScroll hook unit tests", () => {
  const scrollIntoViewMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  it("initializes with default states: autoScrollEnabled=true, isLockedToTail=true, isAtBottom=true", () => {
    const { result } = renderHook(() => useChatAutoScroll());
    expect(result.current.autoScrollEnabled).toBe(true);
    expect(result.current.isLockedToTail).toBe(true);
    expect(result.current.isAtBottom).toBe(true);
  });

  it("toggles autoScrollEnabled state via toggleAutoScroll", () => {
    const { result } = renderHook(() => useChatAutoScroll());

    act(() => {
      result.current.toggleAutoScroll();
    });
    expect(result.current.autoScrollEnabled).toBe(false);

    act(() => {
      result.current.toggleAutoScroll();
    });
    expect(result.current.autoScrollEnabled).toBe(true);
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

  it("triggers notifyContentUpdate when content updates and autoScrollEnabled is true and isLockedToTail is true", () => {
    const anchor = document.createElement("div");
    anchor.scrollIntoView = scrollIntoViewMock;

    const { result, rerender } = renderHook(
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
    scrollIntoViewMock.mockClear();

    act(() => {
      result.current.toggleAutoScroll();
    });
    rerender({ content: "another delta", isGenerating: true });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
