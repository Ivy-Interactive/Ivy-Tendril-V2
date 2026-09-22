import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { vi } from "vitest";
import { addCatalogs, i18n } from "../i18n";
import { catalogs as englishCatalogs } from "../locales/en/index";

// The app renders in English with every catalog present from the first render, as it does after
// `main.tsx` awaits `initI18n`: installed synchronously here, so no test waits on a lazy chunk. The
// components' English is already there - that package registers it statically. A key that is in no
// catalog throws instead of rendering itself, so an extraction typo fails the test that renders it.
addCatalogs("en", englishCatalogs);
i18n.setMissingKeyHandler("throw");

// Testing Library's `waitFor` gives up after 1000ms by default, but a vitest test is allowed
// 5000ms. That asymmetry is a flake generator rather than a safety net: on an unloaded machine
// every `waitFor` in this suite resolves in low tens of milliseconds, but when the CPU is
// saturated -- a full `cargo test` alongside, several agents, CI running suites in parallel --
// a render that normally takes 20ms can take past a second, and the helper fails the assertion
// while the test itself still had four seconds left to spend.
//
// It surfaces as a handful of render-heavy tests in one file failing together and then passing
// on a re-run, which reads like a logic bug and is not one. Raising the helper to match the test
// budget means a genuinely stuck expectation still fails, just on the test timeout, while a slow
// one is merely slow. Nothing here waits on a real timer, so this cannot mask a hang.
configure({ asyncUtilTimeout: 4500 });

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
