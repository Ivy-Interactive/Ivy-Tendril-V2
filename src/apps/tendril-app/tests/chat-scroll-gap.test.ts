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
  // Before the spinner lands, the browser has nothing to lay the spacer's requested height out
  // against yet — the row it would sit beside doesn't exist, so growing the spacer alone can't
  // widen the scroll range the way it can once there's a sibling there to grow next to. Capping
  // what the spacer can contribute until then is what turns the pin's write into one the `scrollTop`
  // setter below actually clamps, the way `sendMessage`'s same-notify `isGenerating` update does in
  // the real thread: the spacer and the "Working…" row settle into the DOM together, and the scroll
  // range the spacer promises isn't real until both have.
  let spacerContributionCap = Infinity;
  const heightOf = (el: HTMLElement) =>
    el.dataset.spacer === "1"
      ? Math.min(parseFloat(el.style.height || "0"), spacerContributionCap)
      : Number(el.dataset.h ?? 0);
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

  const older = add(document.createElement("div"), olderHeight);
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
    /**
     * Grows the history above the pinned row, standing in for layout that only settles a frame
     * after commit — `resetComposer` collapsing the textarea and the "Working…" row both land in
     * the render `pinMessage` reacts to, and jsdom aside, a real browser doesn't guarantee every
     * sibling's box is final by the time `useLayoutEffect` runs. It moves `targetTop` for the
     * pinned row itself without React re-rendering, which is exactly what the one-shot scroll has
     * to notice on its own — nothing re-measures it for free the way a prop change would.
     */
    growHistoryAbovePin: (extraHeight: number) => {
      older.dataset.h = String(olderHeight + extraHeight);
    },
    /**
     * Inserts the "Working…" row the way `ChatView.tsx` does: below the pinned message, between it
     * and the reply, and lifts the cap that was holding `scrollHeight` short. It never moves
     * `targetTop` — nothing above the pin changed — so `pinnedScrollTop()` reads the same before and
     * after; what changes is that the position becomes reachable, where the clamp had held the
     * chase's earlier writes short of it.
     */
    insertSpinnerRow: (height: number) => {
      const spinner = document.createElement("div");
      spinner.dataset.h = String(height);
      wrapper.insertBefore(spinner, assistant);
      rows.splice(rows.indexOf(assistant), 0, spinner);
      spinner.getBoundingClientRect = () =>
        ({ top: topOf(spinner) - scrollTop, height: heightOf(spinner) }) as DOMRect;
      spacerContributionCap = Infinity;
    },
    /** Caps how much of the pin spacer's requested height actually widens the scroll range. */
    capSpacerContribution: (cap: number) => {
      spacerContributionCap = cap;
    },
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

/**
 * A `requestAnimationFrame`/`cancelAnimationFrame` pair the test can drive on demand, standing in
 * for the frames the one-shot pin scroll chases while it waits for the clamp to let go, and for the
 * unmount cleanup that has to be able to call the real thing off a frame that never runs.
 */
class ControllableRaf {
  private queue = new Map<number, FrameRequestCallback>();
  private nextId = 1;

  install(): () => void {
    const originalRequest = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = this.nextId++;
      this.queue.set(id, callback);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      this.queue.delete(id);
    }) as typeof cancelAnimationFrame;
    return () => {
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    };
  }

  /** Runs every callback queued so far, including ones newly queued by running them. */
  flush(): void {
    while (this.queue.size > 0) {
      const [id, callback] = this.queue.entries().next().value as [number, FrameRequestCallback];
      this.queue.delete(id);
      callback(0);
    }
  }
}

