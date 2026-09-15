import { afterEach, describe, expect, it, vi } from "vitest";
import { isPunctuationKey, keyToCode } from "./shortcut";

const withUserAgent = async (userAgent: string) => {
  vi.stubGlobal("navigator", { userAgent, platform: "" });
  vi.resetModules();
  return import("./shortcut");
};

describe("parseShortcut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("maps mod to Command on Mac", async () => {
    const { parseShortcut } = await withUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    );
    expect(parseShortcut("mod+k")).toEqual({
      ctrl: false,
      meta: true,
      alt: false,
      shift: false,
      key: "k",
    });
  });

  it("maps mod to Ctrl everywhere else", async () => {
    const { parseShortcut } = await withUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(parseShortcut("mod+k")).toEqual({
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
      key: "k",
    });
  });
});

describe("keyToCode", () => {
  it("maps punctuation to its physical code", () => {
    expect(keyToCode("/")).toBe("Slash");
    // "?" is Shift+Slash, so it shares the Slash code.
    expect(keyToCode("?")).toBe("Slash");
    expect(keyToCode(",")).toBe("Comma");
    expect(keyToCode(".")).toBe("Period");
    expect(keyToCode(";")).toBe("Semicolon");
    expect(keyToCode("[")).toBe("BracketLeft");
    expect(keyToCode("-")).toBe("Minus");
    expect(keyToCode("`")).toBe("Backquote");
  });

  it("still maps the cases it already handled", () => {
    expect(keyToCode("a")).toBe("KeyA");
    expect(keyToCode("A")).toBe("KeyA");
    expect(keyToCode("1")).toBe("Digit1");
    expect(keyToCode("F12")).toBe("F12");
    expect(keyToCode("ArrowUp")).toBe("ArrowUp");
    expect(keyToCode("Backspace")).toBe("Backspace");
    expect(keyToCode("esc")).toBe("Escape");
  });
});

describe("isPunctuationKey", () => {
  it("is true only for a single non-alphanumeric character", () => {
    expect(isPunctuationKey("/")).toBe(true);
    expect(isPunctuationKey("?")).toBe(true);
    expect(isPunctuationKey("a")).toBe(false);
    expect(isPunctuationKey("1")).toBe(false);
    expect(isPunctuationKey("ArrowUp")).toBe(false);
  });
});
