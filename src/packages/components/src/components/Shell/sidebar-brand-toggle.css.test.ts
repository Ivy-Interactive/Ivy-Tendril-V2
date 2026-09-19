import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "shell.css");
const css = readFileSync(cssPath, "utf-8");

/**
 * The header's single collapse control.
 *
 * `ShellSidebarHeader` renders two buttons on one row, which is V1's `SidebarHeader` shape: the
 * brand mark on the left and the close button on the right. Collapsed, the rail clips the close
 * button away and the brand slot becomes the expand control - hovering fades the logo out and
 * paints `PanelLeftOpen` in its place. Expanded, the close button owns the toggle and the brand
 * slot must stay a brand mark, or the header shows two collapse controls and the one on the left
 * does nothing when clicked.
 *
 * This has regressed before, because "the left one is invisible" was true for a reason that lived
 * in a different rule: `.tsh-root:not([data-collapsed="true"]) .tsh-logo-toggle` sets
 * `pointer-events: none`, so expanded the button never matched `:hover` and the paint rules below
 * never fired. Nothing said so. Forcing `:hover` on the expanded header in Chromium against the
 * shipped stylesheet took `.tsh-header-logo` to opacity 0 and `.tsh-logo-toggle-icon` to opacity 1,
 * so the second toggle was one hit-testing change away the whole time - a focus ring, a tooltip
 * trigger or a call site that wants the brand clickable would each have brought it back.
 *
 * So the invariant is asserted on the selectors themselves, not on the rendered result: every rule
 * that paints this slot as a control has to name the rail. Asserted in CSS because jsdom computes
 * no cascade for an imported stylesheet, so a render test cannot see which rules would win.
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

/** The rail gate, in either of the forms the file writes it. */
const GATED = /\.tsh-root\[data-collapsed="true"\]/;

describe("shell.css brand toggle", () => {
  it("gates every hover rule on the brand slot to the collapsed rail", () => {
    const hovers = rules(css).filter((rule) => /\.tsh-logo-toggle:hover/.test(rule.selector));

    // If this is empty the selectors were renamed and this test stopped pinning anything.
    expect(hovers.length).toBeGreaterThan(0);

    for (const rule of hovers) {
      expect(
        rule.selector,
        `\`${rule.selector}\` fires in the expanded header, where the brand mark is not a control`,
      ).toMatch(GATED);
    }
  });

  it("gates every rule that paints the panel icon in the brand slot", () => {
    const painters = rules(css).filter(
      (rule) => /\.tsh-logo-toggle-icon/.test(rule.selector) && /opacity:\s*1\b/.test(rule.body),
    );

    expect(painters.length).toBeGreaterThan(0);

    for (const rule of painters) {
      expect(
        rule.selector,
        `\`${rule.selector}\` reveals a second collapse control when the sidebar is expanded`,
      ).toMatch(GATED);
    }
  });

  it("keeps the icon hidden by default, so a missed gate cannot fail open", () => {
    const base = rules(css).find((rule) => rule.selector === ".tsh-logo-toggle-icon");
    expect(base, "`.tsh-logo-toggle-icon` must declare its own resting state").toBeDefined();
    expect(base!.body).toMatch(/opacity:\s*0\s*;/);
  });

  it("still lets the rail's brand slot act as the expand control", () => {
    // The other half of the invariant: over-gating would leave the rail with no visible way to
    // expand, which is the same header bug pointing the other way.
    const collapsedPainters = rules(css).filter(
      (rule) =>
        GATED.test(rule.selector) &&
        /\.tsh-logo-toggle/.test(rule.selector) &&
        /opacity:\s*1\b/.test(rule.body),
    );
    expect(collapsedPainters.length).toBeGreaterThan(0);
  });

  it("does not leave hit testing as the only thing hiding the expanded control", () => {
    // `pointer-events: none` stays - it keeps the expanded brand mark from swallowing clicks - but
    // it is now belt and braces rather than the load-bearing rule.
    const inert = rules(css).find(
      (rule) => rule.selector === '.tsh-root:not([data-collapsed="true"]) .tsh-logo-toggle',
    );
    expect(inert?.body).toMatch(/pointer-events:\s*none/);
  });
});
