import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { Button } from "../src/components/ui/button";
import { readDesignSystemTokens } from "../scripts/design-tokens.ts";
import { readCssInlined } from "./read-css.ts";

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

describe("Button component", () => {
  it("renders with children and fires click events", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click Me</Button>);
    const btn = screen.getByRole("button", { name: "Click Me" });
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("prevents click when disabled", () => {
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Disabled" });
    expect(btn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("applies variant and size classes", () => {
    const { container } = render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>,
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("bg-destructive");
    expect(btn?.className).toContain("text-destructive-foreground");
  });
});

const ENTRY_POINTS: readonly (readonly [string, string])[] = [
  ["globals.css", resolve(__dirname, "..", "src/styles/globals.css")],
  ["index.css", resolve(__dirname, "..", "src/styles/index.css")],
];

/**
 * Both entry points import the same `tokens.css`, so they resolve every shared token to the same
 * value and the expectations below hold for either one. `readCssInlined` splices the imported blocks
 * back in, which is what keeps the `[^}]+` block regexes here working — `style-token-parity.test.ts`
 * asserts the single-block invariant they rely on.
 */
function block(path: string, selector: ":root" | ".dark"): string {
  const css = readCssInlined(path);
  const pattern = selector === ":root" ? /:root\s*\{([^}]+)\}/s : /\.dark\s*\{([^}]+)\}/s;
  return pattern.exec(css)?.[1] ?? "";
}

function token(css: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1].trim();
}

describe("Destructive theme contrast compliance (WCAG 2.1 AA)", () => {
  it.each(ENTRY_POINTS)(
    "%s light mode meets WCAG 2.1 AA contrast requirements (>= 4.5:1)",
    (_name, path) => {
      const rootBlock = block(path, ":root");
      const destructive = token(rootBlock, "destructive");
      const foreground = token(rootBlock, "destructive-foreground");

      expect(destructive).toBeDefined();
      expect(foreground).toBe("#000000");
      const contrast = getContrastRatio(destructive!, foreground!);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(ENTRY_POINTS)(
    "%s dark mode meets WCAG 2.1 AA contrast requirements (>= 4.5:1)",
    (_name, path) => {
      const darkBlock = block(path, ".dark");
      const destructive = token(darkBlock, "destructive");
      const foreground = token(darkBlock, "destructive-foreground");

      expect(destructive).toBeDefined();
      expect(foreground).toBeDefined();
      const contrast = getContrastRatio(destructive!, foreground!);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("Semantic theme contrast compliance (WCAG 2.1 AA)", () => {
  // The palette is generated from @ivy-interactive/ivy-design-system (see scripts/design-tokens.ts), the
  // same source the C# app renders from. It picks each foreground from that colour's own luminance rather
  // than from the mode: light `--info` (#4469c0) is dark enough to need white text, while dark `--success`
  // and `--warning` are light enough to need black. So the invariants worth enforcing are the contrast
  // ratio and agreement with that source of truth, not a per-mode literal.
  const cases = ENTRY_POINTS.flatMap(([name, path]) =>
    ["info", "success", "warning"].map((semantic) => [name, semantic, path] as const),
  );

  it.each(cases)(
    "%s light mode --%s-foreground matches the design system and meets AA contrast (>= 4.5:1)",
    (_name, semantic, path) => {
      const rootBlock = block(path, ":root");
      const background = token(rootBlock, semantic);
      const foreground = token(rootBlock, `${semantic}-foreground`);

      expect(background).toBeDefined();
      expect(foreground).toBe(readDesignSystemTokens("light").get(`${semantic}-foreground`));
      const contrast = getContrastRatio(background!, foreground!);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(cases)(
    "%s dark mode --%s-foreground matches the design system and meets AA contrast (>= 4.5:1)",
    (_name, semantic, path) => {
      const darkBlock = block(path, ".dark");
      const background = token(darkBlock, semantic);
      const foreground = token(darkBlock, `${semantic}-foreground`);

      expect(background).toBeDefined();
      expect(foreground).toBe(readDesignSystemTokens("dark").get(`${semantic}-foreground`));
      const contrast = getContrastRatio(background!, foreground!);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    },
  );
});
