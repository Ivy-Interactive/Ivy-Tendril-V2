import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * `@import` statements that resolve through the bundler rather than the filesystem. `tailwindcss` is
 * the only one the package's stylesheets use, and inlining it is neither possible nor wanted — the
 * tests here assert on authored tokens, not on Tailwind's own preflight.
 */
function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

const IMPORT_RULE = /^[ \t]*@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;[ \t]*\r?\n?/gm;

/**
 * Reads a CSS file and recursively inlines its *relative* `@import` statements, so a test can read a
 * stylesheet as the single string it used to be before the shared token blocks moved into
 * `tokens.css`. Bare specifiers (`@import "tailwindcss"`) are left in place untouched.
 *
 * Inlined content is spliced in at the import's own position and keeps its original indentation, so
 * line-anchored assertions such as `/^:root \{/m` still match.
 */
export function readCssInlined(path: string, seen: ReadonlySet<string> = new Set()): string {
  const absolute = resolve(path);
  if (seen.has(absolute)) {
    // A cycle contributes nothing new; stop rather than recursing forever.
    return "";
  }
  const nextSeen = new Set(seen).add(absolute);
  const css = readFileSync(absolute, "utf-8");

  return css.replace(IMPORT_RULE, (match: string, specifier: string) => {
    if (!isRelative(specifier)) {
      return match;
    }
    const imported = readCssInlined(resolve(dirname(absolute), specifier), nextSeen);
    return imported.endsWith("\n") || imported === "" ? imported : `${imported}\n`;
  });
}

/** Reads a CSS file verbatim, without inlining anything. */
export function readCssRaw(path: string): string {
  return readFileSync(resolve(path), "utf-8");
}
