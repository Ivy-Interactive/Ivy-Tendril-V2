import { describe, it, expect, beforeEach } from "vitest";

describe("test/setup.ts storage globals", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each(["localStorage", "sessionStorage"] as const)("%s is a real jsdom Storage", (name) => {
    const storage = globalThis[name];
    expect(Object.prototype.toString.call(storage)).toBe("[object Storage]");
  });

  it("window.localStorage is the same instance as the global", () => {
    expect(window.localStorage).toBe(localStorage);
  });

  it("window.sessionStorage is the same instance as the global", () => {
    expect(window.sessionStorage).toBe(sessionStorage);
  });

  it.each(["localStorage", "sessionStorage"] as const)("%s supports a full round-trip", (name) => {
    const storage = globalThis[name];
    storage.setItem("tendril-test-key", "tendril-test-value");
    expect(storage.getItem("tendril-test-key")).toBe("tendril-test-value");
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe("tendril-test-key");
    storage.removeItem("tendril-test-key");
    expect(storage.getItem("tendril-test-key")).toBeNull();

    storage.setItem("a", "1");
    storage.setItem("b", "2");
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it("still defines the pre-existing ResizeObserver stub (Plan 00143)", () => {
    expect(typeof globalThis.ResizeObserver).toBe("function");
  });

  it("still defines the pre-existing Element.scrollTo stub (Plan 00143)", () => {
    expect(typeof Element.prototype.scrollTo).toBe("function");
  });
});
