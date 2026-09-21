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
import { flattenNavRoutes, type NavSection } from "../lib/nav";
import type { DocPage as DocPageModel } from "../lib/page";
import { navigate } from "../lib/router";
import { ROUTE_BASE, normalizeRoute } from "../lib/slug";
import { DocPage } from "./DocPage";
import { DocsSidebar } from "./DocsSidebar";
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

function PageLink({ page, direction }: { page: DocPageModel; direction: "previous" | "next" }) {
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
        {direction === "previous" ? "Previous" : "Next"}
      </span>
      <span className="text-sm font-medium">{page.title}</span>
    </a>
  );
}

/** The "On this page" rail: level 2 and 3 headings of the current page. */
function OnThisPage({ page }: { page: DocPageModel }) {
  const headings = page.headings.filter((heading) => heading.depth === 2 || heading.depth === 3);
  if (headings.length < 2) return null;

  return (
    <aside className="docs-rail hidden w-56 shrink-0 xl:block" aria-label="On this page">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        On this page
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
  const homeRoute = flattenNavRoutes(sections)[0] ?? defaultHomeRoute;
  // `/docs` itself has no page of its own; it is the first page of the first section.
  const effectiveRoute = normalized === ROUTE_BASE ? homeRoute : normalized;
  const page = lookupPage(effectiveRoute);
  const { previous, next } = useNeighbours(sections, effectiveRoute, lookupPage);
  const searchPages = allPages ?? pages.values();

  useEffect(() => {
    if (page) document.title = `${page.title} · Tendril Docs`;
  }, [page]);

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
            href={homeRoute}
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
            <span className="hidden sm:inline">Search</span>
            <span className="hidden sm:inline">
              <TuiKbd keys="⌘K" variant="outline" />
            </span>
          </button>

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
          <DocsSidebar
            sections={sections}
            activeRoute={effectiveRoute}
            onNavigate={() => setDrawerOpen(false)}
          />
        </div>

        <main className="min-w-0 flex-1">
          {page ? (
            <>
              <DocPage page={page} resolveAsset={resolveAsset} />
              {(previous || next) && (
                <nav
                  aria-label="Page navigation"
                  className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2"
                >
                  {previous ? <PageLink page={previous} direction="previous" /> : <span />}
                  {next ? <PageLink page={next} direction="next" /> : <span />}
                </nav>
              )}
            </>
          ) : (
            <NotFound route={normalized} homeRoute={homeRoute} />
          )}
        </main>

        {page && <OnThisPage page={page} />}
      </div>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} pages={searchPages} />
    </div>
  );
}
