import { useEffect, useMemo, useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { TuiKbd } from "@ivy-interactive/components/ui";
import { cn } from "../lib/cn";
import {
  homeRoute as defaultHomeRoute,
  navTree,
  pageForRoute,
  pages,
  resolveAsset,
} from "../content";
import { flattenNavRoutes, localizeNavTree, type NavSection } from "../lib/nav";
import type { DocPage as DocPageModel } from "../lib/page";
import { navigate, toAppHref } from "../lib/router";
import { ROUTE_BASE, normalizeRoute } from "../lib/slug";
import { SITE_LOCALES, getLocale, localizePath, splitLocale } from "../config/locales.config";
import { getTranslations } from "../config/translations";
import { DocPage } from "./DocPage";
import { DocsSidebar } from "./DocsSidebar";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NotFound } from "./NotFound";
import { SearchDialog } from "./SearchDialog";
import { ThemeToggle } from "./ThemeToggle";

interface DocsLayoutProps {
  route: string;
  hash?: string;
  /** Overridable so tests can render an isolated fixture tree instead of `content/`. */
  sections?: NavSection[];
  lookupPage?: (route: string) => DocPageModel | undefined;
  allPages?: Iterable<DocPageModel>;
}

/** Previous/next links, in reading order across the whole site. */
function useNeighbours(
  sections: NavSection[],
  route: string,
  lookup: (route: string) => DocPageModel | undefined,
) {
  return useMemo(() => {
    const routes = flattenNavRoutes(sections);
    const at = routes.indexOf(route);
    if (at < 0) return { previous: undefined, next: undefined };
    return {
      previous: at > 0 ? lookup(routes[at - 1]) : undefined,
      next: at + 1 < routes.length ? lookup(routes[at + 1]) : undefined,
    };
  }, [sections, route, lookup]);
}

function PageLink({
  page,
  direction,
  label,
}: {
  page: DocPageModel;
  direction: "previous" | "next";
  label?: string;
}) {
  const fallbackLabel = direction === "previous" ? "Previous" : "Next";
  return (
    <a
      href={page.route}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(page.route);
      }}
      className={cn(
        "flex flex-col gap-0.5 rounded-box border border-border px-4 py-3 transition-colors hover:bg-secondary/60",
        direction === "next" && "items-end text-right",
      )}
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label ?? fallbackLabel}
      </span>
      <span className="text-sm font-medium">{page.title}</span>
    </a>
  );
}

