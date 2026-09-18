import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readCssRaw } from "./read-css.ts";

const TOKENS_CSS = resolve(__dirname, "..", "src/styles/tokens.css");

function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const result = new Map<string, string>();
  for (const match of body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    result.set(match[1], match[2]);
  }
  return result;
}

describe("derived tokens follow the theme", () => {
  const css = `\n${readCssRaw(TOKENS_CSS)}`;
  const root = declarations(css, ":root");
  const dark = declarations(css, ".dark");

  const dependsOnThemed = (value: string, seen = new Set<string>()): boolean =>
    [...value.matchAll(/var\((--[\w-]+)/g)].some(([, name]) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return dark.has(name) || dependsOnThemed(root.get(name) ?? "", seen);
    });

  it("re-declares every :root token that references a themed token inside .dark", () => {
    const missing = [...root]
      .filter(([name, value]) => !dark.has(name) && dependsOnThemed(value))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});
