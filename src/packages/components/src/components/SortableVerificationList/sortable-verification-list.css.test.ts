import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "sortable-verification-list.css"), "utf-8");
const tokens = readFileSync(join(here, "..", "..", "styles", "tokens.css"), "utf-8");

/** The declaration block of a top-level rule, with comments stripped so a quoted value cannot match. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no \`${selector}\` rule in sortable-verification-list.css`);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1).replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The verification list's type ramp.
 *
 * The two spans on a row are siblings, and only one of them used to be sized: `.svl-required`
 * declared `font-size`, `.svl-name` declared none. Nothing between `<body>` and the widget sets a
 * font size in V2 — `globals.css` sets only `background-color`, `color` and `font-family` on `body`,
 * and no ancestor of the widget carries a `text-*` utility — so the name fell through to the UA's
 * 16px default and rendered visibly larger than the "Required" label next to it.
 *
 * V1 never hit this: `SortableVerificationList` is an external widget rendered inside the Ivy
 * framework's chrome, whose `--text-body: 14px` (Ivy-Framework `src/frontend/src/index.css`) is
 * applied as `.text-body` by the widgets around it, so the name inherited 14px. V1's own copy of
 * this stylesheet (Ivy-Tendril `src/Ivy.Tendril.Widgets/frontend/src/SortableVerificationList/
 * sortable-verification-list.css`) has no `.svl-name` font-size either, and hard-codes `0.875rem`
 * on `.svl-required` — the same 14px, which is what `--text-sm` resolves to here.
 *
 * Asserted against the stylesheet rather than a render because jsdom resolves no custom properties
 * and computes no cascade for them: `getComputedStyle(...).fontSize` on the name returns the literal
 * string `var(--text-sm)` when the rule is present and `medium` when it is not, so a render test
 * would be pinning jsdom's non-resolution rather than the ramp.
 */
describe("sortable-verification-list.css type ramp", () => {
  it("sizes the verification name, which would otherwise inherit the UA default", () => {
    expect(block(".svl-name")).toMatch(/font-size:\s*var\(--text-sm\);/);
  });

  it("sizes the name and the Required label on a row identically", () => {
    const nameSize = /font-size:\s*(var\(--[a-z-]+\)|[\d.]+\w+);/.exec(block(".svl-name"))?.[1];
    const requiredSize = /font-size:\s*(var\(--[a-z-]+\)|[\d.]+\w+);/.exec(
      block(".svl-required"),
    )?.[1];
    expect(nameSize).toBeDefined();
    expect(nameSize).toBe(requiredSize);
  });

  it("spends a type-scale token rather than a literal, and one that tokens.css defines", () => {
    expect(block(".svl-name")).not.toMatch(/font-size:\s*[\d.]/);
    // 0.875rem == 14px, the value V1 hard-codes on `.svl-required`.
    expect(tokens).toMatch(/--text-sm:\s*0\.875rem;/);
  });
});
