import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { NAMED_COLORS } from "../src/stories/colors.stories.tsx";

const globalsCss = readFileSync(
  resolve(__dirname, "..", "src/styles/globals.css"),
  "utf-8",
) as string;

/** Same extraction the contrast assertions in button.test.tsx use. */
const rootBlock = /:root\s*\{([^}]+)\}/s.exec(globalsCss)?.[1] ?? "";
const darkBlock = /\.dark\s*\{([^}]+)\}/s.exec(globalsCss)?.[1] ?? "";
const themeBlock = /@theme inline\s*\{([^}]+)\}/s.exec(globalsCss)?.[1] ?? "";

const NAMES = NAMED_COLORS.map((color) => color.name);

function getRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getContrastRatio(color1: string, color2: string): number {
  const lum1 = getRelativeLuminance(color1);
  const lum2 = getRelativeLuminance(color2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

function declaration(block: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1].trim();
}

describe("globals.css block structure", () => {
  it("declares exactly one top-level :root and one .dark block", () => {
    // The single-block invariant the `[^}]+` contrast regexes in button.test.tsx depend on.
    expect(globalsCss.match(/^:root \{/gm)).toHaveLength(1);
    expect(globalsCss.match(/^\.dark \{/gm)).toHaveLength(1);
    expect(globalsCss.match(/^@theme inline \{/gm)).toHaveLength(1);
  });
});

describe("named color tokens", () => {
  it("covers the whole palette", () => {
    expect(NAMES).toHaveLength(25);
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  it.each(NAMES)("light mode declares --%s and its -foreground pair at AA contrast", (name) => {
    const color = declaration(rootBlock, name);
    const foreground = declaration(rootBlock, `${name}-foreground`);

    expect(color).toBeDefined();
    expect(foreground).toBeDefined();
    expect(getContrastRatio(color!, foreground!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NAMES)("dark mode declares --%s and its -foreground pair at AA contrast", (name) => {
    const color = declaration(darkBlock, name);
    const foreground = declaration(darkBlock, `${name}-foreground`);

    expect(color).toBeDefined();
    expect(foreground).toBeDefined();
    expect(getContrastRatio(color!, foreground!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NAMES)("@theme inline aliases --color-%s and its -foreground pair", (name) => {
    expect(themeBlock).toContain(`--color-${name}: var(--${name});`);
    expect(themeBlock).toContain(`--color-${name}-foreground: var(--${name}-foreground);`);
  });
});

describe("remaining framework tokens", () => {
  it.each([
    "badge-tint-bg-light",
    "badge-tint-fg-light",
    "badge-tint-bg-dark",
    "badge-tint-fg-dark",
  ])(":root declares --%s", (name) => {
    expect(declaration(rootBlock, name)).toBeDefined();
  });

  it("defines the .badge-tinted utility for both modes", () => {
    expect(globalsCss).toMatch(
      /\.badge-tinted\s*\{[^}]*background-color:\s*var\(--badge-tint-bg-light\);/s,
    );
    expect(globalsCss).toMatch(
      /\.dark \.badge-tinted\s*\{[^}]*background-color:\s*var\(--badge-tint-bg-dark\);/s,
    );
  });

  it.each(["text-body", "text-large-body", "text-large-label", "text-small-label"])(
    "@theme inline declares --%s",
    (name) => {
      expect(declaration(themeBlock, name)).toBeDefined();
    },
  );

  it("declares a concrete --tracking-normal base plus the derived tracking scale", () => {
    expect(declaration(rootBlock, "tracking-normal")).toBe("0em");
    for (const [name, delta] of [
      ["tracking-tighter", "- 0.05em"],
      ["tracking-tight", "- 0.025em"],
      ["tracking-wide", "+ 0.025em"],
      ["tracking-wider", "+ 0.05em"],
      ["tracking-widest", "+ 0.1em"],
    ]) {
      expect(declaration(themeBlock, name)).toBe(`calc(var(--tracking-normal) ${delta})`);
    }
  });

  const shadows = [
    "shadow-2xs",
    "shadow-xs",
    "shadow-sm",
    "shadow",
    "shadow-md",
    "shadow-lg",
    "shadow-xl",
    "shadow-2xl",
  ];

  it.each(shadows)("declares --%s in both modes and aliases it", (name) => {
    expect(declaration(rootBlock, name)).toBeDefined();
    expect(declaration(darkBlock, name)).toBe("none");
    expect(themeBlock).toContain(`--${name}: var(--${name});`);
  });

  it("keeps the existing component shadow tokens pointing at their own values", () => {
    expect(declaration(rootBlock, "shadow-boxes")).toBe("0 1px 3px 0 rgb(0 0 0 / 0.1)");
    expect(declaration(rootBlock, "shadow-fields")).toBe("0 1px 2px 0 rgb(0 0 0 / 0.05)");
    expect(declaration(rootBlock, "shadow-selectors")).toBe("0 1px 2px 0 rgb(0 0 0 / 0.05)");
  });

  it("declares --font-serif and aliases it as a font family", () => {
    expect(declaration(rootBlock, "font-serif")).toBe('"Geist Variable", "Geist", serif');
    expect(themeBlock).toContain("--font-family-serif: var(--font-serif);");
  });

  it("declares --spacing and per-mode --toolbox", () => {
    expect(declaration(rootBlock, "spacing")).toBe("0.27rem");
    expect(declaration(rootBlock, "toolbox")).toBe("#38363a");
    expect(declaration(darkBlock, "toolbox")).toBe("#edeaf1");
  });

  it("declares the indeterminate animation, its keyframes, and a reduced-motion guard", () => {
    expect(declaration(themeBlock, "animate-indeterminate")).toBe(
      "indeterminate 1.5s ease-in-out infinite",
    );
    expect(globalsCss).toMatch(/@keyframes indeterminate\s*\{/);
    expect(globalsCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.animate-indeterminate\s*\{[^}]*animation:\s*none;/s,
    );
  });
});
