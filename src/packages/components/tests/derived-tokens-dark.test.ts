import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { type CssRule, isDarkSelector, isRootSelector, parseCssRules } from "./css-rules.ts";
import { readCssRaw } from "./read-css.ts";

const SRC_ROOT = resolve(__dirname, "..", "src");
const TOKENS_CSS = resolve(SRC_ROOT, "styles/tokens.css");

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      cssFiles(full, out);
      continue;
    }
    if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

function rootDeclarationsOf(rules: readonly CssRule[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.some(isRootSelector)) continue;
    for (const [name, value] of rule.declarations) result.set(name, value);
  }
  return result;
}

function darkDeclarationsOf(rules: readonly CssRule[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.some(isDarkSelector)) continue;
    for (const [name, value] of rule.declarations) result.set(name, value);
  }
  return result;
}

/**
 * Root-level scoping (`:root`, `:host`, `html`, a Tailwind v4 `@theme` block -- see
 * `css-rules.ts`) is what makes a derived custom property go stale under `.dark`: it is fixed to
 * the document root/host and inherits its resolved value straight down, including into a
 * `.dark`-wrapped subtree that is not itself that root element, so a `var()` it embeds is resolved
 * once against its own declaring scope, never recomputed per descendant. A property declared on any
 * other selector is evaluated fresh at each matching element, so one already inside `.dark` picks
 * up that element's themed values with no re-declaration needed -- verified in a browser: a
 * `:root`-declared derived token stayed on its light value inside a `.dark`-wrapped `<div>`, while
 * the same `var()` reference declared on a non-root selector resolved correctly there.
 *
 * This walks every CSS file under src/ and applies that rule to every root-level declaration found
 * in it, wherever it appears. Today two files have any root-level declarations at all: tokens.css
 * (`:root`/`.dark`) and index.css, whose `@theme { --color-scheme: light; }` is a real (non-inline)
 * Tailwind block -- it happens to hold no themed reference, so it passes without needing a `.dark`
 * companion. No other file in this package currently declares at `:root`/`:host`/`html` or inside a
 * non-inline `@theme`; the walk is package-wide so a future file that adds one is covered without
 * touching this test.
 */
describe("derived tokens follow the theme", () => {
  const files = cssFiles(SRC_ROOT).sort();
  const rulesByFile = new Map(files.map((file) => [file, parseCssRules(readCssRaw(file))]));

  // The theme itself lives in tokens.css's `.dark { ... }`: every token any file's derived value can
  // ultimately bottom out at. A file may also carry its own `.dark`-companion rule for a token it
  // declares locally (shell.css's `.dark .tsh-root, ...`), which extends this set for that file only.
  const globalDark = darkDeclarationsOf(rulesByFile.get(TOKENS_CSS) ?? []);
  const globalRoot = rootDeclarationsOf(rulesByFile.get(TOKENS_CSS) ?? []);

  for (const file of files) {
    const rules = rulesByFile.get(file) ?? [];
    const relativePath = file.slice(SRC_ROOT.length + 1);

    const root = file === TOKENS_CSS ? globalRoot : rootDeclarationsOf(rules);
    if (root.size === 0) continue;

    const dark = new Map([...globalDark, ...darkDeclarationsOf(rules)]);
    const rootFallback = file === TOKENS_CSS ? root : new Map([...globalRoot, ...root]);

    const dependsOnThemed = (value: string, seen = new Set<string>()): boolean =>
      [...value.matchAll(/var\((--[\w-]+)/g)].some(([, name]) => {
        if (seen.has(name)) return false;
        seen.add(name);
        return dark.has(name) || dependsOnThemed(rootFallback.get(name) ?? "", seen);
      });

    it(`${relativePath}: re-declares every root-level token that references a themed token inside .dark`, () => {
      const missing = [...root]
        .filter(([name, value]) => !dark.has(name) && dependsOnThemed(value))
        .map(([name]) => name);
      expect(missing).toEqual([]);
    });
  }
});
