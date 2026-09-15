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

// jsdom has no canvas, and xterm.js measures text on one as soon as it is imported. Any test that
// imports the components barrel therefore logs a "Not implemented: getContext" error, even without
// rendering a Terminal. jsdom's own getContext returns null after complaining, so this changes
// nothing but the noise.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => null,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// This environment's window has no matchMedia, so useIsMobile in components-storybook
// throws "window.matchMedia is not a function" from its effect — which surfaces as a
// render failure in anything built on the blade container. The stub reports "not
// matching" and never fires a change event, so useIsMobile falls back to innerWidth
// (1024 in jsdom) and every blade renders in its expanded, non-collapsed form.
//
// xterm.js needs the same stub for a different reason: it watches a `(resolution: <n>dppx)` query
// for device-pixel-ratio changes as soon as a terminal is opened, and without one it dies inside
// its constructor — in an async callback, so it surfaces as an unhandled rejection rather than a
// failed assertion.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
