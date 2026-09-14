/**
 * Static output for a client-side-routed site.
 *
 * `vp build` emits a single `index.html`. That is enough for a server with a history fallback and
 * useless for a plain static host, where `GET /docs/concepts/plans` has to resolve to a file. This
 * plugin copies the built shell to `<route>/index.html` for every route in the nav tree, so the
 * output directory is a complete static site: deep links load directly, and routing takes over after
 * first paint. No SSR, no prerender dependency.
 *
 * In dev the same route list drives a middleware that rewrites deep links to the shell, because
 * Vite's HTML fallback only fires for URLs ending in `/` or `.html`.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { buildNavTree, flattenNavRoutes } from "../lib/nav";
import { ROUTE_BASE } from "../lib/slug";

export interface EmitRouteShellsOptions {
  /** Absolute path to the `content/` directory. */
  contentDir: string;
  /** Vite `base`, e.g. `/docs/`. Defaults to `${ROUTE_BASE}/`. */
  base?: string;
}

/** Reads every `.md` file under `contentDir` into the `content-relative path -> source` record. */
export function readContentFiles(contentDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const entries = readdirSync(contentDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const absolute = path.join(entry.parentPath ?? contentDir, entry.name);
    const contentPath = path.relative(contentDir, absolute).split(path.sep).join("/");
    files[contentPath] = readFileSync(absolute, "utf8");
  }
  return files;
}

/**
 * Every route the site must serve, derived from `content/` exactly the way the browser derives it.
 *
 * Exported so `tests/build-output.test.ts` can assert the static contract without running a build.
 */
export function routesForContent(contentDir: string): string[] {
  return flattenNavRoutes(buildNavTree(readContentFiles(contentDir)));
}

/** Path of the shell to emit for `route`, relative to the build output directory. */
export function shellPathForRoute(route: string, base: string): string | undefined {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (!route.startsWith(prefix.slice(0, -1))) return undefined;
  const relative = route.slice(prefix.length - 1).replace(/^\/+/, "");
  // The base route itself is already the build's own index.html.
  return relative.length > 0 ? `${relative}/index.html` : undefined;
}

export function emitRouteShells(options: EmitRouteShellsOptions): Plugin {
  const base = options.base ?? `${ROUTE_BASE}/`;
  let routes: string[] = [];

  return {
    name: "tendril-docs:emit-route-shells",

    buildStart() {
      // Re-read per build so a content file added mid-session is picked up, and so a section folder
      // missing its _Index.md fails the build here rather than at runtime in the browser.
      const files = readContentFiles(options.contentDir);
      routes = flattenNavRoutes(buildNavTree(files));
      for (const contentPath of Object.keys(files)) {
        this.addWatchFile(path.join(options.contentDir, contentPath));
      }
    },

    configureServer(server) {
      const prefix = base.endsWith("/") ? base : `${base}/`;
      server.middlewares.use((request, _response, next) => {
        const url = request.url ?? "/";
        const accepts = request.headers.accept ?? "";
        if (!accepts.includes("text/html")) return next();
        const [pathname] = url.split("?");
        if (!pathname.startsWith(prefix) || path.extname(pathname) !== "") return next();
        request.url = `${prefix}index.html${url.slice(pathname.length)}`;
        next();
      });
    },

    generateBundle(_outputOptions, bundle) {
      const shell = Object.values(bundle).find(
        (chunk) => chunk.type === "asset" && chunk.fileName === "index.html",
      );
      if (!shell || shell.type !== "asset") {
        this.warn("No index.html in the bundle — route shells were not emitted.");
        return;
      }

      for (const route of routes) {
        const fileName = shellPathForRoute(route, base);
        if (!fileName) continue;
        this.emitFile({ type: "asset", fileName, source: shell.source });
      }
    },
  };
}
