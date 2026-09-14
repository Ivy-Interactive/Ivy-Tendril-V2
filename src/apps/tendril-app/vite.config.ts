import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/** `vendor-mermaid` (3.1 MB) and `vendor-graphviz` (798 kB) are single lazy chunks, fetched only when
 * a `mermaid` / `dot` fence is actually rendered, so they legitimately exceed any sane threshold.
 * 1200 kB — the same limit `packages/components/.storybook/main.ts` uses — silences the chunks that
 * are merely large while still flagging a newly oversized *eager* chunk. The real guard on the
 * initial load is the byte budget in `tests/code-splitting.test.tsx`, not this warning. */
const CHUNK_SIZE_WARNING_LIMIT = 1200;

/** Builds a matcher for a package's own modules. Both node_modules layouts have to match: the flat
 * `node_modules/<pkg>/…` form, and pnpm's virtual store, whose paths embed that same
 * `node_modules/<pkg>/…` tail after a `node_modules/.pnpm/<pkg>@<version>/` prefix. Matching
 * `node_modules/(?:\.pnpm/)?(<pkg>)[@/]` therefore covers a package in either layout and — via the
 * `.pnpm/<pkg>@` form — the private dependency tree pnpm nests underneath it. */
const inPackage = (packages: string) => new RegExp(`node_modules/(?:\\.pnpm/)?(?:${packages})[@/]`);

/** Vite's `__vitePreload` virtual module (`\0vite/preload-helper.js`), imported by every chunk that
 * lazy-loads anything. It is not under `node_modules`, so the catch-all group below cannot claim it,
 * and an unclaimed shared module gets emitted inside one of its importers' chunks — it landed in
 * `vendor-mermaid`, which gave the entry chunk a static `import{M}from"./vendor-mermaid-*.js"` and
 * made all 3 MB of Mermaid eager. Giving it a chunk of its own — a few hundred bytes that every
 * importer may safely pull in — is what actually keeps the diagram renderers off the initial load. */
const PRELOAD_HELPER = /vite\/preload-helper/;

/** `refractor/core` is the synchronous language registry `PlanDiffView` imports eagerly; the ~600
 * language packs under `lang/` are dynamically imported one at a time. A manual chunk is a single
 * loading unit, so these must not share one, or the eager registry import drags all 617 kB of
 * language data onto the initial load. */
const REFRACTOR_CORE = /node_modules\/refractor\/lib\/(?:core|prism-core)\./;
const SYNTAX = inPackage("refractor|react-syntax-highlighter|lowlight|prismjs|highlight\\.js");
const PDFJS = inPackage("pdfjs-dist");
const DIFF = inPackage("react-diff-view|diff");
/** Mermaid plus its diagram-only dependency tree, mirroring the `vendor-diagrams` group in
 * `packages/components/.storybook/main.ts`. Claiming them explicitly keeps them out of the `vendor`
 * catch-all, which is eager. */
const MERMAID = inPackage(
  "mermaid|cytoscape[^/]*|d3|d3-[^/]+|dagre[^/]*|khroma|dompurify|@braintree/sanitize-url" +
    "|langium|chevrotain|vscode-languageserver-protocol|vscode-languageserver-types" +
    "|vscode-jsonrpc|marked|fastdom",
);
const GRAPHVIZ = inPackage("@hpcc-js");
const KATEX = inPackage("katex");
const REACT = inPackage("react|react-dom");
/** Catch-all, mirroring the `{ name: "vendor", priority: 10, test: /node_modules[/\\]/ }` group in
 * `packages/components/.storybook/main.ts`. Defence in depth against the *next* unclaimed shared
 * dependency landing inside a heavyweight chunk the way the preload helper did — note it could not
 * have claimed the helper itself, which is virtual. Everything reachable only through a dynamic
 * `import()` must be claimed by a rule above this one, or it gets welded into this eager chunk. */
const NODE_MODULES = /node_modules\//;

export default defineConfig({
  fmt: {
    ignorePatterns: ["dist/**", "src-tauri/target/**", "node_modules/**"],
  },
  lint: {
    ignorePatterns: ["dist/**", "src-tauri/target/**", "node_modules/**"],
    options: {
      typeAware: true,
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "../../packages/components")],
    },
  },
  build: {
    chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT,
    rollupOptions: {
      output: {
        // First match wins. The order below is deliberate: the refractor registry is separated from
        // the language packs before the shared syntax rule sees it, and every heavyweight that is
        // only reachable through a dynamic import is claimed before the `vendor` catch-all.
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (PRELOAD_HELPER.test(normalized)) return "vendor-runtime";
          if (REFRACTOR_CORE.test(normalized)) return "vendor-refractor-core";
          if (SYNTAX.test(normalized)) return "vendor-syntax";
          if (PDFJS.test(normalized)) return "vendor-pdfjs";
          if (DIFF.test(normalized)) return "vendor-diff";
          if (MERMAID.test(normalized)) return "vendor-mermaid";
          if (GRAPHVIZ.test(normalized)) return "vendor-graphviz";
          if (KATEX.test(normalized)) return "vendor-katex";
          if (REACT.test(normalized)) return "vendor-react";
          if (NODE_MODULES.test(normalized)) return "vendor";
        },
      },
    },
  },
  clearScreen: false,
});