/** The "On this page" rail: level 2 and 3 headings of the current page. */
function OnThisPage({ page, label }: { page: DocPageModel; label?: string }) {
  const headings = page.headings.filter((heading) => heading.depth === 2 || heading.depth === 3);
  if (headings.length < 2) return null;

  return (
    <aside className="docs-rail hidden w-56 shrink-0 xl:block" aria-label={label ?? "On this page"}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label ?? "On this page"}
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {headings.map((heading) => (
          <li key={heading.id} style={{ paddingInlineStart: heading.depth === 3 ? "0.75rem" : 0 }}>
            <a
              href={`#${heading.id}`}
              className="block truncate text-muted-foreground transition-colors hover:text-foreground"
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * The whole site chrome: header, section sidebar, article, "On this page" rail and pager.
 *
 * The content sources are props with `content.ts` defaults so `docs-layout.test.tsx` can render a
 * fixture tree, but the shipping site always renders the real `content/` folder.
 */
export function DocsLayout({
  route,
  hash = "",
  sections = navTree,
  lookupPage = pageForRoute,
  allPages,
}: DocsLayoutProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const normalized = normalizeRoute(route);
  const { locale: activeLocaleCode } = splitLocale(normalized);
  const activeLocale = getLocale(activeLocaleCode);
  const t = getTranslations(activeLocaleCode);

  const localizedSections = useMemo(
    () => localizeNavTree(sections, activeLocaleCode),
    [sections, activeLocaleCode],
  );

  const rawHomeRoute = flattenNavRoutes(sections)[0] ?? defaultHomeRoute;
  const homeRoute = localizePath(rawHomeRoute, activeLocaleCode);

  const isRootOrBase =
    normalized === ROUTE_BASE ||
    normalized === "" ||
    normalized === "/" ||
    normalized === "/docs" ||
    normalized === ROUTE_BASE.replace(/\/docs$/, "") ||
    normalized === `/${activeLocaleCode}` ||
    normalized === `/${activeLocaleCode}/` ||
    normalized === `/${activeLocaleCode}/docs` ||
    normalized === `/${activeLocaleCode}${ROUTE_BASE}`;

  // The base route itself has no page of its own; it is the first page of the first section.
  const effectiveRoute = isRootOrBase ? homeRoute : normalized;
  const page = lookupPage(effectiveRoute);
  const { previous, next } = useNeighbours(localizedSections, effectiveRoute, lookupPage);
  const searchPages = allPages ?? pages.values();

  useEffect(() => {
    if (isRootOrBase && homeRoute !== normalized) {
      navigate(homeRoute, { replace: true });
    }
  }, [isRootOrBase, homeRoute, normalized]);

  useEffect(() => {
    if (page) document.title = `${page.title} · Tendril Docs`;
  }, [page]);

  // Synchronize document <head> metadata (lang, dir, canonical, og:locale, hreflang alternates)
  useEffect(() => {
    if (typeof document === "undefined") return;

    // 1. html lang & dir
    document.documentElement.lang = activeLocale.hreflang;
    document.documentElement.dir = activeLocale.dir;

    // 2. og:locale
    let ogLocaleMeta = document.querySelector('meta[property="og:locale"]');
    if (!ogLocaleMeta) {
      ogLocaleMeta = document.createElement("meta");
      ogLocaleMeta.setAttribute("property", "og:locale");
      document.head.appendChild(ogLocaleMeta);
    }
    ogLocaleMeta.setAttribute("content", activeLocale.ogLocale);

    // 3. canonical link
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute("href", `https://docs.ivy.app${effectiveRoute}`);

    // 4. alternate hreflang tags (10 locales + x-default = 11 tags)
    document
      .querySelectorAll('link[rel="alternate"][data-tendril-hreflang]')
      .forEach((el) => el.remove());

    const canonicalPath = splitLocale(effectiveRoute).path;

    // x-default pointing to English URL
    const xDefaultLink = document.createElement("link");
    xDefaultLink.setAttribute("rel", "alternate");
    xDefaultLink.setAttribute("hreflang", "x-default");
    xDefaultLink.setAttribute("href", `https://docs.ivy.app${canonicalPath}`);
    xDefaultLink.setAttribute("data-tendril-hreflang", "true");
    document.head.appendChild(xDefaultLink);

    for (const loc of SITE_LOCALES) {
      const link = document.createElement("link");
      link.setAttribute("rel", "alternate");
      link.setAttribute("hreflang", loc.hreflang);
      link.setAttribute("href", `https://docs.ivy.app${localizePath(canonicalPath, loc.code)}`);
      link.setAttribute("data-tendril-hreflang", "true");
      document.head.appendChild(link);
    }
  }, [effectiveRoute, activeLocale]);

  // A deep link carrying a fragment lands before the markdown has rendered, so the browser's own
  // anchor scroll finds nothing. Retry once the article is in the DOM.
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, effectiveRoute]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [effectiveRoute]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-[100rem] items-center gap-3 px-4">
          <button
            type="button"
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((value) => !value)}
            className="inline-flex size-8 items-center justify-center rounded-field text-muted-foreground hover:bg-secondary/60 hover:text-foreground lg:hidden"
          >
            {drawerOpen ? (
              <X className="size-4" aria-hidden="true" />
            ) : (
              <Menu className="size-4" aria-hidden="true" />
            )}
          </button>

          <a
            href={toAppHref(homeRoute)}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              navigate(homeRoute);
            }}
            className="flex items-center gap-2 font-semibold"
          >
            <span>Tendril</span>
            <span className="text-muted-foreground">Docs</span>
          </a>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="inline-flex items-center gap-2 rounded-field border border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Search className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t.search}</span>
            <span className="hidden sm:inline">
              <TuiKbd keys="⌘K" variant="outline" />
            </span>
          </button>

          <LanguageSwitcher route={effectiveRoute} hash={hash} />

          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto flex max-w-[100rem] gap-8 px-4 py-8">
        <div
          className={cn(
            "docs-rail w-64 shrink-0 lg:block",
            drawerOpen ? "block" : "hidden",
            drawerOpen &&
              "fixed inset-x-0 bottom-0 top-14 z-20 overflow-y-auto border-r border-border bg-background p-4 lg:static lg:inset-auto lg:p-0",
          )}
        >
          <div className="flex flex-col gap-4">
            <div className="lg:hidden pb-3 border-b border-border">
              <LanguageSwitcher
                route={effectiveRoute}
                hash={hash}
                className="w-full justify-between"
                onSelect={() => setDrawerOpen(false)}
              />
            </div>
            <DocsSidebar
              sections={localizedSections}
              activeRoute={effectiveRoute}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>

        <main className="min-w-0 flex-1">
          {page ? (
            <>
              <DocPage page={page} resolveAsset={resolveAsset} locale={activeLocaleCode} />
              {(previous || next) && (
                <nav
                  aria-label="Page navigation"
                  className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2"
                >
                  {previous ? (
                    <PageLink page={previous} direction="previous" label={t.previous} />
                  ) : (
                    <span />
                  )}
                  {next ? <PageLink page={next} direction="next" label={t.next} /> : <span />}
                </nav>
              )}
            </>
          ) : (
            <NotFound route={normalized} homeRoute={homeRoute} locale={activeLocaleCode} />
          )}
        </main>

        {page && <OnThisPage page={page} label={t.onThisPage} />}
      </div>

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        pages={searchPages}
        locale={activeLocaleCode}
      />
    </div>
  );
}
