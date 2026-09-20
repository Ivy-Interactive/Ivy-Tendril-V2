import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatAutoScroll, PIN_TOP_PADDING } from "../src/hooks/useChatAutoScroll";

/**
 * The dead space a streaming reply used to leave between the last message and the composer.
 *
 * Both cases here are about the pin spacer, the element that makes "keep my question at the top of
 * the viewport" reachable: it is sized so that the bottom of the scroll range *is* the pinned
 * position, and it shrinks as the reply below it grows. Get that height wrong and the excess is
 * visible as a gap under the reply, because the thread can still be scrolled past the pin into
 * space nothing will ever fill.
 *
 * Ported against `Ivy-Tendril/src/Ivy.Tendril.Widgets/frontend/src/ChatWidget/useThreadScroll.ts`
 * and the observer pair in `ChatWidget.tsx` that keeps its measurement honest.
 */

/** The `gap-6` the shared `ChatMessageList` puts between every row of the thread. */
const ROW_GAP = 24;

/**
 * A stand-in for the thread's layout, because the measurement under test is geometric and jsdom
 * reports every box as zero-sized.
 *
 * It models what `ChatMessageList` actually renders: a scroller holding one flex column, whose
 * children are the rows, then the pin spacer, then the 1px scroll anchor, each separated by
 * `gap-6`. The anchor after the spacer is the part V1 never had — there the spacer is the last
 * child of `.chat-thread` — and it is what these cases are about.
 */
function buildThread({ clientHeight = 600, olderHeight = 400, userHeight = 60 } = {}) {
  const container = document.createElement("div");
  const wrapper = document.createElement("div");
  container.append(wrapper);

  const rows: HTMLElement[] = [];
  const heightOf = (el: HTMLElement) =>
    el.dataset.spacer === "1" ? parseFloat(el.style.height || "0") : Number(el.dataset.h ?? 0);
  const contentHeight = () =>
    rows.reduce((sum, row, index) => sum + heightOf(row) + (index > 0 ? ROW_GAP : 0), 0);
  const topOf = (el: HTMLElement) => {
    let top = 0;
    for (const row of rows) {
      if (row === el) return top;
      top += heightOf(row) + ROW_GAP;
    }
    return top;
  };

  let scrollTop = 0;
  const maxScroll = () => Math.max(0, contentHeight() - clientHeight);
  Object.defineProperty(container, "scrollTop", {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = Math.max(0, Math.min(next, maxScroll()));
    },
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(container, "scrollHeight", { get: contentHeight, configurable: true });
  container.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;

  const add = (el: HTMLElement, height: number) => {
    el.dataset.h = String(height);
    wrapper.append(el);
    rows.push(el);
    el.getBoundingClientRect = () =>
      ({ top: topOf(el) - scrollTop, height: heightOf(el) }) as DOMRect;
    return el;
  };

  add(document.createElement("div"), olderHeight);
  const userRow = document.createElement("div");
  userRow.setAttribute("data-message-id", "m-pinned");
  add(userRow, userHeight);
  // The reply, still empty: the turn has only just started.
  const assistant = add(document.createElement("div"), 0);
  const spacer = document.createElement("div");
  spacer.dataset.spacer = "1";
  spacer.style.height = "0px";
  add(spacer, 0);
  add(document.createElement("div"), 1);

  return {
    container,
    assistant,
    spacer,
    maxScroll,
    /** Where the thread has to be scrolled for the pinned row to sit under the top padding. */
    pinnedScrollTop: () => topOf(userRow) - PIN_TOP_PADDING,
    refs: {
      scrollContainerRef: { current: container },
      spacerRef: { current: spacer },
    },
  };
}

/** A `ResizeObserver` the test can fire, standing in for a row that grows after React rendered it. */
class ControllableResizeObserver implements ResizeObserver {
  static instances: ControllableResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  static fireAll(): void {
    for (const instance of ControllableResizeObserver.instances) {
      instance.callback([], instance);
    }
  }
}

describe("chat thread pin spacer leaves no dead space above the composer", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    ControllableResizeObserver.instances = [];
    globalThis.ResizeObserver = ControllableResizeObserver;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it("counts what the list renders after the spacer, so the scroll range ends at the pin", () => {
    const thread = buildThread();

    const { result, rerender } = renderHook(() => useChatAutoScroll(thread.refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();

    // The whole point of the spacer: scrolled all the way down, the pinned row is at the top. Any
    // slack between these two numbers is scrollable emptiness under the reply — the reported gap.
    // V1 gets this for free because its spacer is the last child of the thread; here the scroll
    // anchor and its `gap-6` sit below it and have to come out of the spacer's height.
    expect(thread.maxScroll()).toBe(thread.pinnedScrollTop());
  });

  it("re-measures when a row grows after React has already rendered it", () => {
    const thread = buildThread();

    const { result, rerender } = renderHook(() => useChatAutoScroll(thread.refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();

    const sizedForEmptyReply = parseFloat(thread.spacer.style.height);
    expect(sizedForEmptyReply).toBeGreaterThan(0);

    // Markdown that resolved a lazy chunk, an image that decoded, a font that swapped: the row is
    // 300px taller than it was when React rendered it, and no state changed, so nothing re-renders.
    // V1 catches exactly this with the ResizeObserver/MutationObserver pair in `ChatWidget.tsx`.
    thread.assistant.dataset.h = "300";
    act(() => {
      ControllableResizeObserver.fireAll();
    });

    // The reply now fills 300px of what the spacer was reserving, so the spacer has to give it back.
    expect(parseFloat(thread.spacer.style.height)).toBe(sizedForEmptyReply - 300);
    expect(thread.maxScroll()).toBe(thread.pinnedScrollTop());
  });
});
