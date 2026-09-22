/**
 * Minimal History-API router.
 *
 * The repo has no router dependency anywhere today (`tendril-app` switches views through its
 * `uiStore`), and a docs site needs exactly three things: read the current path, push a new one, and
 * re-render when either the user or a link changes it. That is small enough to own outright.
 */
import { useCallback, useEffect, useState } from "react";
import { normalizeRoute, ROUTE_BASE } from "./slug";

/** Fired after a programmatic {@link navigate}, since `pushState` raises no event of its own. */
const NAVIGATE_EVENT = "tendril-docs:navigate";

export interface Location {
  /** Path without trailing slash, query or fragment, e.g. `/docs/concepts/plans`. */
  route: string;
  /** Fragment including the leading `#`, or `""`. */
  hash: string;
}

function readLocation(): Location {
  if (typeof window === "undefined") return { route: ROUTE_BASE, hash: "" };
  return { route: normalizeRoute(window.location.pathname), hash: window.location.hash };
}

/** Pushes a route (optionally with a `#fragment`) and notifies subscribers. */
export function navigate(href: string, options?: { replace?: boolean }): void {
  if (typeof window === "undefined") return;
  const current = `${window.location.pathname}${window.location.hash}`;
  if (current === href) return;
  if (options?.replace) {
    window.history.replaceState({}, "", href);
  } else {
    window.history.pushState({}, "", href);
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
    navigate(href);
  }, []);
}
