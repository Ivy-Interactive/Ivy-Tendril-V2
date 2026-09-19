import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AgentViewer } from "./AgentViewer.tsx";
import { AGENT_VIEWER_VIRTUALIZATION_THRESHOLD } from "./use-agent-viewer-virtualization.ts";

/**
 * Windowing for agent output.
 *
 * The case these exist for is a run that produced 100k lines. Before windowing, every one of them was
 * a live DOM node: 20k lines measured at 13,335 top-level nodes and 66,678 elements, and 4.2 seconds to
 * mount in jsdom. The assertion that makes windowing stick is not "it renders" but "the rendered count
 * does not grow with the input", which is why the counts below are checked at two sizes an order of
 * magnitude apart.
 */

/** Height every node reports, matching a collapsed tool call plus the body's gap. */
const NODE_HEIGHT = 34;
/** Height of the scroll viewport — ten nodes. */
const VIEWPORT_HEIGHT = 340;

/**
 * Mutable so the resize test can make a node measure taller, the way narrowing the viewer makes a
 * wrapped paragraph taller.
 */
let nodeHeight = NODE_HEIGHT;
/** Mutable for the same reason: the hook only re-measures when the scroller's *width* changed. */
let bodyWidth = 800;
/**
 * Every live `ResizeObserver` registration, so a test can fire them by hand — and pick which.
 *
 * Which matters: the viewer's own effect observes the scroll element, while react-virtual observes each
 * rendered node as well. Firing the node observers re-measures the window, which would mask whether the
 * effect dropped the cache in the first place.
 */
let resizeObservations: { target: Element; fire: () => void }[] = [];

/** One `tool_call` line, which parses to exactly one collapsed tool-card node. */
function toolLine(index: number): string {
  return JSON.stringify({
    kind: "tool_call",
    timestamp: "",
    tool_use_id: `t${index}`,
    tool_name: "Read",
    input: { path: `/repo/file-${index}.ts` },
  });
}

function toolLines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => toolLine(index));
}

function bodyOf(container: HTMLElement): HTMLDivElement {
  const body = container.querySelector<HTMLDivElement>(".aov-body");
  if (!body) throw new Error("No viewer body rendered");
  return body;
}

function canvasOf(container: HTMLElement): HTMLDivElement | null {
  return container.querySelector<HTMLDivElement>(".aov-virtual-canvas");
}

function renderedIndices(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".aov-virtual-node[data-index]")).map(
    (node) => Number(node.dataset.index),
  );
}

function scrollTo(scroller: HTMLElement, offset: number) {
  act(() => {
    scroller.scrollTop = offset;
    scroller.dispatchEvent(new Event("scroll"));
  });
}

/** Fires the resize observations on the elements matching `selector`, and nothing else. */
function fireResize(selector: string) {
  const firing = resizeObservations.filter((entry) => entry.target.matches(selector));
  act(() => {
    for (const entry of firing) entry.fire();
  });
}

/** Lets `useAutoScroll`'s deferred `scrollToBottom` run — it defers a frame on purpose. */
async function flushFrames() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

let originalScrollTo: PropertyDescriptor | undefined;
let originalResizeObserver: typeof ResizeObserver | undefined;
let originalGetBoundingClientRect: PropertyDescriptor | undefined;

