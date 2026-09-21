import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { readCssInlined } from "./read-css";

/**
 * Regression net for the shared pointer-cursor rule in `styles/base.css`.
 *
 * Tailwind v3's preflight shipped `button, [role="button"] { cursor: pointer }`; v4's preflight
 * dropped every cursor declaration, so on the upgrade every `<button>` that did not re-declare
 * `cursor-pointer` itself silently fell back to `cursor: auto`. `base.css` restores it. Nothing else
 * in this suite reads `base.css`, so without this file a future "cleanup" of an apparently redundant
 * rule would reintroduce the bug with a green test run.
 *
 * The layer assertion is the one that matters most. jsdom resolves no cascade at all -- it only ever
 * sees class strings -- so `SidebarListRow.test.tsx` and `SidebarAffordance.test.tsx` would both stay
 * green if this rule were written unlayered, even though unlayered it would outrank and break every
 * deliberate non-pointer in the repo: `SidebarListRow`'s `cursor-default` sub-item, `SidebarRail`'s
 * resize cursors, `WebViewer`'s `cursor: text` address bar, the drag handle's `cursor: grab`. The
 * only honest witness for that is the stylesheet text itself, which is what this reads.
 *
 * Modelled on `focus-visible-audit.test.ts`, which likewise asserts the shape of a CSS rule rather
 * than a rendered result.
 */
describe("base.css pointer-cursor rule", () => {
  const css = readCssInlined(resolve(__dirname, "..", "src/styles/base.css"));

  /** The `@layer base { ... }` block that contains the cursor declarations. */
  const cursorLayer = (): string => {
    const start = css.indexOf("@layer base {");
    expect(start).toBeGreaterThan(-1);
    // Brace-match rather than regex: the block contains nested `{}` from its rule bodies.
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) return css.slice(start, i + 1);
      }
    }
    throw new Error("unterminated @layer base block");
  };

  /** The stylesheet with `/* *\/` comments stripped, so prose about `cursor: auto` is not counted
   * as a declaration. The header comment names several cursor values it does not set. */
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

  test("declares the cursor rule inside @layer base, never unlayered", () => {
    const block = cursorLayer();
    expect(block).toContain("cursor: pointer");
    // Every real `cursor:` declaration in the file must live inside that layer. An unlayered copy
    // would beat the `cursor-*` utilities in @layer utilities and invert every deliberate override.
    const totalCursorDecls = code.match(/cursor:\s*[a-z-]+/g) ?? [];
    const layeredCursorDecls =
      cursorLayer()
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .match(/cursor:\s*[a-z-]+/g) ?? [];
    expect(totalCursorDecls.length).toBe(2);
    expect(layeredCursorDecls.length).toBe(totalCursorDecls.length);
  });

  test("never uses !important, which would beat the cursor-* utilities too", () => {
    expect(cursorLayer()).not.toContain("!important");
  });

  test('covers button and [role="button"], what v3\'s preflight covered', () => {
    const block = cursorLayer();
    expect(block).toContain("button:not(:disabled)");
    expect(block).toContain('[role="button"]');
  });

  test("covers the roles and native controls v3 missed", () => {
    const block = cursorLayer();
    for (const selector of [
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      "summary",
      "select:not(:disabled)",
      '[type="checkbox"]',
      '[type="radio"]',
      "label:has(",
    ]) {
      expect(block).toContain(selector);
    }
  });

  test("guards disabled controls so the pointer never promises a dead click", () => {
    const block = cursorLayer();
    expect(block).toContain(":not(:disabled)");
    expect(block).toContain(':not([aria-disabled="true"])');
    expect(block).toContain("cursor: not-allowed");
  });

  test('tolerates a literal data-disabled="false", which Radix convention allows', () => {
    // A bare `[data-disabled]` selector matches `data-disabled="false"` -- i.e. an ENABLED control --
    // and would show it `not-allowed`. The guard is insurance for the next Radix component added.
    expect(cursorLayer()).toContain('[data-disabled]:not([data-disabled="false"])');
    expect(cursorLayer()).not.toMatch(/\[data-disabled\](?!:not)/);
  });

  test("does not target a[href]; v4 preflight leaves the UA pointer on anchors", () => {
    expect(cursorLayer()).not.toContain("a[href]");
  });

  test("carries the comment explaining why the rule is not redundant", () => {
    // Without this the rule looks like something Tailwind already does, and gets deleted.
    const header = css.slice(0, css.indexOf("@layer base {"));
    expect(header).toMatch(/v3/);
    expect(header).toMatch(/v4/);
  });
});
