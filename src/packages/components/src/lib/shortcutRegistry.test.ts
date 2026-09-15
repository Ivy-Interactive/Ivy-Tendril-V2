import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseShortcut } from "./shortcut";
import {
  _getRegistrySize,
  _isListenerInstalled,
  _resetForTesting,
  getRegisteredShortcuts,
  registerShortcut,
  serializeShortcut,
  unregisterShortcut,
} from "./shortcutRegistry";

const register = (
  id: string,
  key: string,
  handler: () => void,
  extra: { isActive?: () => boolean; skipInInputs?: boolean; description?: string } = {},
) => {
  const shortcut = parseShortcut(key);
  if (!shortcut) throw new Error(`unparseable shortcut: ${key}`);
  registerShortcut({
    id,
    shortcut,
    handler,
    description: extra.description ?? `does ${id}`,
    isActive: extra.isActive ?? (() => true),
    skipInInputs: extra.skipInInputs ?? false,
    displayKey: key,
  });
};

const press = (init: KeyboardEventInit & { target?: Element }) => {
  const { target, ...rest } = init;
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...rest });
  (target ?? document.body).dispatchEvent(event);
  return event;
};

describe("shortcutRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    vi.useRealTimers();
  });

  it("fires a registration exactly once for a matching keydown", () => {
    const handler = vi.fn();
    register("a", "k", handler);

    press({ key: "k", code: "KeyK" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("debounces a duplicate press inside 300 ms and fires again after it", () => {
    const handler = vi.fn();
    register("a", "k", handler);

    press({ key: "k", code: "KeyK" });
    vi.advanceTimersByTime(299);
    press({ key: "k", code: "KeyK" });
    expect(handler).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    press({ key: "k", code: "KeyK" });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("suppresses the handler entirely while isActive() is false", () => {
    const handler = vi.fn();
    register("a", "k", handler, { isActive: () => false });

    press({ key: "k", code: "KeyK" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("honours skipInInputs for a keydown targeting an input", () => {
    const skipping = vi.fn();
    const notSkipping = vi.fn();
    register("skip", "k", skipping, { skipInInputs: true });
    register("keep", "j", notSkipping, { skipInInputs: false });

    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      press({ key: "k", code: "KeyK", target: input });
      expect(skipping).not.toHaveBeenCalled();

      press({ key: "j", code: "KeyJ", target: input });
      expect(notSkipping).toHaveBeenCalledTimes(1);
    } finally {
      input.remove();
    }
  });

  it("removes a registration on unregisterShortcut", () => {
    const handler = vi.fn();
    register("a", "k", handler);
    expect(_getRegistrySize()).toBe(1);

    unregisterShortcut("a");

    expect(_getRegistrySize()).toBe(0);
    press({ key: "k", code: "KeyK" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("enumerates live bindings through getRegisteredShortcuts", () => {
    let active = true;
    register("app:toggle-sidebar", "Ctrl+B", () => {}, {
      description: "Toggle sidebar collapse",
      isActive: () => active,
    });

    expect(getRegisteredShortcuts()).toEqual([
      {
        id: "app:toggle-sidebar",
        shortcutKey: serializeShortcut(parseShortcut("Ctrl+B")!),
        displayKey: "Ctrl+B",
        description: "Toggle sidebar collapse",
        isActive: true,
      },
    ]);

    active = false;
    expect(getRegisteredShortcuts()[0].isActive).toBe(false);
  });

  it("installs exactly one window listener, lazily", () => {
    const spy = vi.spyOn(window, "addEventListener");
    expect(_isListenerInstalled()).toBe(false);

    register("a", "a", () => {});
    expect(_isListenerInstalled()).toBe(true);

    register("b", "b", () => {});
    register("c", "c", () => {});
    expect(_isListenerInstalled()).toBe(true);

    const keydownInstalls = spy.mock.calls.filter(([type]) => type === "keydown");
    expect(keydownInstalls).toHaveLength(1);
    spy.mockRestore();
  });

  it("serializes a shortcut in canonical ctrl+meta+alt+shift+key order", () => {
    expect(
      serializeShortcut({ ctrl: true, meta: true, alt: true, shift: true, key: "K" }),
    ).toBe("ctrl+meta+alt+shift+k");
    expect(serializeShortcut({ ctrl: false, meta: false, alt: false, shift: false, key: "k" })).toBe(
      "k",
    );
  });

  it("matches on event.code and, independently, on event.key", () => {
    const byCode = vi.fn();
    register("code", "k", byCode);

    // A real browser populates `code`; jsdom's key-only events leave it empty.
    press({ key: "", code: "KeyK" });
    expect(byCode).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(400);
    press({ key: "k" });
    expect(byCode).toHaveBeenCalledTimes(2);
  });

  it("fires punctuation shortcuts, and keeps / and ? apart", () => {
    const slash = vi.fn();
    const question = vi.fn();
    register("slash", "/", slash);
    register("question", "?", question);

    // parseShortcut("?") reports shift: false, yet "?" is Shift+Slash.
    press({ key: "?", code: "Slash", shiftKey: true });
    expect(question).toHaveBeenCalledTimes(1);
    expect(slash).not.toHaveBeenCalled();

    press({ key: "/", code: "Slash" });
    expect(slash).toHaveBeenCalledTimes(1);
    expect(question).toHaveBeenCalledTimes(1);

    // The key-only form the app's current handlers rely on.
    vi.advanceTimersByTime(400);
    press({ key: "/" });
    expect(slash).toHaveBeenCalledTimes(2);
  });

  it("ignores auto-repeat and already-consumed keydowns", () => {
    const handler = vi.fn();
    register("a", "k", handler);

    press({ key: "k", code: "KeyK", repeat: true });
    expect(handler).not.toHaveBeenCalled();

    const consumer = (e: Event) => e.preventDefault();
    document.body.addEventListener("keydown", consumer, true);
    try {
      press({ key: "k", code: "KeyK" });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener("keydown", consumer, true);
    }
  });

  it("leaves the arrow keys to a composite widget that owns them", () => {
    const handler = vi.fn();
    register("nav", "ArrowRight", handler);

    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.innerHTML = '<div role="option" tabindex="0"></div>';
    document.body.appendChild(listbox);
    try {
      press({ key: "ArrowRight", code: "ArrowRight", target: listbox.firstElementChild! });
      expect(handler).not.toHaveBeenCalled();

      press({ key: "ArrowRight", code: "ArrowRight" });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      listbox.remove();
    }
  });

  it("requires the exact modifier set", () => {
    const handler = vi.fn();
    register("a", "k", handler);

    press({ key: "k", code: "KeyK", metaKey: true });
    press({ key: "k", code: "KeyK", ctrlKey: true });
    press({ key: "k", code: "KeyK", altKey: true });
    press({ key: "k", code: "KeyK", shiftKey: true });

    expect(handler).not.toHaveBeenCalled();
  });
});
