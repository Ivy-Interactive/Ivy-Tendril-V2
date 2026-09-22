/**
 * Minimal History-API router.
 *
 * The repo has no router dependency anywhere today (`tendril-app` switches views through its
 * `uiStore`), and a docs site needs exactly three things: read the current path, push a new one, and
 * re-render when either the user or a link changes it. That is small enough to own outright.
 */
import { useCallback, useEffect, useState } from "react";
import { isSiteLocale } from "../config/locales.config";
import { normalizeRoute, ROUTE_BASE } from "./slug";

/** Fired after a programmatic {@link navigate}, since `pushState` raises no event of its own. */
const NAVIGATE_EVENT = "tendril-docs:navigate";

export interface Location {
  /** Path without trailing slash, query or fragment, e.g. `/docs/concepts/plans`. */
  route: string;
  /** Fragment including the leading `#`, or `""`. */
  hash: string;
}

/**
 * Extracts any base subpath under which the docs are hosted (e.g. `/Ivy-Tendril-V2` on GitHub Pages).
 */
export function getBaseSubpath(): string {
  if (typeof window !== "undefined") {
    const pathname = window.location.pathname;
    const match = /^\/([^/]+)(?=\/|$)/.exec(pathname);
    if (match) {
      const first = match[1];
      if (
        !isSiteLocale(first) &&
        first !== "docs" &&
        first !== "assets" &&
        first !== "api" &&
        first !== "developers" &&
        first !== "about" &&
        first !== "contact" &&
        first !== "privacy" &&
        first !== "mcp"
      ) {
        return `/${first}`;
      }
    }
  }
  const viteBase = typeof import.meta !== "undefined" ? import.meta.env?.BASE_URL : undefined;
  if (viteBase && viteBase !== "/" && viteBase !== "./") {
    return viteBase.replace(/\/+$/, "");
  }
  return "";
}

/** Prepends the app's base subpath to an absolute URL if not already present. */
export function toAppHref(href: string): string {
  const base = getBaseSubpath();
  if (!base || !href.startsWith("/") || href.startsWith(base)) return href;
  return `${base}${href}`;
}

/** Strips the app's base subpath from a pathname. */
export function fromAppPath(pathname: string): string {
  const base = getBaseSubpath();
  if (base && pathname.startsWith(base)) {
    const stripped = pathname.slice(base.length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }
  return pathname;
}

function readLocation(): Location {
  if (typeof window === "undefined") return { route: ROUTE_BASE, hash: "" };
  const cleanPath = fromAppPath(window.location.pathname);
  return { route: normalizeRoute(cleanPath), hash: window.location.hash };
}

/** Pushes a route (optionally with a `#fragment`) and notifies subscribers. */
export function navigate(href: string, options?: { replace?: boolean }): void {
  if (typeof window === "undefined") return;
  const target = toAppHref(href);
  const current = `${window.location.pathname}${window.location.hash}`;
  if (current === target) return;
  if (options?.replace) {
    window.history.replaceState({}, "", target);
  } else {
    window.history.pushState({}, "", target);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Current location, kept in sync with `popstate` and {@link navigate}. */
export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(readLocation);

  useEffect(() => {
    const sync = () => setLocation(readLocation());
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
    };
  }, []);

  return location;
}

/**
 * Click interceptor for anchors rendered from markdown.
 *
 * Returns a handler for the container element rather than per-link, because `MarkdownRenderer` owns
 * the `<a>` elements. A plain left-click on a same-origin `/docs/...` link is handled in-page;
 * modified clicks, new-tab clicks and external links fall through to the browser.
 */
export function useInternalLinkInterceptor(): (event: React.MouseEvent<HTMLElement>) => void {
  return useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = (event.target as HTMLElement | null)?.closest?.("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    if (anchor.getAttribute("target") === "_blank") return;

    event.preventDefault();
    navigate(fromAppPath(href));
  }, []);
}
