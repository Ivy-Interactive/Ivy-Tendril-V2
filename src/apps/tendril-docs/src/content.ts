/**
 * The single source of truth for the docs site: the `content/` folder as the bundler sees it.
 *
 * There is no code generation step and no MSBuild equivalent — adding a `.md` file under
 * `content/<NN>_<Section>/` *is* the whole authoring workflow. `import.meta.glob` picks it up, the
 * nav tree grows a node, the search index grows a document, and `vp build` emits a route shell for
 * it.
 */
import {
  DEFAULT_LOCALE,
  isSiteLocale,
  localizePath,
  type SiteLocale,
} from "./config/locales.config";
import { buildNavTree, flattenNavRoutes, type NavSection } from "./lib/nav";
import { parsePage, parsePages, type DocPage } from "./lib/page";
import { normalizeRoute, ROUTE_BASE, splitLocale } from "./lib/slug";

const CONTENT_PREFIX = "../content/";
const LOCALE_PREFIX = "../locales/";

function stripPrefix(globKey: string): string {
  const normalized = globKey.replace(/\\/g, "/");
  const index = normalized.indexOf(CONTENT_PREFIX);
  return index >= 0 ? normalized.slice(index + CONTENT_PREFIX.length) : normalized;
}

function keyByContentPath<T>(modules: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(modules).map(([globKey, value]) => [stripPrefix(globKey), value]),
  );
}

function stripLocalePrefix(globKey: string): { locale: SiteLocale; contentPath: string } | null {
  const normalized = globKey.replace(/\\/g, "/");
  const index = normalized.indexOf(LOCALE_PREFIX);
  if (index < 0) return null;
  const rest = normalized.slice(index + LOCALE_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const locale = rest.slice(0, slash);
  if (!isSiteLocale(locale)) return null;
  const contentPath = rest.slice(slash + 1);
  return { locale: locale as SiteLocale, contentPath };
}

/** Every authored markdown file, keyed by content-relative path. */
export const rawPages: Record<string, string> = keyByContentPath(
  import.meta.glob("../content/**/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

/** Localized markdown files under `locales/<locale>/...` */
export const rawLocalePages: Record<string, string> = import.meta.glob("../locales/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every file under `content/assets/`, keyed by content-relative path, valued by served URL. */
export const assetUrls: Record<string, string> = keyByContentPath(
  import.meta.glob("../content/assets/**/*", {
    query: "?url",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

/**
 * Absolute URL for an asset referenced from markdown.
 *
 * `MarkdownRenderer`'s image handling prefixes a root-relative `src` with the Ivy host and an
 * `/ivy/` segment (it exists to serve uploads behind a reverse proxy), which would mangle a docs
 * asset. An absolute same-origin URL is passed through untouched, so that is what we hand it.
 */
export function resolveAsset(contentPath: string): string | undefined {
  const url = assetUrls[contentPath];
  if (!url) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).href;
}

/** Parsed page model for every route, keyed by content-relative path. */
export const pages: Map<string, DocPage> = parsePages(rawPages);

/** Ordered sidebar tree. Throws at module load if `content/` breaks the authoring convention. */
export const navTree: NavSection[] = buildNavTree(rawPages);

/** Every route the site serves, in sidebar order. */
export const routes: string[] = flattenNavRoutes(navTree);

const pagesByRoute = new Map<string, DocPage>(
  [...pages.values()].map((page) => [page.route, { ...page, isFallback: false }]),
);

/** Localized pages indexed by localized route (e.g. `/de/docs/gettingstarted/introduction`). */
export const localizedPagesByRoute = new Map<string, DocPage>();

for (const [globKey, raw] of Object.entries(rawLocalePages)) {
  const parsed = stripLocalePrefix(globKey);
  if (!parsed) continue;
  const { locale, contentPath } = parsed;
  const page = parsePage(contentPath, raw);
  const localizedRoute = localizePath(page.route, locale);
  localizedPagesByRoute.set(localizedRoute, {
    ...page,
    route: localizedRoute,
    isFallback: false,
  });
}

/** Looks a page up by route, tolerating a trailing slash, a query string, a fragment, or a locale prefix. */
export function pageForRoute(route: string): DocPage | undefined {
  const normalized = normalizeRoute(route);

  // 1. Direct match on localized page if present
  const locDirect = localizedPagesByRoute.get(normalized);
  if (locDirect) return locDirect;

  // 2. Direct match on English page if present (and route is English)
  const direct = pagesByRoute.get(normalized);
  if (direct) return direct;

  // 3. Split locale prefix if present (e.g. /de/docs/concepts/plans -> { locale: 'de', path: '/docs/concepts/plans' })
  const { locale, path: cleanPath } = splitLocale(normalized);
  const normalizedClean = normalizeRoute(cleanPath);

  if (locale !== DEFAULT_LOCALE) {
    const candidateLocRoute = localizePath(normalizedClean, locale);
    const localized = localizedPagesByRoute.get(candidateLocRoute);
    if (localized) return localized;

    // Fallback to English page for non-default locale with isFallback: true
    const fallback = pagesByRoute.get(normalizedClean);
    if (fallback) return { ...fallback, isFallback: true };
  } else {
    const fallback = pagesByRoute.get(normalizedClean);
    if (fallback) return fallback;
  }

  // 4. Resilient fallback: if route is accessed without ROUTE_BASE prefix (or with domain root)
  const candidateBase = normalizedClean.startsWith(ROUTE_BASE) ? normalizedClean : normalized;
  if (!candidateBase.startsWith(ROUTE_BASE)) {
    const withoutLeading = candidateBase.replace(/^\/+/, "");
    const stripped = withoutLeading.replace(/^docs\/?/, "");
    const candidate = `${ROUTE_BASE}/${stripped}`;
    const candidateNorm = normalizeRoute(candidate);

    if (locale !== DEFAULT_LOCALE) {
      const candidateLocRoute = localizePath(candidateNorm, locale);
      const loc = localizedPagesByRoute.get(candidateLocRoute);
      if (loc) return loc;

      const fallback = pagesByRoute.get(candidateNorm);
      if (fallback) return { ...fallback, isFallback: true };
    } else {
      const fallback = pagesByRoute.get(candidateNorm);
      if (fallback) return fallback;
    }
  }

  return undefined;
}

/** First page of the first section — where the base route and any unknown entry point land. */
export const homeRoute: string = routes[0] ?? ROUTE_BASE;
