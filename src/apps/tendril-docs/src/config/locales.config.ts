/**
 * Authoritative locale configurations matching Ivy-Web (`apps/web-new/config/locales.config.ts`).
 *
 * English is the default and is served unprefixed (`/docs/...`) so that existing URLs,
 * backlinks, and indexed pages keep working. Every other locale lives under its own path prefix
 * (`/{locale}/docs/...`).
 *
 * `hreflang` is the value emitted in alternate links and in `<html lang="...">`.
 * BCP 47 divergence:
 * - Brazilian Portuguese: prefix `/pt`, hreflang `pt-BR`, ogLocale `pt_BR`.
 * - Simplified Chinese: prefix `/zh`, hreflang `zh-CN`, ogLocale `zh_CN`.
 *
 * `ogLocale` is the Open Graph `language_TERRITORY` format.
 */

export type SiteLocale = "en" | "de" | "ja" | "es" | "fr" | "pt" | "zh" | "ru" | "sv" | "hi";

export interface LocaleConfig {
  /** URL path prefix, without slashes. Also the locale code key. */
  code: SiteLocale;
  /** BCP 47 tag for `hreflang` and `<html lang="...">`. */
  hreflang: string;
  /** Native language name, for LanguageSwitcher. */
  label: string;
  /** English name, for `aria-label`s and accessibility. */
  englishLabel: string;
  /** Open Graph `og:locale`, in `language_TERRITORY` form. */
  ogLocale: string;
  /** Text direction ('ltr' for all 10 current locales). */
  dir: "ltr" | "rtl";
}

export const DEFAULT_LOCALE: SiteLocale = "en";

export const SITE_LOCALES: LocaleConfig[] = [
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

export const LOCALES: Record<SiteLocale, LocaleConfig> = Object.fromEntries(
  SITE_LOCALES.map((locale) => [locale.code, locale]),
) as Record<SiteLocale, LocaleConfig>;

export const LOCALE_CODES: readonly SiteLocale[] = SITE_LOCALES.map((locale) => locale.code);

export const PREFIXED_LOCALE_CODES: readonly SiteLocale[] = LOCALE_CODES.filter(
  (code) => code !== DEFAULT_LOCALE,
);

export function isSiteLocale(value: string | undefined): value is SiteLocale {
  return value !== undefined && LOCALE_CODES.includes(value as SiteLocale);
}

export function getLocale(code: string): LocaleConfig {
  return LOCALES[code as SiteLocale] ?? LOCALES[DEFAULT_LOCALE];
}

/**
 * Split a pathname into its locale and the path beneath it.
 *
 * `/de/docs/concepts` -> `{ locale: 'de', path: '/docs/concepts' }`
 * `/docs/concepts`    -> `{ locale: 'en', path: '/docs/concepts' }`
 * `/de`               -> `{ locale: 'de', path: '/' }`
 * `/en/docs/concepts` -> `{ locale: 'en', path: '/docs/concepts' }`
 * `/design`           -> `{ locale: 'en', path: '/design' }`
 */
export function splitLocale(pathname: string): {
  locale: SiteLocale;
  path: string;
} {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(pathname);
  const candidate = match?.[1];

  if (!candidate || !isSiteLocale(candidate)) {
    return { locale: DEFAULT_LOCALE, path: pathname || "/" };
  }

  const remainder = pathname.slice(candidate.length + 1);
  const normalizedPath =
    remainder.length === 0 ? "/" : remainder.startsWith("/") ? remainder : `/${remainder}`;

  return {
    locale: candidate,
    path: normalizedPath,
  };
}

/**
 * Prefix a site-relative path for a locale. English is returned unprefixed.
 *
 * `localizePath('/docs/concepts', 'en')` -> `'/docs/concepts'`
 * `localizePath('/docs/concepts', 'de')` -> `'/de/docs/concepts'`
 * `localizePath('/de/docs/concepts', 'ja')` -> `'/ja/docs/concepts'`
 * `localizePath('/', 'de')` -> `'/de'`
 */
export function localizePath(path: string, locale: string | LocaleConfig): string {
  const targetCode = typeof locale === "string" ? locale : locale.code;
  const { path: cleanPath } = splitLocale(path);
  const normalized = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;

  if (targetCode === DEFAULT_LOCALE || !isSiteLocale(targetCode)) {
    return normalized;
  }

  return normalized === "/" ? `/${targetCode}` : `/${targetCode}${normalized}`;
}
