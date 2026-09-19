import { describe, it, expect } from "vitest";
import { isEditableTarget } from "./types";

/**
 * `isEditableTarget` is the "don't steal this keystroke" check every shell chord consults
 * (`ShellAgentButton`'s Cmd/Ctrl+Alt+A, and the rest). It used to cast `e.target` to
 * `HTMLElement | null` and guard only on null, which a keydown dispatched at `window` or `document`
 * passes — the target is non-null but has no `closest`, so the final clause threw a TypeError out of
 * the handler and the chord silently did nothing.
 */

const keydownWithTarget = (target: EventTarget): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: "a" });
  // `target` is read-only on a constructed event, and only a real dispatch sets it.
  Object.defineProperty(event, "target", { value: target, configurable: true });
  return event;
};

describe("isEditableTarget", () => {
  it("does not throw for a keydown targeted at window", () => {
    expect(() => isEditableTarget(keydownWithTarget(window))).not.toThrow();
    expect(isEditableTarget(keydownWithTarget(window))).toBe(false);
  });

  it("does not throw for a keydown targeted at document", () => {
    expect(isEditableTarget(keydownWithTarget(document))).toBe(false);
  });

  it("treats a missing target as not editable", () => {
    const event = new KeyboardEvent("keydown", { key: "a" });
    expect(isEditableTarget(event)).toBe(false);
  });

  it("still reports the editable elements it exists to protect", () => {
    for (const tag of ["input", "textarea", "select"] as const) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(isEditableTarget(keydownWithTarget(el)), tag).toBe(true);
      el.remove();
    }
  });

  it("still reports a contenteditable host and anything inside a terminal", () => {
    const editable = document.createElement("div");
    // jsdom does not implement `isContentEditable` — it stays false however `contentEditable` is
    // set — so the property is defined directly. The check under test reads that property, which is
    // what a browser computes from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.appendChild(editable);
    expect(isEditableTarget(keydownWithTarget(editable))).toBe(true);
    editable.remove();

    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const inner = document.createElement("span");
    terminal.appendChild(inner);
    document.body.appendChild(terminal);
    expect(isEditableTarget(keydownWithTarget(inner))).toBe(true);
    terminal.remove();
  });

  it("leaves an ordinary element alone, which is what lets a chord fire", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(isEditableTarget(keydownWithTarget(div))).toBe(false);
    div.remove();
  });
});
