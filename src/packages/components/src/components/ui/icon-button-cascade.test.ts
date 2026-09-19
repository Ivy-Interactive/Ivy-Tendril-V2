import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

/**
 * `.tui-icon-btn` declares the properties a call site most often needs to change - `position`,
 * `opacity`, `color`, `border-radius`. A single-class hook like `.tsh-section-item-menu-btn`
 * ties it on specificity (0,1,0), so whichever is emitted last wins, and `ui.css` is emitted
 * last. Unlayered, the base therefore silently reverted twelve per-site hooks at once: the
 * sidebar row menu lost `position: absolute` and dropped onto its own line, the code block's
 * copy button lost `opacity: 0` and stopped hiding, and `className="absolute"` on an overlay
 * button did nothing.
 *
 * Keeping the base in `@layer components` fixes the whole class of bug: a layered rule loses to
 * every unlayered rule and to `@layer utilities` regardless of order, so call sites and Tailwind
 * utilities both win without `!important` or a specificity ladder. jsdom implements no cascade
 * layers, so this asserts the emitted structure rather than computed styles.
 */
describe("icon button cascade", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist", "style.css"),
    "utf8",
  );

  /** The [start, end) span of each top-level `@layer <name> { ... }` block. */
  const layerSpans = (): Array<{ name: string; start: number; end: number }> => {
    const spans: Array<{ name: string; start: number; end: number }> = [];
    for (const match of css.matchAll(/@layer\s+([a-z]+)\s*\{/g)) {
      let i = match.index + match[0].length - 1;
      let depth = 0;
      while (i < css.length) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) break;
        i++;
      }
      spans.push({ name: match[1] as string, start: match.index, end: i });
    }
    return spans;
  };

  const layerOf = (index: number): string | undefined =>
    layerSpans().find((s) => index > s.start && index < s.end)?.name;

  it("emits the .tui-icon-btn base inside @layer components", () => {
    const base = css.search(/\.tui-icon-btn\s*\{/);
    expect(base, ".tui-icon-btn base rule is missing from the bundle").toBeGreaterThan(-1);
    expect(layerOf(base)).toBe("components");
  });

  // Every one of these lost a declaration to the unlayered base. They must stay unlayered so
  // they keep outranking it.
  it.each([
    ".tsh-section-item-menu-btn",
    ".tsh-header-toggle",
    ".tsh-tab-close",
    ".tsh-tab-new",
    ".pmv-code-copy",
    ".pmv-img-overlay-close",
    ".civ-thumbnail-card-remove",
    ".civ-error-close",
  ])("keeps the %s override outside any layer, so it outranks the base", (selector) => {
    const index = css.search(new RegExp(`\\${selector}\\s*\\{`));
    expect(index, `${selector} is missing from the bundle`).toBeGreaterThan(-1);
    expect(layerOf(index)).toBeUndefined();
  });
});
