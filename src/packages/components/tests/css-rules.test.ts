import { describe, expect, it } from "vite-plus/test";
import { isDarkSelector, isRootSelector, parseCssRules } from "./css-rules.ts";

describe("isRootSelector / isDarkSelector", () => {
  it("catches :root, :host and html, alone or compounded with other simple selectors", () => {
    for (const selector of [":root", ":host", "html", ":root:not([data-x])", "html.foo"]) {
      expect(isRootSelector(selector)).toBe(true);
    }
  });

  it("catches :root, .light as two selectors, only the first of which is root-level", () => {
    const selectors = ":root, .light".split(",").map((s) => s.trim());
    expect(selectors.map(isRootSelector)).toEqual([true, false]);
  });

  it("does not treat a non-root component selector as root-level", () => {
    expect(isRootSelector(".civ-thumbnail-card-remove")).toBe(false);
    expect(isRootSelector(".svl-root")).toBe(false);
  });

  it("treats :root:not(.dark) as root-level, not as a dark redeclaration", () => {
    expect(isRootSelector(":root:not(.dark)")).toBe(true);
    expect(isDarkSelector(":root:not(.dark)")).toBe(false);
  });

  it("recognises a compound .dark redeclaration and excludes it from root-level", () => {
    for (const selector of [".dark", ".dark .foo", ":root.dark", "html.dark"]) {
      expect(isDarkSelector(selector)).toBe(true);
      expect(isRootSelector(selector)).toBe(false);
    }
  });

  it("recognises .dark inside :is()/:where() as a real dark redeclaration", () => {
    expect(isDarkSelector(':is(.dark, [data-theme="dark"]) .aov-shell')).toBe(true);
  });
});

describe("parseCssRules", () => {
  it("parses a root compound selector's declarations", () => {
    const rules = parseCssRules(":root { --x: var(--background); }");
    expect(rules).toEqual([
      { selectors: [":root"], declarations: new Map([["--x", "var(--background)"]]) },
    ]);
  });

  it("parses a @theme block as a synthetic :root rule", () => {
    const rules = parseCssRules("@theme { --color-x: var(--background); }");
    expect(rules).toEqual([
      {
        selectors: [":root"],
        declarations: new Map([["--color-x", "var(--background)"]]),
        isTailwindTheme: true,
      },
    ]);
  });

  it("skips @theme inline entirely -- Tailwind inlines the value, it never emits a :root property", () => {
    const rules = parseCssRules("@theme inline { --color-x: var(--background); }");
    expect(rules).toEqual([]);
  });

  it("expands a nested rule's & against its parent selector", () => {
    const rules = parseCssRules(".card { color: red; &:hover { --a: var(--background); } }");
    const nested = rules.find((rule) => rule.selectors.includes(".card:hover"));
    expect(nested?.declarations.get("--a")).toBe("var(--background)");
  });

  it("exempts a non-root component selector even when it declares a themed-looking token", () => {
    const rules = parseCssRules(".widget-root { --w: var(--background); }");
    expect(rules).toEqual([
      { selectors: [".widget-root"], declarations: new Map([["--w", "var(--background)"]]) },
    ]);
  });

  it("recognises a compound .dark redeclaration alongside its un-prefixed rule", () => {
    const rules = parseCssRules(
      ".tsh-root { --tsh-bg: var(--card); } .dark .tsh-root { --tsh-bg: var(--background); }",
    );
    expect(rules).toHaveLength(2);
    expect(rules[0].selectors).toEqual([".tsh-root"]);
    expect(rules[1].selectors).toEqual([".dark .tsh-root"]);
    expect(rules[1].declarations.get("--tsh-bg")).toBe("var(--background)");
  });

  it("descends into @media/@layer/@supports/@container without altering the selector", () => {
    const rules = parseCssRules("@media (min-width: 1px) { :root { --a: var(--background); } }");
    expect(rules).toEqual([
      { selectors: [":root"], declarations: new Map([["--a", "var(--background)"]]) },
    ]);
  });

  it("skips @keyframes bodies entirely", () => {
    const rules = parseCssRules("@keyframes spin { from { --a: 0; } to { --a: 1; } }");
    expect(rules).toEqual([]);
  });

  it("ignores braces inside comments and quoted strings", () => {
    const rules = parseCssRules(
      `/* a { fake: "brace"; } */ .real { content: "{ not a rule }"; --a: var(--background); }`,
    );
    expect(rules).toEqual([
      {
        selectors: [".real"],
        declarations: new Map([["--a", "var(--background)"]]),
      },
    ]);
  });
});
