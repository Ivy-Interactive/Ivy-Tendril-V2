import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  LOCALES,
  PREFIXED_LOCALE_CODES,
  SITE_LOCALES,
  getLocale,
  isSiteLocale,
  localizePath,
  splitLocale,
} from "../src/config/locales.config";

describe("locales configuration", () => {
  it("defines exactly 10 supported locales", () => {
    expect(SITE_LOCALES).toHaveLength(10);
    expect(LOCALE_CODES).toHaveLength(10);
    expect(Object.keys(LOCALES)).toHaveLength(10);
  });

  it("sets English as the default unprefixed locale", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(PREFIXED_LOCALE_CODES).not.toContain("en");
    expect(PREFIXED_LOCALE_CODES).toHaveLength(9);
  });

  it("maps BCP 47 hreflang and ogLocale correctly for Portuguese and Chinese", () => {
    const pt = getLocale("pt");
    expect(pt.code).toBe("pt");
    expect(pt.hreflang).toBe("pt-BR");
    expect(pt.ogLocale).toBe("pt_BR");
    expect(pt.label).toBe("Português (Brasil)");

    const zh = getLocale("zh");
    expect(zh.code).toBe("zh");
    expect(zh.hreflang).toBe("zh-CN");
    expect(zh.ogLocale).toBe("zh_CN");
    expect(zh.label).toBe("简体中文");
  });

  it("configures all 10 locales with ltr text direction", () => {
    for (const locale of SITE_LOCALES) {
      expect(locale.dir).toBe("ltr");
    }
  });

  it("defines expected ogLocale format for all locales", () => {
    const expectedOgLocales: Record<string, string> = {
      en: "en_US",
      de: "de_DE",
      ja: "ja_JP",
      es: "es_ES",
      fr: "fr_FR",
      pt: "pt_BR",
      zh: "zh_CN",
      ru: "ru_RU",
      sv: "sv_SE",
      hi: "hi_IN",
    };
    for (const [code, ogLocale] of Object.entries(expectedOgLocales)) {
      expect(getLocale(code).ogLocale).toBe(ogLocale);
    }
  });
});

describe("isSiteLocale", () => {
  it("returns true for all 10 supported locale codes", () => {
    for (const code of LOCALE_CODES) {
      expect(isSiteLocale(code)).toBe(true);
    }
  });

  it("returns false for unsupported or arbitrary strings", () => {
    expect(isSiteLocale("it")).toBe(false);
    expect(isSiteLocale("ko")).toBe(false);
    expect(isSiteLocale("design")).toBe(false);
    expect(isSiteLocale("docs")).toBe(false);
    expect(isSiteLocale("")).toBe(false);
    expect(isSiteLocale(undefined)).toBe(false);
  });
});

describe("getLocale", () => {
  it("returns the exact locale configuration for a valid code", () => {
    const de = getLocale("de");
    expect(de.label).toBe("Deutsch");
    expect(de.hreflang).toBe("de");
  });

  it("falls back to English for unknown locale codes", () => {
    const fallback = getLocale("unknown");
    expect(fallback.code).toBe("en");
    expect(fallback.label).toBe("English");
  });
});

describe("splitLocale", () => {
  it("returns en and original path for standard unprefixed docs routes", () => {
    expect(splitLocale("/docs/concepts")).toEqual({
      locale: "en",
      path: "/docs/concepts",
    });
  });

  it("splits prefixed locale routes correctly", () => {
    expect(splitLocale("/de/docs/concepts")).toEqual({
      locale: "de",
      path: "/docs/concepts",
    });
    expect(splitLocale("/ja/docs/gettingstarted/introduction")).toEqual({
      locale: "ja",
      path: "/docs/gettingstarted/introduction",
    });
  });

  it("handles bare locale prefixes", () => {
    expect(splitLocale("/de")).toEqual({
      locale: "de",
      path: "/",
    });
    expect(splitLocale("/de/")).toEqual({
      locale: "de",
      path: "/",
    });
  });

  it("handles domain root and empty string", () => {
    expect(splitLocale("/")).toEqual({
      locale: "en",
      path: "/",
    });
    expect(splitLocale("")).toEqual({
      locale: "en",
      path: "/",
    });
  });

  it("normalizes redundant /en/ prefix to unprefixed path", () => {
    expect(splitLocale("/en/docs/concepts")).toEqual({
      locale: "en",
      path: "/docs/concepts",
    });
    expect(splitLocale("/en")).toEqual({
      locale: "en",
      path: "/",
    });
  });

  it("does not mistake arbitrary words for locale prefixes", () => {
    expect(splitLocale("/design")).toEqual({
      locale: "en",
      path: "/design",
    });
    expect(splitLocale("/dev/docs")).toEqual({
      locale: "en",
      path: "/dev/docs",
    });
  });
});

describe("localizePath", () => {
  it("returns unprefixed path when localizing for English", () => {
    expect(localizePath("/docs/concepts", "en")).toBe("/docs/concepts");
  });

  it("prefixes path for non-default locales", () => {
    expect(localizePath("/docs/concepts", "de")).toBe("/de/docs/concepts");
    expect(localizePath("/docs/gettingstarted/introduction", "ja")).toBe(
      "/ja/docs/gettingstarted/introduction",
    );
  });

  it("replaces existing locale prefix without stacking prefixes", () => {
    expect(localizePath("/de/docs/concepts", "ja")).toBe("/ja/docs/concepts");
    expect(localizePath("/ja/docs/concepts", "en")).toBe("/docs/concepts");
    expect(localizePath("/fr/docs/concepts", "de")).toBe("/de/docs/concepts");
  });

  it("handles root path correctly without trailing slashes", () => {
    expect(localizePath("/", "de")).toBe("/de");
    expect(localizePath("", "de")).toBe("/de");
    expect(localizePath("/de", "de")).toBe("/de");
  });

  it("accepts LocaleConfig object as locale parameter", () => {
    const jaConfig = getLocale("ja");
    expect(localizePath("/docs/concepts", jaConfig)).toBe("/ja/docs/concepts");
  });
});
