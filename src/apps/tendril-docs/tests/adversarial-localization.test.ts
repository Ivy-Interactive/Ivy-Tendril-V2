import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALE_CODES, localizePath, splitLocale } from "../src/config/locales.config";
import { contentPathForRoute, routeForPath } from "../src/lib/slug";
import { readContent } from "./helpers";

const contentFiles = readContent();
const contentPaths = Object.keys(contentFiles);

describe("Adversarial Stress Test: splitLocale & URL parsing", () => {
  it("handles empty, root, and multi-slash path edge cases", () => {
    expect(splitLocale("")).toEqual({ locale: "en", path: "/" });
    expect(splitLocale("/")).toEqual({ locale: "en", path: "/" });
    expect(splitLocale("///")).toEqual({ locale: "en", path: "///" });
  });

  it("handles bare locale roots and trailing slashes correctly", () => {
    for (const code of LOCALE_CODES) {
      if (code === "en") continue;
      // Bare locale "/de"
      expect(splitLocale(`/${code}`)).toEqual({ locale: code, path: "/" });
      // Trailing slash "/de/"
      expect(splitLocale(`/${code}/`)).toEqual({ locale: code, path: "/" });
      // Multiple trailing slashes "/de///"
      expect(splitLocale(`/${code}///`)).toEqual({ locale: code, path: "///" });
    }
  });

  it("does NOT match words starting with 2-letter codes as locales", () => {
    // Words starting with 2-letter language codes
    const falsePositives = [
      "/design",
      "/development",
      "/javascript",
      "/java",
      "/estimate",
      "/essential",
      "/friends",
      "/framework",
      "/python",
      "/pytorch",
      "/rust",
      "/runtime",
      "/svg",
      "/schema",
      "/history",
      "/highlight",
    ];

    for (const p of falsePositives) {
      const res = splitLocale(p);
      expect(res.locale).toBe("en");
      expect(res.path).toBe(p);
    }
  });

  it("handles unknown 2-letter and 3-letter codes without mangling", () => {
    const unknownCodes = ["/it/docs", "/nl/docs", "/ko/docs", "/ar/docs", "/pl/docs"];
    for (const p of unknownCodes) {
      const res = splitLocale(p);
      expect(res.locale).toBe("en");
      expect(res.path).toBe(p);
    }

    const threeLetterCodes = ["/eng/docs", "/fra/docs", "/jpn/docs", "/deu/docs"];
    for (const p of threeLetterCodes) {
      const res = splitLocale(p);
      expect(res.locale).toBe("en");
      expect(res.path).toBe(p);
    }
  });

  it("handles query parameters and hash fragments on locale root and doc pages", () => {
    expect(splitLocale("/de?query=1")).toEqual({ locale: "en", path: "/de?query=1" });
    expect(splitLocale("/de/?query=1")).toEqual({ locale: "de", path: "/?query=1" });
    expect(splitLocale("/de#hash")).toEqual({ locale: "en", path: "/de#hash" });
    expect(splitLocale("/de/#hash")).toEqual({ locale: "de", path: "/#hash" });
    expect(splitLocale("/de/docs/concepts?foo=bar#baz")).toEqual({
      locale: "de",
      path: "/docs/concepts?foo=bar#baz",
    });
  });

  it("handles explicit /en prefix by stripping it to canonical path", () => {
    expect(splitLocale("/en")).toEqual({ locale: "en", path: "/" });
    expect(splitLocale("/en/")).toEqual({ locale: "en", path: "/" });
    expect(splitLocale("/en/docs/concepts")).toEqual({ locale: "en", path: "/docs/concepts" });
  });

  it("handles uppercase or mixed-case locale attempts by falling back to en", () => {
    expect(splitLocale("/DE/docs")).toEqual({ locale: "en", path: "/DE/docs" });
    expect(splitLocale("/Ja/docs")).toEqual({ locale: "en", path: "/Ja/docs" });
  });
});

