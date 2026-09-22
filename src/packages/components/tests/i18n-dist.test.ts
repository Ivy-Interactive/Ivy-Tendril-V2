import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { LOCALE_CODES } from "../src/i18n/locales";

/**
 * The built `@ivy-interactive/components/i18n` entry, as its consumers load it.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repoRoot, "dist");

/** Same matcher as the app's code-splitting test: a static `import`/`from` of a sibling chunk. */
const STATIC_IMPORT = /(?:from|import)\s*"\.\/([^"]+\.mjs)"/g;
const DYNAMIC_IMPORT = /import\(\s*"\.\/([^"]+\.mjs)"\s*\)/g;

function staticClosure(entry: string): Set<string> {
  const reached = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const source = readFileSync(join(dist, queue.shift()!), "utf8");
    for (const [, chunk] of source.matchAll(STATIC_IMPORT)) {
      if (!reached.has(chunk)) {
        reached.add(chunk);
        queue.push(chunk);
      }
    }
  }
  return reached;
}

describe("dist/i18n.mjs", () => {
  it("is declared in the exports map", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.exports["./i18n"]).toEqual({
      types: "./dist/i18n.d.mts",
      import: "./dist/i18n.mjs",
    });
    expect(existsSync(join(dist, "i18n.mjs"))).toBe(true);
    expect(existsSync(join(dist, "i18n.d.mts"))).toBe(true);
  });

  // The docs site imports the locale table from its Vite plugins, which run in plain Node while the
  // config loads - no DOM, no `import.meta.env`, no bundler. Anything this entry touches at import time
  // has to survive that.
  it("loads in plain Node, and loads a locale's chunk on demand", () => {
    const script = `
      const i18n = await import(${JSON.stringify(join(dist, "i18n.mjs"))});
      const { i18n: store } = i18n.createTranslation();
      await store.changeLanguage("de");
      console.log(JSON.stringify({
        locales: i18n.LOCALE_CODES,
        language: store.language,
        loaded: store.hasResourceBundle("de", "uiCommon"),
        number: i18n.formatNumber(1234.5),
      }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({
      locales: [...LOCALE_CODES],
      language: "de",
      loaded: true,
      number: "1.234,5",
    });
  });

  it("keeps every non-English locale off the static import graph of every entry", () => {
    const i18nSource = readFileSync(join(dist, "i18n.mjs"), "utf8");
    const closure = staticClosure("i18n.mjs");
    const loaderChunks = [...closure].flatMap((chunk) =>
      [...readFileSync(join(dist, chunk), "utf8").matchAll(DYNAMIC_IMPORT)].map(([, file]) => file),
    );
    const localeChunks = loaderChunks.filter((file) =>
      LOCALE_CODES.some((code) => code !== "en" && file.startsWith(`${code}-`)),
    );
    expect(i18nSource.length).toBeGreaterThan(0);
    expect(localeChunks).toHaveLength(LOCALE_CODES.length - 1);

    const entries = [
      "index",
      "ui",
      "renderers",
      "tendril",
      "dialogs",
      "diagrams",
      "charts",
      "theme",
      "i18n",
    ];
    for (const entry of entries) {
      const eager = staticClosure(`${entry}.mjs`);
      const leaked = localeChunks.filter((chunk) => eager.has(chunk));
      expect(leaked, `dist/${entry}.mjs statically imports ${leaked.join(", ")}`).toEqual([]);
    }
  });
});
