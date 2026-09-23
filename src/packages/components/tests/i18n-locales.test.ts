import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  LOCALES,
  SITE_LOCALES,
  findLocale,
  getLocale,
  isSiteLocale,
  matchLocale,
} from "../src/i18n/locales";

/**
 * The shared locale table. The first three blocks are `tendril-docs/tests/locales.test.ts`, which
 * still runs against the docs' re-export; they are repeated here because this package owns the table
 * now and the app depends on it too.
 */

describe("locales configuration", () => {
  it("defines exactly 10 supported locales", () => {
    expect(SITE_LOCALES).toHaveLength(10);
    expect(LOCALE_CODES).toHaveLength(10);
    expect(Object.keys(LOCALES)).toHaveLength(10);
  });

  it("uses the Ivy-Web codes, in the Ivy-Web order", () => {
    expect(LOCALE_CODES).toEqual(["en", "de", "ja", "es", "fr", "pt", "zh", "ru", "sv", "hi"]);
  });

  it("sets English as the default locale", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(LOCALE_CODES[0]).toBe("en");
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

  it("gives every locale a native label and an English one", () => {
    expect(SITE_LOCALES.map((locale) => locale.label)).toEqual([
      "English",
      "Deutsch",
      "日本語",
      "Español",
      "Français",
      "Português (Brasil)",
      "简体中文",
      "Русский",
      "Svenska",
      "हिन्दी",
    ]);
    for (const locale of SITE_LOCALES) {
      expect(locale.englishLabel).toMatch(/^[A-Z][A-Za-z ()]+$/);
    }
  });

  it("uses canonical hreflang tags that Intl supports", () => {
    for (const locale of SITE_LOCALES) {
      expect(Intl.getCanonicalLocales(locale.hreflang)).toEqual([locale.hreflang]);
      expect(Intl.DateTimeFormat.supportedLocalesOf([locale.hreflang])).toEqual([locale.hreflang]);
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
    // A code, not a tag: the hreflang form is not a locale code.
    expect(isSiteLocale("pt-BR")).toBe(false);
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

describe("findLocale", () => {
  it.each([
    ["de", "de"],
    ["DE", "de"],
    ["pt-BR", "pt"],
    ["pt_BR", "pt"],
    ["zh-CN", "zh"],
    ["zh-cn", "zh"],
    [" ja ", "ja"],
  ])("matches %j exactly as %s", (tag, code) => {
    expect(findLocale(tag)).toBe(code);
  });

  it.each([
    ["de-AT", "de"],
    ["de-CH", "de"],
    ["en-GB", "en"],
    ["en-US", "en"],
    ["es-419", "es"],
    ["es-MX", "es"],
    ["fr-CA", "fr"],
    ["pt-PT", "pt"],
    ["ru-RU", "ru"],
    ["sv-FI", "sv"],
    ["hi-IN", "hi"],
    ["ja-JP", "ja"],
  ])("falls back from the region of %j to %s", (tag, code) => {
    expect(findLocale(tag)).toBe(code);
  });

  it.each(["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-TW", "zh-Hans", "zh-Hans-SG", "zh-SG"])(
    "reads every Chinese tag, %j included, as the one Chinese Tendril ships",
    (tag) => {
      expect(findLocale(tag)).toBe("zh");
    },
  );

  it.each(["it", "ko-KR", "nl", "und", "*", "", "   ", "x-klingon", "english"])(
    "finds nothing for %j",
    (tag) => {
      expect(findLocale(tag)).toBeUndefined();
    },
  );
});

describe("matchLocale", () => {
  it("takes the first tag it can match, in preference order", () => {
    expect(matchLocale(["de-DE", "en"])).toBe("de");
    expect(matchLocale(["it", "de"])).toBe("de");
    expect(matchLocale(["ko", "it", "pt-PT", "de"])).toBe("pt");
  });

  it("does not skip a user's first choice for a later exact match", () => {
    // `de` would be an exact match, but the user ranked English (Britain) first.
    expect(matchLocale(["en-GB", "de"])).toBe("en");
  });

  it("falls back to English when nothing matches, or nothing is given", () => {
    expect(matchLocale(["it", "ko"])).toBe("en");
    expect(matchLocale([])).toBe("en");
  });

  it("accepts navigator.languages as browsers report it", () => {
    expect(matchLocale(["zh-TW", "zh", "en-US", "en"])).toBe("zh");
    expect(matchLocale(["sv-SE", "sv", "en-US"])).toBe("sv");
    expect(matchLocale(["hi-IN", "en-IN"])).toBe("hi");
  });
});
