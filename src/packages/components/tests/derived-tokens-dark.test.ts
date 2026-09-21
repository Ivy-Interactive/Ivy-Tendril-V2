import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
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

interface Rule {
  /** Each comma-separated selector in the rule's prelude, trimmed individually. */
  selectors: string[];
  declarations: Map<string, string>;
}

/**
 * Flattens a stylesheet into its style rules, selector list plus custom-property declarations,
 * ignoring at-rule nesting (`@layer`, `@media`, ...) -- a rule's own selector and body are the same
 * whichever block wraps it. `@keyframes` steps (`from`, `to`, `50%`) are skipped: they are not
 * selectors and never carry a themed custom property.
 */
function parseRules(source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let depth = 0;
  let preludeStart = 0;
  let atRuleDepth: number | null = null;

  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === "{") {
      const prelude = css.slice(preludeStart, i).trim();
      if (prelude.startsWith("@")) {
        // An at-rule block (`@layer`, `@media`, `@keyframes`, ...): its own braces just nest
        // further, and its prelude is never a style-rule selector.
        if (atRuleDepth === null && /^@keyframes\b/.test(prelude)) {
          atRuleDepth = depth;
        }
      } else if (prelude.length > 0 && (atRuleDepth === null || !isKeyframeStep(prelude))) {
        const end = matchingBrace(css, i);
        const body = css.slice(i + 1, end);
        rules.push({
          selectors: prelude.split(",").map((selector) => selector.trim()),
          declarations: declarationsOf(body),
        });
      }
      depth++;
      preludeStart = i + 1;
    } else if (char === "}") {
      depth--;
      if (atRuleDepth !== null && depth < atRuleDepth) atRuleDepth = null;
      preludeStart = i + 1;
    }
  }

  return rules;
}

function isKeyframeStep(prelude: string): boolean {
  return /^(from|to|\d+(\.\d+)?%)$/.test(prelude);
}

function matchingBrace(css: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

function declarationsOf(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    result.set(match[1], match[2]);
  }
  return result;
}

const ROOT_SELECTOR = ":root";
const DARK_SELECTOR = ".dark";

/** Every `:root`, `.dark` and `.dark`-companion declaration across the whole package, keyed by file. */
function collectByFile(files: readonly string[]): Map<string, Rule[]> {
  const byFile = new Map<string, Rule[]>();
  for (const file of files) byFile.set(file, parseRules(readCssRaw(file)));
  return byFile;
}

function rootDeclarationsOf(rules: readonly Rule[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(ROOT_SELECTOR)) continue;
    for (const [name, value] of rule.declarations) result.set(name, value);
  }
  return result;
}

function darkDeclarationsOf(rules: readonly Rule[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(DARK_SELECTOR)) continue;
    for (const [name, value] of rule.declarations) result.set(name, value);
  }
  return result;
}

describe("derived tokens follow the theme", () => {
  const files = cssFiles(SRC_ROOT).sort();
  const rulesByFile = collectByFile(files);

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

    /**
     * A `:root` custom property is fixed to the document root and inherits its resolved value
     * straight down -- including into a `.dark`-wrapped subtree that is not itself `<html>`. The
     * `var()` it embeds is resolved once, against `:root`'s own cascade, not recomputed per
     * descendant, so it goes stale in that subtree unless re-declared under `.dark`. A property
     * declared on any other selector is evaluated fresh at each matching element, so one already
     * inside `.dark` picks up that element's themed values with no re-declaration needed -- that
     * is why this walk only ever looks at `:root` declarations.
     */
    const dependsOnThemed = (value: string, seen = new Set<string>()): boolean =>
      [...value.matchAll(/var\((--[\w-]+)/g)].some(([, name]) => {
        if (seen.has(name)) return false;
        seen.add(name);
        return dark.has(name) || dependsOnThemed(rootFallback.get(name) ?? "", seen);
      });

    it(`${relativePath}: re-declares every :root token that references a themed token inside .dark`, () => {
      const missing = [...root]
        .filter(([name, value]) => !dark.has(name) && dependsOnThemed(value))
        .map(([name]) => name);
      expect(missing).toEqual([]);
    });
  }
});
