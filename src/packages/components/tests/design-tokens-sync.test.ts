import { describe, expect, it } from "vite-plus/test";
import {
  ACCESSIBILITY_OVERRIDES,
  managedTokenNames,
  readDesignSystemTokens,
  readTokensCss,
  syncManagedRegions,
  type ThemeMode,
} from "../scripts/design-tokens.ts";

// `tokens.css` used to hand-roll the semantic palette, and 19 of these 25 tokens had drifted away from
// the brand values the C# app renders (`--primary` was `#18181b` rather than Ivy green `#00cc92`). The
// generated region removes the drift; this suite is what stops it coming back silently.

/** Same relative-luminance maths as `design-tokens.test.ts` and `button.test.tsx`. */
function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const MODES: ThemeMode[] = ["light", "dark"];

describe("design system token sync", () => {
  it("tokens.css is up to date with the installed design system", () => {
    // Fails when the package is bumped without regenerating, or when someone edits a generated value by
    // hand. Fix by running `pnpm sync:tokens`.
    const css = readTokensCss();
    expect(syncManagedRegions(css)).toBe(css);
  });

  it("owns the full semantic palette", () => {
    expect(managedTokenNames()).toHaveLength(25);
  });

  it.each(MODES)("%s declares every managed token exactly once", (mode) => {
    const css = readTokensCss();
    const block = new RegExp(`^${mode === "light" ? ":root" : "\\.dark"} \\{([^}]+)\\}`, "m").exec(css);
    expect(block).not.toBeNull();

    for (const name of managedTokenNames()) {
      const declarations = block![1].match(new RegExp(`^\\s*--${name}:`, "gm")) ?? [];
      expect(declarations, `--${name} in ${mode}`).toHaveLength(1);
    }
  });

  it.each(MODES)("%s carries the design system's values", (mode) => {
    const css = readTokensCss();
    const block = new RegExp(`^${mode === "light" ? ":root" : "\\.dark"} \\{([^}]+)\\}`, "m").exec(css);

    for (const [name, value] of readDesignSystemTokens(mode)) {
      const declared = new RegExp(`--${name}:\\s*([^;]+);`).exec(block![1])?.[1].trim();
      expect(declared, `--${name} in ${mode}`).toBe(value);
    }
  });

  it.each(MODES)("%s accessibility overrides are still needed and sufficient", (mode) => {
    // An override only exists to rescue a pair the design system ships below AA. If a package bump fixes
    // the pair upstream, this fails so the override can be dropped rather than quietly outliving it.
    const tokens = readDesignSystemTokens(mode);

    for (const [name, override] of Object.entries(ACCESSIBILITY_OVERRIDES[mode])) {
      const base = name.replace(/-foreground$/, "");
      const baseValue = tokens.get(base);
      expect(baseValue, `--${base} in ${mode}`).toBeDefined();

      expect(contrastRatio(baseValue!, override)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
