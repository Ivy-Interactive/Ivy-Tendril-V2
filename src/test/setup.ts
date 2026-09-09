import "@testing-library/jest-dom";
import { vi } from "vitest";

// jsdom has no ResizeObserver, but components-storybook's AgentViewer installs
// one to drive auto-scroll. Without this stub any test that renders a job
// session dies with "ResizeObserver is not defined" before asserting anything.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = ResizeObserverStub;
}

// jsdom does not implement scrollTo or scroll on Element or HTMLElement.
// Components relying on programmatic scrolling (such as use-auto-scroll in
// components-storybook) fail with unhandled TypeErrors during rendering or
// animation frame callbacks unless these DOM methods are polyfilled.
if (typeof Element !== "undefined") {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = vi.fn();
  }
  if (!Element.prototype.scroll) {
    Element.prototype.scroll = vi.fn();
  }
}

if (typeof HTMLElement !== "undefined") {
  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = vi.fn();
  }
  if (!HTMLElement.prototype.scroll) {
    HTMLElement.prototype.scroll = vi.fn();
  }
}

if (typeof window !== "undefined") {
  if (!window.scrollTo) {
    window.scrollTo = vi.fn();
  }
  if (!window.scroll) {
    window.scroll = vi.fn();
  }
}

// Node >= 26 defines its own localStorage / sessionStorage globals. localStorage
// evaluates to undefined without --localstorage-file, but sessionStorage is a
// real, working, process-wide Storage object shared across every test file (a
// latent cross-file leak) - it is truthy, so a `!globalThis[name]` guard misses
// it. Vitest's populateGlobal skips any window key that is already a global and
// not in its curated KEYS list, so jsdom's real per-window Storage never lands
// on globalThis (nor on window, which is globalThis under Vitest) in either
// case. Re-attach it whenever the current global isn't already jsdom's own
// instance. No-op on Node 24, where Vitest copies jsdom's Storage itself.
const jsdomWindow = (globalThis as { jsdom?: { window: Window & typeof globalThis } }).jsdom?.window;
for (const name of ["localStorage", "sessionStorage"] as const) {
  if (jsdomWindow?.[name] && globalThis[name] !== jsdomWindow[name]) {
    Object.defineProperty(globalThis, name, {
      value: jsdomWindow[name],
      configurable: true,
      writable: true,
    });
  }
}
