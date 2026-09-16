import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "plan-markdown.css");
const css = readFileSync(cssPath, "utf-8");

/**
 * The rendered plan's corner insets.
 *
 * V1 sets `padding: 0 0 1rem 1.5rem` on `.pmv-markdown` and relies on the first heading's own
 * `margin-top: 2rem` to stand in for a top inset — so V1's content sits 32px from the top against
 * 24px from the left, and the corner reads lopsided. V2 diverges deliberately: the top is padded to
 * match the left, and the first child's margin is zeroed so it does not stack back on top.
 *
 * This is asserted in CSS rather than by rendering because jsdom computes no layout, so a render test
 * could not see the difference. The two rules are only correct *together* — padding the top while
 * leaving the first margin in place would double the gap to 48px, which is worse than the original.
 */
function layoutBlock(source: string): string {
  // The first `.pmv-markdown` rule is the layout one (max-width and insets); a later rule of the
  // same name carries typography. Anchoring on `max-width` picks the right one either way.
  const start = source.indexOf(".pmv-markdown {");
  const end = source.indexOf("}", start);
  // Comments are stripped first: this block's own comment quotes V1's `padding: 0 0 1rem 1.5rem`,
  // and a naive `padding:` match reads that instead of the declaration.
  const block = source.slice(start, end + 1).replace(/\/\*[\s\S]*?\*\//g, "");
  if (!source.slice(start, end + 1).includes("max-width")) {
    throw new Error("anchored on the wrong .pmv-markdown rule — expected the layout block");
  }
  return block;
}

describe("plan-markdown.css content insets", () => {
  it("pads the top by the same 1.5rem it pads the left", () => {
    const block = layoutBlock(css);
    const padding = /padding:\s*([^;]+);/.exec(block)?.[1]?.trim();

    expect(padding, "the layout block must declare padding").toBeDefined();

    const [top, , , left] = padding!.split(/\s+/);
    expect(top).toBe("1.5rem");
    expect(left).toBe("1.5rem");
    expect(top, "the top inset must equal the left inset").toBe(left);
  });

  it("zeroes the first block's top margin so it does not stack on that padding", () => {
    expect(css).toMatch(/\.pmv-markdown\s*>\s*:first-child\s*\{[^}]*margin-top:\s*0/);
  });

  it("still gives later headings their own top margin, which is the section rhythm", () => {
    // The reset is scoped to `:first-child` precisely so this survives. An `h1 { margin-top: 0 }`
    // would flatten every section break in the document, not just the first one.
    expect(css).toMatch(/\.pmv-markdown h1 \{[^}]*margin:\s*2rem/);
  });
});
