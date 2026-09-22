/**
 * The single source of truth for the docs site: the `content/` folder as the bundler sees it.
 *
 * There is no code generation step and no MSBuild equivalent — adding a `.md` file under
 * `content/<NN>_<Section>/` *is* the whole authoring workflow. `import.meta.glob` picks it up, the
 * nav tree grows a node, the search index grows a document, and `vp build` emits a route shell for
 * it.
 */
import { buildNavTree, flattenNavRoutes, type NavSection } from "./lib/nav";
import { parsePages, type DocPage } from "./lib/page";
import { normalizeRoute, ROUTE_BASE, splitLocale } from "./lib/slug";

const CONTENT_PREFIX = "../content/";

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

/** Every authored markdown file, keyed by content-relative path. */
export const rawPages: Record<string, string> = keyByContentPath(
  import.meta.glob("../content/**/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

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
  [...pages.values()].map((page) => [page.route, page]),
);

/** Looks a page up by route, tolerating a trailing slash, a query string, a fragment, or a locale prefix. */
export function pageForRoute(route: string): DocPage | undefined {
  const normalized = normalizeRoute(route);
  const direct = pagesByRoute.get(normalized);
  if (direct) return direct;

  // Split locale prefix if present (e.g. /de/docs/concepts/plans -> { locale: 'de', path: '/docs/concepts/plans' })
  const { path: cleanPath } = splitLocale(normalized);
  const normalizedClean = normalizeRoute(cleanPath);
  const localizedDirect = pagesByRoute.get(normalizedClean);
  if (localizedDirect) return localizedDirect;

  // Resilient fallback: if route is accessed without ROUTE_BASE prefix (or with domain root)
  const candidateBase = normalizedClean.startsWith(ROUTE_BASE) ? normalizedClean : normalized;
  if (!candidateBase.startsWith(ROUTE_BASE)) {
    const withoutLeading = candidateBase.replace(/^\/+/, "");
    const stripped = withoutLeading.replace(/^docs\/?/, "");
    const candidate = `${ROUTE_BASE}/${stripped}`;
    const fallback = pagesByRoute.get(normalizeRoute(candidate));
    if (fallback) return fallback;
  }

  return undefined;
}

/** First page of the first section — where the base route and any unknown entry point land. */
export const homeRoute: string = routes[0] ?? ROUTE_BASE;
