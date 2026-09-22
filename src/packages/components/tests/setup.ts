import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";
import { i18nStore } from "../src/i18n/runtime";

afterEach(() => {
  cleanup();
});

// A key that is in no catalog renders as the key in production and warns in development. In a test it
// throws, so a mistyped key - or a string extracted to a key nobody added - fails the test that
// renders it instead of passing with the key on screen.
i18nStore.setMissingKeyHandler("throw");

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Node 26 ships its own `localStorage` and `Storage` globals. They are already on `globalThis` when
// the jsdom environment copies its window over, so jsdom's versions never land: `localStorage` reads
// back undefined (Node leaves it so unless the process was started with `--localstorage-file`), and
// the visible `Storage` is Node's class, unrelated to the one jsdom's storage areas inherit from.
//
// Both matter here. The first makes `localStorage.getItem` throw. The second silently defeats
// `vi.spyOn(Storage.prototype, ...)`, which is how the resizable-sidebar tests simulate a storage
// area that throws - the spy lands on a class no object in the page is an instance of.
//
// jsdom's `sessionStorage` is untouched, so take the real implementation from there: alias
// `localStorage` to it, and restore `Storage` to the class it actually inherits from. The two areas
// then share one store, which is harmless in a test process that never uses sessionStorage.
if (typeof globalThis.localStorage === "undefined" && typeof sessionStorage !== "undefined") {
  const jsdomStorage = Object.getPrototypeOf(sessionStorage).constructor;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => sessionStorage,
  });
  Object.defineProperty(globalThis, "Storage", { configurable: true, value: jsdomStorage });
}
