/**
 * Locale configuration for the docs site.
 *
 * The locale table itself - the ten languages, their BCP 47 `hreflang` tags, native labels and
 * `ogLocale`s - lives in `@ivy-interactive/components/i18n`, because the desktop app and the
 * components' own strings use the same table. It matches Ivy-Web
 * (`apps/web-new/config/locales.config.ts`), and is re-exported here so the site keeps importing it
 * from one place.
 *
 * What stays here is docs-only: how a locale appears in a URL. English is the default and is served
 * unprefixed (`/docs/...`) so that existing URLs, backlinks, and indexed pages keep working. Every
 * other locale lives under its own path prefix (`/{locale}/docs/...`).
 */
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  isSiteLocale,
  type LocaleConfig,
  type SiteLocale,
} from "@ivy-interactive/components/i18n";

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_CODES,
  SITE_LOCALES,
  getLocale,
  isSiteLocale,
  type LocaleConfig,
  type SiteLocale,
} from "@ivy-interactive/components/i18n";

export const PREFIXED_LOCALE_CODES: readonly SiteLocale[] = LOCALE_CODES.filter(
  (code) => code !== DEFAULT_LOCALE,
);

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
