import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCSSVariable,
  getSystemThemePreference,
  getThemeColors,
  isDarkMode,
} from "../src/lib/theme";
import { readCssInlined } from "./read-css";

/**
 * echarts draws to a canvas, so it cannot read `var(--primary)` — every colour handed to it has to
 * be a resolved value. These tests inject the package's own token stylesheet into jsdom and assert
 * that `getThemeColors()` comes back with real values rather than the empty strings you get when the
 * custom properties are missing, which is the failure mode that would silently paint every chart
 * black.
 */

const GLOBALS_CSS = resolve(import.meta.dirname, "../src/styles/globals.css");

/** Tokens spanning each block of `ThemeColors`: base, semantic, neutral, chromatic. */
const REPRESENTATIVE_TOKENS = [
  "background",
  "foreground",
  "primary",
  "mutedForeground",
  "red",
  "emerald",
  "slate",
] as const;

/** The representative tokens that are deliberately the *same* in light and dark.
 *
 * `primary` is the brand green (#00cc92), which is chosen to read on both backgrounds and is
 * mode-invariant on purpose; `mutedForeground` is a mid-grey (#8f8f8f) picked for the same reason.
 * The dark-palette test below asserts that a token actually changes with the mode, which is a real
 * guard — a dark class that silently failed to apply would leave every value at its light reading —
 * but applying it to these two asserts a divergence `tokens.css` never intended. */
const MODE_INVARIANT_TOKENS = new Set<(typeof REPRESENTATIVE_TOKENS)[number]>([
  "primary",
  "mutedForeground",
]);

const HEX = /^#[0-9a-f]{3,8}$/i;

function injectTokenStylesheet(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = readCssInlined(GLOBALS_CSS);
  document.head.appendChild(style);
  return style;
}

describe("theme colors", () => {
  let stylesheet: HTMLStyleElement;

  beforeEach(() => {
    stylesheet = injectTokenStylesheet();
  });

  afterEach(() => {
    // Unstub first: the `document`/`window` cases below leave the global undefined, and both this
    // teardown and the shared `cleanup()` in tests/setup.ts need the real one back.
    vi.unstubAllGlobals();
    stylesheet.remove();
    document.documentElement.classList.remove("dark");
  });

  it("resolves the representative tokens to real values, not empty strings", () => {
    const colors = getThemeColors();

    for (const token of REPRESENTATIVE_TOKENS) {
      expect(colors[token], token).toMatch(HEX);
    }
  });

  it("resolves the dark palette when the dark class is applied", () => {
    const light = getThemeColors();
    document.documentElement.classList.add("dark");
    const dark = getThemeColors();

    for (const token of REPRESENTATIVE_TOKENS) {
      expect(dark[token], token).toMatch(HEX);
      if (!MODE_INVARIANT_TOKENS.has(token)) {
        expect(dark[token], token).not.toBe(light[token]);
      }
    }

    // The point of the loop above is that the dark class took effect at all, so assert that
    // directly rather than relying on it falling out of the per-token comparisons.
    expect(dark).not.toEqual(light);
  });

  it("resolves non-colour tokens such as the radius", () => {
    expect(getThemeColors().radius).not.toBe("");
  });

  it("returns every field of ThemeColors non-empty", () => {
    const colors = getThemeColors();
    const empty = Object.entries(colors)
      .filter(([, value]) => value === "")
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  describe("getCSSVariable", () => {
    it("reads a single custom property", () => {
      expect(getCSSVariable("--primary")).toMatch(HEX);
    });

    it("returns an empty string for an undeclared property", () => {
      expect(getCSSVariable("--not-a-real-token")).toBe("");
    });

    it("returns an empty string when there is no document", () => {
      vi.stubGlobal("document", undefined);
      expect(getCSSVariable("--primary")).toBe("");
    });
  });

  describe("isDarkMode", () => {
    it("follows the documentElement class list", () => {
      expect(isDarkMode()).toBe(false);
      document.documentElement.classList.add("dark");
      expect(isDarkMode()).toBe(true);
      document.documentElement.classList.remove("dark");
      expect(isDarkMode()).toBe(false);
    });

    it("returns false when there is no document", () => {
      vi.stubGlobal("document", undefined);
      expect(isDarkMode()).toBe(false);
    });
  });

  describe("getSystemThemePreference", () => {
    it("reports the media query result", () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(prefers-color-scheme: dark)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));

      expect(getSystemThemePreference()).toBe("dark");
    });

    it("falls back to light when the preference is not set", () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));

      expect(getSystemThemePreference()).toBe("light");
    });

    it("returns light when there is no window", () => {
      vi.stubGlobal("window", undefined);
      expect(getSystemThemePreference()).toBe("light");
    });
  });
});
