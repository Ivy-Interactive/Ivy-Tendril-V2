/**
 * Path <-> route mapping for the docs site.
 *
 * Authored markdown lives at `content/<NN>_<Section>/<NN>_<Page>.md` (see the package README).
 * The `NN_` prefixes drive navigation order only and never appear in a URL, so the mapping is
 * "strip the order prefix, slugify what is left, join with `/` under {@link ROUTE_BASE}".
 *
 * Everything here is pure and works on content-relative paths (`01_GettingStarted/02_Installation.md`),
 * never on absolute filesystem paths, so the same functions serve the browser bundle and the
 * `node:fs`-driven tests.
 */

/** URL prefix every docs route carries. Matches `base` in `vite.config.ts`. */
export const ROUTE_BASE = (() => {
  const raw =
    (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) ||
    (typeof process !== "undefined" && (process.env?.VITE_BASE_PATH || process.env?.BASE_PATH)) ||
    "/docs/";
  const normalized = (raw.startsWith("/") ? raw : `/${raw}`).replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/docs";
})();

/** File name (without extension) that makes a folder a section and gives it its own page. */
export const SECTION_INDEX = "_Index";

/** Removes a leading two-or-more digit order prefix: `02_Installation` -> `Installation`. */
export function stripOrder(name: string): string {
  return name.replace(/^\d{2,}_/, "");
}

/** Numeric value of a leading order prefix, or `Number.MAX_SAFE_INTEGER` when there is none. */
export function orderOf(name: string): number {
  const match = /^(\d{2,})_/.exec(name);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * Lowercases a name and collapses every run of non-alphanumerics into a single `-`:
 * `GettingStarted` -> `gettingstarted`, `Model Providers` -> `model-providers`.
 *
 * Deliberately does *not* split camel case — `01_GettingStarted/01_Introduction.md` has to come out
 * as `/docs/gettingstarted/introduction`, which is the URL the repo README already links to.
 */
export function slugify(name: string): string {
  return stripOrder(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Splits a content-relative path into its segments, tolerating Windows separators. */
export function segmentsOf(contentPath: string): string[] {
  return contentPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

/** True when the path is a section's own index page (`.../_Index.md`). */
export function isSectionIndex(contentPath: string): boolean {
  const segments = segmentsOf(contentPath);
  const last = segments[segments.length - 1];
  return last === `${SECTION_INDEX}.md`;
}

/**
 * Route for a content-relative markdown path.
 *
 * `01_GettingStarted/01_Introduction.md` -> `/docs/gettingstarted/introduction`
 * `02_Concepts/_Index.md`                -> `/docs/concepts`
 */
export function routeForPath(contentPath: string): string {
  const segments = segmentsOf(contentPath.replace(/\.md$/i, ""));
  const slugs = segments
    .filter((segment, index) => !(segment === SECTION_INDEX && index === segments.length - 1))
    .map(slugify)
    .filter((slug) => slug.length > 0);
  return slugs.length > 0 ? `${ROUTE_BASE}/${slugs.join("/")}` : ROUTE_BASE;
}

/** Drops a trailing slash and any query/hash so `/docs/concepts/` and `/docs/concepts` agree. */
export function normalizeRoute(route: string): string {
  const withoutFragment = route.replace(/[?#].*$/, "");
  const trimmed = withoutFragment.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : ROUTE_BASE;
}

/**
 * Reverse of {@link routeForPath}. The `NN_` prefixes are not recoverable from a route, so the
 * known content paths have to be supplied — in the app that is `Object.keys(rawPages)`.
 */
export function contentPathForRoute(
  route: string,
  contentPaths: Iterable<string>,
): string | undefined {
  const wanted = normalizeRoute(route);
  for (const contentPath of contentPaths) {
    if (routeForPath(contentPath) === wanted) {
      return contentPath;
    }
  }
  return undefined;
}

/**
 * Human-readable fallback title for a file or folder name, used when a page has neither a
 * frontmatter `title` nor a `# ` heading: `01_GettingStarted` -> `Getting Started`.
 */
export function titleFromName(name: string): string {
  return stripOrder(name.replace(/\.md$/i, ""))
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Slug for a heading's text, matching what `rehype-slug` (github-slugger) produces, so the
 * "On this page" list and the anchors in the rendered DOM agree.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}