describe("chat thread pin spacer leaves no dead space above the composer", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const raf = new ControllableRaf();
  let uninstallRaf: () => void;

  beforeEach(() => {
    ControllableResizeObserver.instances = [];
    globalThis.ResizeObserver = ControllableResizeObserver;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    uninstallRaf = raf.install();
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    uninstallRaf();
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

  it("keeps chasing the pinned row across frames until its position stabilises", () => {
    const thread = buildThread();

    const { result, rerender } = renderHook(() => useChatAutoScroll(thread.refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();

    // First pass: the scroll already lands on that pass's target — this is the case that used to
    // hide the bug, because a layout that never moves again makes the single-measurement version
    // look correct too.
    const firstPassTarget = thread.pinnedScrollTop();
    expect(thread.container.scrollTop).toBe(firstPassTarget);

    // A frame later: the history above the pin grows, the way the composer collapsing back to one
    // line — or any other sibling settling after `useLayoutEffect` already ran — would shift every
    // row below it without React re-rendering. Nothing here re-measures on its own; the stale
    // first-pass position is still in effect until the hook's own chase catches up.
    thread.growHistoryAbovePin(96);
    const settledTarget = thread.pinnedScrollTop();
    expect(settledTarget).not.toBe(firstPassTarget);
    expect(thread.container.scrollTop).toBe(firstPassTarget);

    // The hook already queued a `requestAnimationFrame` after the first measurement, chasing
    // stability; flushing it re-measures against the now-settled layout and corrects the scroll.
    act(() => {
      raf.flush();
    });
    expect(thread.container.scrollTop).toBe(settledTarget);

    // A second flush confirms it latches rather than chasing forever: once the reader has scrolled
    // away, later frames must leave that alone rather than fight it back to the pin.
    thread.container.scrollTop = 0;
    act(() => {
      raf.flush();
    });
    expect(thread.container.scrollTop).toBe(0);
  });

  it("corrects the scroll once the spinner row grows scrollHeight past what the first write reached", () => {
    const thread = buildThread();
    // The spinner-less scroll range: the spacer would reserve enough room on its own, but nothing
    // has grown into it yet, the way `sendMessage`'s same-notify `isGenerating` update leaves the
    // spacer's requested height not yet backed by real layout until the "Working…" row lands beside it.
    thread.capSpacerContribution(0);

    const { result, rerender } = renderHook(() => useChatAutoScroll(thread.refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();

    // First pass, spinner-less: the clamp bites, and the write lands short of the pin.
    expect(thread.maxScroll()).toBeLessThan(thread.pinnedScrollTop());
    expect(thread.container.scrollTop).toBe(thread.maxScroll());

    // A frame later: `isGenerating` lands and the "Working…" row is in the DOM, growing
    // `scrollHeight` — nothing above the pin moved, so `pinnedScrollTop()` itself is unchanged.
    thread.insertSpinnerRow(120);
    const target = thread.pinnedScrollTop();

    act(() => {
      raf.flush();
    });

    expect(thread.container.scrollTop).toBe(target);
  });

  it("stops correcting once the reader scrolls away mid-chase, without fighting it back", () => {
    const thread = buildThread({ clientHeight: 460 });
    // A little slack, rather than a hard 0, so there's room for the reader's scroll below to land
    // somewhere other than exactly where the clamp already held the chase's own write.
    thread.capSpacerContribution(20);

    const { result, rerender } = renderHook(() => useChatAutoScroll(thread.refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();

    // Still clamped, still chasing — a frame is already queued.
    const clampedWrite = thread.container.scrollTop;
    expect(clampedWrite).toBeLessThan(thread.pinnedScrollTop());

    // The reader scrolls up before the next frame runs. This is indistinguishable, from inside the
    // chase, from "the clamp let go and settled somewhere the chase didn't write" — which is
    // exactly why it has to compare against what it itself last wrote, not just against `desired`.
    thread.container.scrollTop = Math.max(0, clampedWrite - 5);
    const scrolledAway = thread.container.scrollTop;
    expect(scrolledAway).not.toBe(clampedWrite);

    act(() => {
      raf.flush();
    });

    // Nothing more is written: the pin recognises this scrollTop is not one it wrote and backs off.
    expect(thread.container.scrollTop).toBe(scrolledAway);

    // And it stays backed off — inserting the spinner and flushing again must not revive the chase.
    thread.insertSpinnerRow(120);
    act(() => {
      raf.flush();
    });
    expect(thread.container.scrollTop).toBe(scrolledAway);
  });

  it("cancels the pending frame on unmount, so it never writes to a detached tree", () => {
    const thread = buildThread();
    thread.capSpacerContribution(0);

    const { result, rerender, unmount } = renderHook(() => useChatAutoScroll(thread.refs));

    act(() => {
      result.current.pinMessage("m-pinned");
    });
    rerender();

    // Still clamped, still chasing — a frame is queued for the correction.
    const beforeUnmount = thread.container.scrollTop;
    expect(beforeUnmount).toBeLessThan(thread.pinnedScrollTop());

    unmount();
    thread.insertSpinnerRow(120);

    // If the frame fired anyway, this would move: the spinner just made the correct position
    // reachable, and a live chase would jump straight to it the moment it re-measured.
    act(() => {
      raf.flush();
    });
    expect(thread.container.scrollTop).toBe(beforeUnmount);
  });
});