describe("Adversarial Stress Test: localizePath permutations", () => {
  it("prevents duplicate locale prefixes when switching repeatedly", () => {
    let curr = "/docs/concepts/plans";
    for (const code of LOCALE_CODES) {
      curr = localizePath(curr, code);
      if (code === "en") {
        expect(curr).toBe("/docs/concepts/plans");
      } else {
        expect(curr).toBe(`/${code}/docs/concepts/plans`);
      }
    }
  });

  it("handles cross-locale switching between non-English locales", () => {
    expect(localizePath("/de/docs/concepts", "ja")).toBe("/ja/docs/concepts");
    expect(localizePath("/ja/docs/concepts", "es")).toBe("/es/docs/concepts");
    expect(localizePath("/es/docs/concepts", "zh")).toBe("/zh/docs/concepts");
    expect(localizePath("/zh/docs/concepts", "en")).toBe("/docs/concepts");
  });

  it("handles root transitions across all locales", () => {
    expect(localizePath("/", "de")).toBe("/de");
    expect(localizePath("/de", "ja")).toBe("/ja");
    expect(localizePath("/ja", "en")).toBe("/");
    expect(localizePath("", "de")).toBe("/de");
    expect(localizePath("", "en")).toBe("/");
  });

  it("preserves query strings and hashes during localization transitions", () => {
    expect(localizePath("/docs/concepts?test=1#heading", "de")).toBe(
      "/de/docs/concepts?test=1#heading",
    );
    expect(localizePath("/de/docs/concepts?test=1#heading", "fr")).toBe(
      "/fr/docs/concepts?test=1#heading",
    );
    expect(localizePath("/fr/docs/concepts?test=1#heading", "en")).toBe(
      "/docs/concepts?test=1#heading",
    );
  });

  it("falls back cleanly when target locale is invalid", () => {
    expect(localizePath("/docs/concepts", "klingon")).toBe("/docs/concepts");
    expect(localizePath("/de/docs/concepts", "invalid")).toBe("/docs/concepts");
  });
});

describe("Adversarial Stress Test: contentPathForRoute & normalizeRoute", () => {
  it("resolves all authored content files for all 10 locales", () => {
    for (const contentPath of contentPaths) {
      const enRoute = routeForPath(contentPath);
      expect(contentPathForRoute(enRoute, contentPaths)).toBe(contentPath);

      for (const locale of LOCALE_CODES) {
        if (locale === "en") continue;
        const locRoute = `/${locale}${enRoute}`;
        expect(contentPathForRoute(locRoute, contentPaths)).toBe(contentPath);
      }
    }
  });

  it("tolerates trailing slashes on English and localized routes", () => {
    expect(contentPathForRoute("/docs/concepts/plans/", contentPaths)).toBe(
      "02_Concepts/01_Plans.md",
    );
    expect(contentPathForRoute("/de/docs/concepts/plans/", contentPaths)).toBe(
      "02_Concepts/01_Plans.md",
    );
    expect(contentPathForRoute("/ja/docs/gettingstarted/introduction/", contentPaths)).toBe(
      "01_GettingStarted/01_Introduction.md",
    );
  });

  it("tolerates query parameters and hash fragments", () => {
    expect(contentPathForRoute("/de/docs/concepts/plans?v=2#details", contentPaths)).toBe(
      "02_Concepts/01_Plans.md",
    );
  });

  it("returns undefined for unknown locales or non-existent documents", () => {
    expect(contentPathForRoute("/xx/docs/concepts/plans", contentPaths)).toBeUndefined();
    expect(contentPathForRoute("/docs/non-existent-page", contentPaths)).toBeUndefined();
    expect(contentPathForRoute("/de/docs/non-existent-page", contentPaths)).toBeUndefined();
  });
});

