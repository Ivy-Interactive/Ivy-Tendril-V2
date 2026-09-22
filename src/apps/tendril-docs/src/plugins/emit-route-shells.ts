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
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { buildNavTree, flattenNavRoutes } from "../lib/nav";
import { parsePages } from "../lib/page";
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

    // `writeBundle`, not `generateBundle`: the HTML asset is produced by Vite's own HTML plugin
    // during `generateBundle`, and a plugin cannot rely on running after it. By `writeBundle` the
    // shell is on disk, so copying it is order-independent.
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir;
      if (!outDir) {
        this.warn("No output directory — route shells were not emitted.");
        return;
      }

      const shellPath = path.join(outDir, "index.html");
      let shell: string;
      try {
        shell = readFileSync(shellPath, "utf8");
      } catch {
        this.warn(`No ${shellPath} — route shells were not emitted.`);
        return;
      }

      const files = readContentFiles(options.contentDir);
      const pages = parsePages(files);

      for (const route of routes) {
        const fileName = shellPathForRoute(route, base);
        if (!fileName) continue;
        const target = path.join(outDir, fileName);
        mkdirSync(path.dirname(target), { recursive: true });

        const page = [...pages.values()].find((p) => p.route === route);
        if (page) {
          const pageTitle = `${page.title} · Tendril Docs`;
          const pageDesc = page.description || page.title;
          const previewHtml = `<main style="max-width:850px;margin:2rem auto;padding:1.5rem;font-family:system-ui,-apple-system,sans-serif;color:#1f2937"><h1>${escapeHtml(page.title)}</h1>${page.description ? `<p style="font-size:1.15rem;color:#4b5563;margin-bottom:1.5rem">${escapeHtml(page.description)}</p>` : ""}<article>${renderSimpleMarkdownToHtml(page.body)}</article></main>`;
          const customized = shell
            .replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(pageTitle)}</title>`)
            .replace(
              "</head>",
              `  <meta name="description" content="${escapeHtml(pageDesc)}">\n  <link rel="canonical" href="${route}">\n</head>`,
            )
            .replace('<div id="root"></div>', `<div id="root">${previewHtml}</div>`);
          writeFileSync(target, customized);
        } else {
          writeFileSync(target, shell);
        }
      }
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderSimpleMarkdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const htmlParts: string[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        htmlParts.push(
          `<pre style="background:#f3f4f6;padding:1rem;border-radius:6px;overflow-x:auto"><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`,
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("### ")) {
      htmlParts.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      htmlParts.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      htmlParts.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      htmlParts.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
    } else if (trimmed.startsWith("> ")) {
      htmlParts.push(
        `<blockquote style="border-left:4px solid #3b82f6;padding-left:1rem;color:#4b5563">${escapeHtml(trimmed.slice(2))}</blockquote>`,
      );
    } else {
      htmlParts.push(`<p>${escapeHtml(trimmed)}</p>`);
    }
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    htmlParts.push(
      `<pre style="background:#f3f4f6;padding:1rem;border-radius:6px;overflow-x:auto"><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`,
    );
  }

  return htmlParts.join("\n");
}