beforeEach(() => {
  nodeHeight = NODE_HEIGHT;
  bodyWidth = 800;
  resizeObservations = [];
  // virtual-core measures with `offsetHeight`, and `useAutoScroll` reads `scrollHeight` and
  // `clientHeight`; jsdom lays nothing out and reports 0 for all three, which would leave the
  // virtualizer with a zero-height viewport and autoscroll with nothing to scroll.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-index")) return nodeHeight;
      if (this.classList.contains("aov-body")) return VIEWPORT_HEIGHT;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("aov-body") ? VIEWPORT_HEIGHT : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("aov-body") ? bodyWidth : 0;
    },
  });
  // virtual-core measures an *item* with `getBoundingClientRect` (its `measureElement` default) and the
  // *scroll element* with `offsetHeight`; jsdom returns zeros from the former, so without this no node
  // is ever measured and every total below would only ever be the estimate — which would make these
  // tests unable to tell a measurement from a guess.
  originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getBoundingClientRect",
  );
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: function boundingRect(this: Element) {
      const height = this.hasAttribute("data-index") ? nodeHeight : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: bodyWidth,
        bottom: height,
        width: bodyWidth,
        height,
      };
    },
  });
  // The setup file's stub is inert, which would leave the width-invalidation effect unobservable.
  // virtual-core reads `entries[0].target`, so the entries have to be real enough for that.
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class implements ResizeObserver {
    private readonly mine = new Set<() => void>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const fire = () => {
        const box = { inlineSize: bodyWidth, blockSize: nodeHeight };
        this.callback(
          [
            {
              target,
              borderBoxSize: [box],
              contentBoxSize: [box],
              devicePixelContentBoxSize: [box],
              contentRect: { width: bodyWidth, height: nodeHeight } as DOMRectReadOnly,
            } as unknown as ResizeObserverEntry,
          ],
          this,
        );
      };
      this.mine.add(fire);
      resizeObservations.push({ target, fire });
    }
    unobserve() {}
    disconnect() {
      resizeObservations = resizeObservations.filter((entry) => !this.mine.has(entry.fire));
    }
  };
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains("aov-body")) return 0;
      const canvas = this.querySelector<HTMLElement>(".aov-virtual-canvas");
      return canvas ? Number.parseFloat(canvas.style.height) || 0 : 0;
    },
  });
  originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: function scrollToStub(
      this: HTMLElement,
      options?: number | ScrollToOptions,
      y?: number,
    ) {
      const top = typeof options === "number" ? y : options?.top;
      if (typeof top !== "number") return;
      this.scrollTop = top;
      // Deferred, because a browser never fires `scroll` from inside `scrollTo`. Firing it
      // synchronously re-enters the virtualizer in the middle of measuring a node — `resizeItem`
      // adjusts the offset when an item above the fold changes size — and the measurement it was
      // taking is lost, which would leave every total below an estimate and these tests unable to
      // tell a measured height from a guessed one.
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
  if (originalGetBoundingClientRect) {
    Object.defineProperty(
      Element.prototype,
      "getBoundingClientRect",
      originalGetBoundingClientRect,
    );
  }
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  }
});

