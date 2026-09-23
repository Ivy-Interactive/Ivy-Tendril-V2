/**
 * The ten locales Tendril ships, shared by the docs site, the desktop app and this package's own
 * strings. It is the table Ivy-Web keeps in `apps/web-new/config/locales.config.ts`, so all three
 * surfaces offer the same languages under the same codes and the same native names.
 *
 * It lived in `tendril-docs/src/config/locales.config.ts` until the app needed it too. The docs
 * config now re-exports it and keeps only its URL helpers (`splitLocale`, `localizePath`), which are
 * about routing rather than about languages.
 *
 * `code` is the short tag every catalog directory, `config.yaml` value and URL prefix uses.
 * `hreflang` is the BCP 47 tag for `<html lang>`, `hreflang` links and every `Intl` formatter. Two
 * locales diverge from their code:
 * - Brazilian Portuguese: code `pt`, hreflang `pt-BR`, ogLocale `pt_BR`.
 * - Simplified Chinese: code `zh`, hreflang `zh-CN`, ogLocale `zh_CN`.
 *
 * `ogLocale` is the Open Graph `language_TERRITORY` format.
 */

export type SiteLocale = "en" | "de" | "ja" | "es" | "fr" | "pt" | "zh" | "ru" | "sv" | "hi";

export interface LocaleConfig {
  /** URL path prefix, without slashes. Also the locale code key. */
  readonly code: SiteLocale;
  /** BCP 47 tag for `hreflang`, `<html lang="...">` and `Intl`. */
  readonly hreflang: string;
  /** Native language name, for language pickers. */
  readonly label: string;
  /** English name, for `aria-label`s and accessibility. */
  readonly englishLabel: string;
  /** Open Graph `og:locale`, in `language_TERRITORY` form. */
  readonly ogLocale: string;
  /** Text direction ('ltr' for all 10 current locales). */
  readonly dir: "ltr" | "rtl";
}

export const DEFAULT_LOCALE: SiteLocale = "en";

export const SITE_LOCALES: readonly LocaleConfig[] = [
  {
    code: "en",
    hreflang: "en",
    label: "English",
    englishLabel: "English",
    ogLocale: "en_US",
    dir: "ltr",
  },
  {
    code: "de",
    hreflang: "de",
    label: "Deutsch",
    englishLabel: "German",
    ogLocale: "de_DE",
    dir: "ltr",
  },
  {
    code: "ja",
    hreflang: "ja",
    label: "日本語",
    englishLabel: "Japanese",
    ogLocale: "ja_JP",
    dir: "ltr",
  },
  {
    code: "es",
    hreflang: "es",
    label: "Español",
    englishLabel: "Spanish",
    ogLocale: "es_ES",
    dir: "ltr",
  },
  {
    code: "fr",
    hreflang: "fr",
    label: "Français",
    englishLabel: "French",
    ogLocale: "fr_FR",
    dir: "ltr",
  },
  {
    code: "pt",
    hreflang: "pt-BR",
    label: "Português (Brasil)",
    englishLabel: "Portuguese (Brazil)",
    ogLocale: "pt_BR",
    dir: "ltr",
  },
  {
    code: "zh",
    hreflang: "zh-CN",
    label: "简体中文",
    englishLabel: "Chinese (Simplified)",
    ogLocale: "zh_CN",
    dir: "ltr",
  },
  {
    code: "ru",
    hreflang: "ru",
    label: "Русский",
    englishLabel: "Russian",
    ogLocale: "ru_RU",
    dir: "ltr",
  },
  {
    code: "sv",
    hreflang: "sv",
    label: "Svenska",
    englishLabel: "Swedish",
    ogLocale: "sv_SE",
    dir: "ltr",
  },
  {
    code: "hi",
    hreflang: "hi",
    label: "हिन्दी",
    englishLabel: "Hindi",
    ogLocale: "hi_IN",
    dir: "ltr",
  },
];

export const LOCALES: Readonly<Record<SiteLocale, LocaleConfig>> = Object.fromEntries(
  SITE_LOCALES.map((locale) => [locale.code, locale]),
) as Record<SiteLocale, LocaleConfig>;

export const LOCALE_CODES: readonly SiteLocale[] = SITE_LOCALES.map((locale) => locale.code);

export function isSiteLocale(value: string | undefined): value is SiteLocale {
  return value !== undefined && LOCALE_CODES.includes(value as SiteLocale);
}

export function getLocale(code: string): LocaleConfig {
  return LOCALES[code as SiteLocale] ?? LOCALES[DEFAULT_LOCALE];
}

/**
 * The locale one BCP 47 tag names, or `undefined` when it names none of the ten.
 *
 * An exact match on either column wins (`de`, `pt-BR`, `zh-CN`, in any case and with `_` accepted
 * for `-`, which is how POSIX locales spell it). Otherwise the tag's base language decides, so a
 * regional variant the table does not list still lands on its language: `de-AT` is `de`, `pt-PT` is
 * `pt`, `es-419` is `es`.
 *
 * Every Chinese tag is `zh`, Traditional ones included (`zh-TW`, `zh-HK`, `zh-Hant`). That is a
 * product decision rather than a linguistic claim: Simplified Chinese is the only Chinese Tendril
 * ships, and a Traditional Chinese reader follows it far more easily than they would the English
 * fallback.
 */
export function findLocale(tag: string): SiteLocale | undefined {
  const normalized = tag.trim().replace(/_/g, "-").toLowerCase();
  if (normalized === "") return undefined;

  const exact = SITE_LOCALES.find(
    (locale) => locale.code === normalized || locale.hreflang.toLowerCase() === normalized,
  );
  if (exact) return exact.code;

  const base = normalized.split("-")[0];
  return isSiteLocale(base) ? base : undefined;
}

/**
 * The first of `tags` Tendril has a translation for, in the order given, else English.
 *
 * `tags` is a preference list such as `navigator.languages`, so it is walked in order and each tag is
 * tried whole before the next is considered: `["en-GB", "de"]` is English, because English is what
 * the user ranked first, even though `de` would have been an exact match.
 */
export function matchLocale(tags: readonly string[]): SiteLocale {
  for (const tag of tags) {
    const locale = findLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
