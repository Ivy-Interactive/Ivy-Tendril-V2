import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "shell.css");
const css = readFileSync(cssPath, "utf-8");

/**
 * Where the sidebar's width chain may be declared.
 *
 * The dragged width is not a token: `TendrilShell` writes the live value as an inline
 * `--tsh-sidebar-width` on `.tsh-root` and on nothing else, and `--tsh-sidebar-content` and
 * `--tsh-row-content` derive from it. Inline styles win the cascade, so the chain reaches every
 * descendant by inheritance - unless some descendant declares `--tsh-sidebar-width` itself, in
 * which case its own 320px shadows the inherited inline value for that entire subtree and the
 * subtree stops tracking the drag.
 *
 * That is exactly what issue #207 was. `.tsh-section` shared the token ruleset with `.tsh-root`,
 * so it redeclared the 320px default; the Search button is the only sidebar control rendered
 * inside a `.tsh-section`, so its `.tsh-row` resolved `--tsh-row-content` to a fixed 280px while
 * every other row in the sidebar resized with the pointer. Nothing about the button was wrong -
 * the issue's own guess was a missing `w-full`, which would have changed nothing - and the bug is
 * invisible at the default width, which is where a screenshot test would look.
 *
 * The four other selectors in that group are there because they genuinely render out of
 * `.tsh-root`'s tree: `.tsh-rail-menu` and `.tsh-item-menu` are portaled to `<body>`,
 * `.tsh-rail-tooltip` rides the shared tooltip's portal, and `.tsh-section` is reused inside the
 * portaled plan search dialog. They must keep the colour tokens, which is why the split leaves
 * those behind rather than moving the whole ruleset. None of them consumes a width variable -
 * they size themselves (`min-width`, `max-width`, an inline `width` from the flyout's measuring
 * code), which is what makes the split safe.
 *
 * Asserted on the stylesheet text, like the brand-toggle test beside it: jsdom computes no cascade
 * for an imported stylesheet, so a render test cannot see which declaration would win.
 */

/** Declaration blocks with comments stripped - this file's own prose quotes the selectors it pins. */
function rules(source: string): { selector: string; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    out.push({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2] });
  }
  return out;
}

/** The chain the drag feeds: the inline property and the two derived from it. */
const WIDTH_VARS = ["--tsh-sidebar-width", "--tsh-sidebar-content", "--tsh-row-content"] as const;

/** The roots that render outside `.tsh-root`, so never inherit its inline width. */
const OUT_OF_TREE = [".tsh-section", ".tsh-rail-menu", ".tsh-item-menu", ".tsh-rail-tooltip"];

const declares = (body: string, name: string) => new RegExp(`(^|;)\\s*${name}\\s*:`).test(body);
const consumes = (body: string, name: string) => new RegExp(`var\\(\\s*${name}\\b`).test(body);

describe("shell.css sidebar width scoping", () => {
  for (const name of WIDTH_VARS) {
    it(`declares ${name} only on .tsh-root`, () => {
      const declarers = rules(css).filter((rule) => declares(rule.body, name));

      // If this is empty the variable was renamed and this test stopped pinning anything.
      expect(declarers.length, `no rule declares \`${name}\``).toBeGreaterThan(0);

      for (const rule of declarers) {
        expect(
          rule.selector,
          `\`${rule.selector}\` redeclares \`${name}\`, shadowing the inline width ` +
            `TendrilShell sets on .tsh-root, so that subtree freezes at the default while the ` +
            `user drags (#207)`,
        ).toBe(".tsh-root");
      }
    });
  }

  it("keeps the theme tokens on the roots that render out of tree", () => {
    // The other half of the split: over-narrowing it would leave the portaled popovers and the
    // search dialog's list unstyled, which is the same mistake pointing the other way.
    const shared = rules(css).find(
      (rule) => rule.selector.startsWith(".tsh-root,") && declares(rule.body, "--tsh-bg"),
    );

    expect(shared, "the shared token ruleset must still exist").toBeDefined();
    for (const selector of OUT_OF_TREE) {
      expect(shared!.selector, `\`${selector}\` lost the shell's theme tokens`).toContain(selector);
    }
    for (const name of ["--tsh-popover", "--tsh-row-active", "--tsh-badge-bg", "--tsh-row-gap"]) {
      expect(declares(shared!.body, name), `\`${name}\` left the shared ruleset`).toBe(true);
    }
  });

  it("never reads a width variable from a rule targeting an out-of-tree root", () => {
    // Those roots no longer declare the chain, so such a `var()` would resolve to nothing and the
    // declaration would drop out entirely - a silent `width: auto`, not a visible 280px.
    for (const rule of rules(css)) {
      const read = WIDTH_VARS.filter((name) => consumes(rule.body, name));
      if (read.length === 0) continue;
      for (const selector of OUT_OF_TREE) {
        expect(
          rule.selector.includes(selector) && !rule.selector.includes(".tsh-root"),
          `\`${rule.selector}\` reads ${read.join(", ")} but ${selector} renders outside ` +
            `.tsh-root, where the chain is undefined`,
        ).toBe(false);
      }
    }
  });
});
