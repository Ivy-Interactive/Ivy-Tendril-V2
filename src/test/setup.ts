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
