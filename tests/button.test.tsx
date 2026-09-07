import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { Button } from "../src/components/ui/button";

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

describe("Destructive theme contrast compliance (WCAG 2.1 AA)", () => {
  const rootDir = resolve(__dirname, "..");
  const globalsCssPath = resolve(rootDir, "src/styles/globals.css");
  const indexCssPath = resolve(rootDir, "src/styles/index.css");

  it("globals.css light mode meets WCAG 2.1 AA contrast requirements (>= 4.5:1)", () => {
    const globalsCss = readFileSync(globalsCssPath, "utf-8");
    const rootBlock = /:root\s*\{([^}]+)\}/s.exec(globalsCss)?.[1] ?? "";
    const destructive = /--destructive:\s*([^;]+);/.exec(rootBlock)?.[1].trim();
    const foreground = /--destructive-foreground:\s*([^;]+);/.exec(rootBlock)?.[1].trim();

    expect(destructive).toBeDefined();
    expect(foreground).toBe("#000000");
    const contrast = getContrastRatio(destructive!, foreground!);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it("globals.css dark mode meets WCAG 2.1 AA contrast requirements (>= 4.5:1)", () => {
    const globalsCss = readFileSync(globalsCssPath, "utf-8");
    const darkBlock = /\.dark\s*\{([^}]+)\}/s.exec(globalsCss)?.[1] ?? "";
    const destructive = /--destructive:\s*([^;]+);/.exec(darkBlock)?.[1].trim();
    const foreground = /--destructive-foreground:\s*([^;]+);/.exec(darkBlock)?.[1].trim();

    expect(destructive).toBeDefined();
    expect(foreground).toBeDefined();
    const contrast = getContrastRatio(destructive!, foreground!);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it("index.css light mode meets WCAG 2.1 AA contrast requirements (>= 4.5:1)", () => {
    const indexCss = readFileSync(indexCssPath, "utf-8");
    const rootBlock = /:root\s*\{([^}]+)\}/s.exec(indexCss)?.[1] ?? "";
    const destructive = /--destructive:\s*([^;]+);/.exec(rootBlock)?.[1].trim();
    const foreground = /--destructive-foreground:\s*([^;]+);/.exec(rootBlock)?.[1].trim();

    expect(destructive).toBeDefined();
    expect(foreground).toBe("#000000");
    const contrast = getContrastRatio(destructive!, foreground!);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it("index.css dark mode meets WCAG 2.1 AA contrast requirements (>= 4.5:1)", () => {
    const indexCss = readFileSync(indexCssPath, "utf-8");
    const darkBlock = /\.dark\s*\{([^}]+)\}/s.exec(indexCss)?.[1] ?? "";
    const destructive = /--destructive:\s*([^;]+);/.exec(darkBlock)?.[1].trim();
    const foreground = /--destructive-foreground:\s*([^;]+);/.exec(darkBlock)?.[1].trim();

    expect(destructive).toBeDefined();
    expect(foreground).toBe("#000000");
    const contrast = getContrastRatio(destructive!, foreground!);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
});
