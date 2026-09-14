import "@testing-library/jest-dom";
import { vi } from "vitest";

// jsdom has no ResizeObserver; the components library's scroll-area and command primitives install
// one, so rendering DocsLayout dies before any assertion without this stub.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = ResizeObserverStub;
}

// jsdom implements neither scrollTo nor scrollIntoView. Anchor navigation and the "On this page" rail
// both call them. These are assigned unconditionally: jsdom *defines* window.scrollTo, it just throws
// "Not implemented" when called, so a presence check leaves the noise in place.
if (typeof Element !== "undefined") {
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
}

if (typeof window !== "undefined") {
  window.scrollTo = vi.fn();

  // Radix's dialog (behind CommandDialog) reads matchMedia; ThemeProvider reads it to resolve the
  // "system" theme. jsdom provides neither.
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
}