describe("Adversarial Static Output Audit: All 10 Locales & 570 Shells", () => {
  const distDir = path.resolve(__dirname, "../dist");

  it("confirms dist exists and has all 10 locale static shells", () => {
    if (!existsSync(distDir)) {
      // If tests run in an environment where the build hasn't run yet, skip static output inspection
      return;
    }
    expect(existsSync(distDir)).toBe(true);
    expect(existsSync(path.join(distDir, "docs"))).toBe(true);

    const nonEnLocales = LOCALE_CODES.filter((c) => c !== "en");
    for (const code of nonEnLocales) {
      expect(existsSync(path.join(distDir, code, "docs"))).toBe(true);
    }
  });

  it("verifies all 570 static route shells have correct lang, dir, canonical, og:locale, and 11 hreflangs", () => {
    if (!existsSync(distDir)) {
      // If tests run in an environment where the build hasn't run yet, skip static output inspection
      return;
    }
    const localeConfigs = {
      en: { hreflang: "en", ogLocale: "en_US", dir: "ltr", prefix: "" },
      de: { hreflang: "de", ogLocale: "de_DE", dir: "ltr", prefix: "/de" },
      ja: { hreflang: "ja", ogLocale: "ja_JP", dir: "ltr", prefix: "/ja" },
      es: { hreflang: "es", ogLocale: "es_ES", dir: "ltr", prefix: "/es" },
      fr: { hreflang: "fr", ogLocale: "fr_FR", dir: "ltr", prefix: "/fr" },
      pt: { hreflang: "pt-BR", ogLocale: "pt_BR", dir: "ltr", prefix: "/pt" },
      zh: { hreflang: "zh-CN", ogLocale: "zh_CN", dir: "ltr", prefix: "/zh" },
      ru: { hreflang: "ru", ogLocale: "ru_RU", dir: "ltr", prefix: "/ru" },
      sv: { hreflang: "sv", ogLocale: "sv_SE", dir: "ltr", prefix: "/sv" },
      hi: { hreflang: "hi", ogLocale: "hi_IN", dir: "ltr", prefix: "/hi" },
    };

    const expectedHreflangs = [
      "x-default",
      "en",
      "de",
      "ja",
      "es",
      "fr",
      "pt-BR",
      "zh-CN",
      "ru",
      "sv",
      "hi",
    ];

    let countChecked = 0;

    for (const [locCode, cfg] of Object.entries(localeConfigs)) {
      const baseDir =
        locCode === "en" ? path.join(distDir, "docs") : path.join(distDir, locCode, "docs");

      function walk(dir: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.name === "index.html") {
            const rel = path.relative(baseDir, full).replace(/\\/g, "/");
            if (rel === "index.html") continue; // skip section / docs root index redirect

            countChecked++;
            const routePath = "/docs/" + rel.replace(/\/index\.html$/, "");
            const html = readFileSync(full, "utf8");

            // 1. <html lang="..." dir="ltr">
            const htmlTagMatch = /<html\s+([^>]+)>/i.exec(html);
            expect(htmlTagMatch, `Missing <html> in ${full}`).not.toBeNull();
            const attrs = htmlTagMatch![1];
            expect(attrs).toContain(`lang="${cfg.hreflang}"`);
            expect(attrs).toContain(`dir="${cfg.dir}"`);

            // 2. <link rel="canonical" href="...">
            const canonicalMatch = /<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(html);
            expect(canonicalMatch, `Missing canonical in ${full}`).not.toBeNull();
            expect(canonicalMatch![1]).toBe(`https://docs.ivy.app${cfg.prefix}${routePath}`);

            // 3. <meta property="og:locale" content="...">
            const ogMatch = /<meta\s+property="og:locale"\s+content="([^"]+)"/i.exec(html);
            expect(ogMatch, `Missing og:locale in ${full}`).not.toBeNull();
            expect(ogMatch![1]).toBe(cfg.ogLocale);

            // 4. Exactly 11 alternate hreflang tags
            const hreflangMatches = [
              ...html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"/gi),
            ];
            expect(
              hreflangMatches,
              `Expected 11 hreflangs in ${full}, found ${hreflangMatches.length}`,
            ).toHaveLength(11);

            const foundCodes = hreflangMatches.map((m) => m[1]);
            expect(foundCodes.sort()).toEqual([...expectedHreflangs].sort());

            // x-default must always point to unprefixed English URL
            const xDefault = hreflangMatches.find((m) => m[1] === "x-default");
            expect(xDefault?.[2]).toBe(`https://docs.ivy.app${routePath}`);

            // Each locale code points to its localized URL
            for (const [, otherCfg] of Object.entries(localeConfigs)) {
              const link = hreflangMatches.find((m) => m[1] === otherCfg.hreflang);
              expect(link?.[2]).toBe(`https://docs.ivy.app${otherCfg.prefix}${routePath}`);
            }
          }
        }
      }

      walk(baseDir);
    }

    expect(countChecked).toBe(57 * 10);
  });
});
