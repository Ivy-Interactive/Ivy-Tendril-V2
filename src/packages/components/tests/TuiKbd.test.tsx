import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { TuiKbd, formatShortcut, splitKeys } from "../src/components/ui/TuiKbd";

describe("TuiKbd", () => {
  it("renders the whole shortcut inside a single boxed cap", () => {
    const { container } = render(<TuiKbd keys="Ctrl+Shift+C" />);
    const caps = container.querySelectorAll("kbd");
    expect(caps).toHaveLength(1);
    expect(caps[0].textContent).toBe("Ctrl+Shift+C");
  });

  it("renders a bare cap as one span per key, hidden from assistive tech", () => {
    const { container } = render(<TuiKbd keys={["Ctrl", "K"]} variant="bare" />);
    expect(container.querySelector("kbd")).toBeNull();
    const wrapper = container.querySelector(".tui-kbd--bare");
    expect(wrapper?.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper?.querySelectorAll("span")).toHaveLength(2);
  });

  it("renders an outline cap with per-key spans", () => {
    const { container } = render(<TuiKbd keys="Ctrl+K" variant="outline" />);
    const cap = container.querySelector("kbd.tui-kbd--outline");
    expect(cap).not.toBeNull();
    expect(cap?.querySelectorAll("span")).toHaveLength(2);
  });

  it("maps modifier and named keys to platform symbols when platform is set", () => {
    const { container } = render(<TuiKbd keys="Enter" platform />);
    expect(container.querySelector("kbd")?.textContent).toBe("↵");
  });

  it("returns null for an empty key list", () => {
    const { container } = render(<TuiKbd keys="" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("splitKeys", () => {
  it("splits a plus-joined string into trimmed keys", () => {
    expect(splitKeys("Ctrl + Shift + C")).toEqual(["Ctrl", "Shift", "C"]);
  });

  it("passes an array through unchanged aside from trimming", () => {
    expect(splitKeys([" Ctrl ", "K"])).toEqual(["Ctrl", "K"]);
  });
});

describe("formatShortcut", () => {
  it("glues single-character keys with a thin space", () => {
    expect(formatShortcut(["⌘", "⌥", "N"])).toBe("⌘ ⌥ N");
  });

  it("joins named keys with plus signs", () => {
    expect(formatShortcut("Ctrl+Shift+C")).toBe("Ctrl+Shift+C");
  });

  it("returns an empty string for no keys", () => {
    expect(formatShortcut("")).toBe("");
  });
});