describe("AgentViewer windowing", () => {
  it("renders a bounded number of nodes whether the run is 5k lines or 50k", () => {
    const small = render(
      <AgentViewer
        id="small"
        jsonLines={toolLines(5_000)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    const smallCount = renderedIndices(small.container).length;

    const large = render(
      <AgentViewer
        id="large"
        jsonLines={toolLines(50_000)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    const largeCount = renderedIndices(large.container).length;

    // The whole point: ten times the input, the same DOM.
    expect(largeCount).toBe(smallCount);
    // A viewport of nodes plus the overscan either side, nowhere near the 50,000 in the log.
    expect(largeCount).toBeLessThan(40);
    expect(largeCount).toBeGreaterThan(0);
    expect(large.container.querySelectorAll("*").length).toBeLessThan(500);
  });

  it("describes the whole run in the scroll height even though it renders a slice of it", () => {
    const count = 50_000;
    const { container } = render(
      <AgentViewer
        id="tall"
        jsonLines={toolLines(count)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    // Every node measures at exactly the estimate, so the total is exact rather than approximate:
    // that equality is what says the estimate and the rendered height agree.
    expect(Number.parseFloat(canvasOf(container)!.style.height)).toBe(count * NODE_HEIGHT);
  });

  it("windows only past the threshold, so a short run is still one plain flow of nodes", () => {
    const short = render(
      <AgentViewer
        id="short"
        jsonLines={toolLines(AGENT_VIEWER_VIRTUALIZATION_THRESHOLD)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    expect(canvasOf(short.container)).toBeNull();
    expect(short.container.querySelectorAll(".aov-tool").length).toBe(
      AGENT_VIEWER_VIRTUALIZATION_THRESHOLD,
    );
    expect(bodyOf(short.container).className).not.toContain("aov-body-windowed");

    const long = render(
      <AgentViewer
        id="long"
        jsonLines={toolLines(AGENT_VIEWER_VIRTUALIZATION_THRESHOLD + 1)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    expect(canvasOf(long.container)).not.toBeNull();
    expect(bodyOf(long.container).className).toContain("aov-body-windowed");
  });

  it("renders everything when a caller opts windowing out", () => {
    const count = AGENT_VIEWER_VIRTUALIZATION_THRESHOLD + 40;
    const { container } = render(
      <AgentViewer
        id="plain"
        jsonLines={toolLines(count)}
        virtualized={false}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    expect(canvasOf(container)).toBeNull();
    expect(container.querySelectorAll(".aov-tool").length).toBe(count);
  });

  it("leaves the reader where they were when output is appended", () => {
    // The trap `DataTable` documents: it reset the virtualizer on any change of row identity, and a
    // bug in telling an append apart from a replacement made every appended window call
    // `scrollToOffset(0)`. Agent output is nothing but appends, so this is the one that would make a
    // long run unreadable.
    const lines = toolLines(1_000);
    const { container, rerender } = render(
      <AgentViewer id="live" jsonLines={lines} autoScroll={false} eventHandler={() => {}} />,
    );
    const scroller = bodyOf(container);

    scrollTo(scroller, 500 * NODE_HEIGHT);
    const before = renderedIndices(container);
    expect(before[0]).toBeGreaterThan(400);

    for (let i = 0; i < 200; i++) lines.push(toolLine(1_000 + i));
    rerender(
      <AgentViewer id="live" jsonLines={lines} autoScroll={false} eventHandler={() => {}} />,
    );

    expect(scroller.scrollTop).toBe(500 * NODE_HEIGHT);
    expect(renderedIndices(container)[0]).toBe(before[0]);
    // The appended lines are in the log even though they are nowhere near the DOM.
    expect(Number.parseFloat(canvasOf(container)!.style.height)).toBe(1_200 * NODE_HEIGHT);
  });

  it("returns to the top when the viewer is pointed at different output", async () => {
    const { container, rerender } = render(
      <AgentViewer
        id="job-1"
        jsonLines={toolLines(1_000)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    const scroller = bodyOf(container);
    scrollTo(scroller, 500 * NODE_HEIGHT);
    expect(renderedIndices(container)[0]).toBeGreaterThan(400);

    rerender(
      <AgentViewer
        id="job-2"
        jsonLines={toolLines(1_000)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    // The reset scrolls the element; the `scroll` event that tells the virtualizer about it arrives
    // after, as it does in a browser.
    await flushFrames();

    expect(scroller.scrollTop).toBe(0);
    expect(renderedIndices(container)[0]).toBe(0);
  });

  it("follows live output while the reader is at the bottom", async () => {
    const lines = toolLines(500);
    const { container, rerender } = render(
      <AgentViewer id="follow" jsonLines={lines} autoScroll eventHandler={() => {}} />,
    );
    const scroller = bodyOf(container);
    await flushFrames();
    expect(scroller.scrollTop).toBe(500 * NODE_HEIGHT - VIEWPORT_HEIGHT);
    const firstFollowed = renderedIndices(container)[0];

    for (let i = 0; i < 100; i++) lines.push(toolLine(500 + i));
    rerender(<AgentViewer id="follow" jsonLines={lines} autoScroll eventHandler={() => {}} />);
    await flushFrames();

    expect(scroller.scrollTop).toBe(600 * NODE_HEIGHT - VIEWPORT_HEIGHT);
    // Following means the window moved with the output rather than the reader.
    expect(renderedIndices(container)[0]).toBeGreaterThan(firstFollowed);
    expect(renderedIndices(container)).toContain(599);
  });

  it("stops following the moment the reader scrolls up, and stays stopped", async () => {
    const lines = toolLines(500);
    const { container, rerender } = render(
      <AgentViewer id="disengage" jsonLines={lines} autoScroll eventHandler={() => {}} />,
    );
    const scroller = bodyOf(container);
    await flushFrames();

    // A wheel away from the bottom is what disengages: the same gesture the viewer has always used.
    scrollTo(scroller, 100 * NODE_HEIGHT);
    fireEvent.wheel(scroller);

    for (let i = 0; i < 100; i++) lines.push(toolLine(500 + i));
    rerender(<AgentViewer id="disengage" jsonLines={lines} autoScroll eventHandler={() => {}} />);
    await flushFrames();

    expect(scroller.scrollTop).toBe(100 * NODE_HEIGHT);
    expect(renderedIndices(container)).not.toContain(599);
  });

  /** What a node measures at in the resize test — deliberately not its estimate. */
  const MEASURED_HEIGHT = 50;

  const totalOf = (container: HTMLElement) => Number.parseFloat(canvasOf(container)!.style.height);

  it("forgets its heights when the width changes, and keeps them when only the height does", () => {
    // Long runs in agent output wrap (`agent-output.css`), so a node's height is a function of the width
    // it was laid out at. react-virtual watches the scroll element's rect and re-renders but *keeps* the
    // heights it measured, which after a resize puts every node below the window at an offset computed
    // from a width that no longer applies — the scrollbar lying and the scroll position drifting. A
    // change of height alone (the sheet opening, the status row appearing) changes no node's height, and
    // dropping the cache for one would throw away a whole run's measurements for nothing.
    //
    // Only the *scroll element's* observations are fired, not the per-node ones: a node re-measuring
    // would refill whatever the cache had just dropped and hide the difference being tested.
    const count = 1_000;
    nodeHeight = MEASURED_HEIGHT;
    const { container } = render(
      <AgentViewer
        id="resize"
        jsonLines={toolLines(count)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    const measured = totalOf(container);
    expect(measured, "the first window has to be measured, not estimated").toBeGreaterThan(
      count * NODE_HEIGHT,
    );

    // A taller viewer, same width: nothing a node measures has changed.
    fireResize(".aov-body");
    expect(totalOf(container)).toBe(measured);

    // Narrower: every measurement was taken at a width that no longer applies, so none of them is kept
    // and the run is back to its estimate until the window measures itself again.
    bodyWidth = 400;
    fireResize(".aov-body");
    const afterNarrowing = totalOf(container);
    expect(afterNarrowing).toBeLessThan(measured);
    // Back to the estimate for the whole run, give or take the one node the re-render happened to
    // re-measure on its way past.
    expect(afterNarrowing - count * NODE_HEIGHT).toBeLessThan(MEASURED_HEIGHT);
  });

  it("re-engages once the reader returns to the bottom", async () => {
    const lines = toolLines(500);
    const { container, rerender } = render(
      <AgentViewer id="reengage" jsonLines={lines} autoScroll eventHandler={() => {}} />,
    );
    const scroller = bodyOf(container);
    await flushFrames();

    scrollTo(scroller, 100 * NODE_HEIGHT);
    fireEvent.wheel(scroller);
    scrollTo(scroller, 500 * NODE_HEIGHT - VIEWPORT_HEIGHT);

    for (let i = 0; i < 50; i++) lines.push(toolLine(500 + i));
    rerender(<AgentViewer id="reengage" jsonLines={lines} autoScroll eventHandler={() => {}} />);
    await flushFrames();

    expect(scroller.scrollTop).toBe(550 * NODE_HEIGHT - VIEWPORT_HEIGHT);
  });
});
