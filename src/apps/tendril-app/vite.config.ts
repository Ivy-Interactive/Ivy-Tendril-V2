import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/** `vendor-mermaid` (3.1 MB) and `vendor-graphviz` (798 kB) are single lazy chunks, fetched only when
 * a `mermaid` / `dot` fence is actually rendered, so their size is not an initial-load cost. 1200 kB
 * — the same limit `packages/components/.storybook/main.ts` uses — silences the chunks that are
 * merely large while still flagging a newly oversized *eager* chunk. `vendor-mermaid` still exceeds
 * even 1200 kB and still warns, which is accepted: it is one lazy chunk behind a dynamic import. The
 * real guard on the initial load is the byte budget in `tests/code-splitting.test.tsx`. */
const CHUNK_SIZE_WARNING_LIMIT = 1200;

/** Builds a matcher for a package's own modules. Both node_modules layouts have to match: the flat
 * `node_modules/<pkg>/…` form, and pnpm's virtual store, whose paths embed that same
 * `node_modules/<pkg>/…` tail after a `node_modules/.pnpm/<pkg>@<version>/` prefix. Matching
 * `node_modules/(?:\.pnpm/)?(<pkg>)[@/]` therefore covers a package in either layout and — via the
 * `.pnpm/<pkg>@` form — the private dependency tree pnpm nests underneath it. */
const inPackage = (packages: string) => new RegExp(`node_modules/(?:\\.pnpm/)?(?:${packages})[@/]`);

/** Vite's `__vitePreload` virtual module (`\0vite/preload-helper.js`), imported by every chunk that
 * lazy-loads anything. It is not under `node_modules`, so no package rule can claim it, and an
 * unclaimed shared module gets emitted inside one of its importers' chunks — it landed in
 * `vendor-mermaid`, which gave the entry chunk a static `import{M}from"./vendor-mermaid-*.js"` and
 * made all 3 MB of Mermaid eager. Giving it a chunk of its own — a few hundred bytes that every
 * importer may safely pull in — is what actually keeps the diagram renderers off the initial load. */
const PRELOAD_HELPER = /vite\/preload-helper/;

/** `refractor/core` is the synchronous language registry `PlanDiffView` imports eagerly; the ~600
 * language packs under `lang/` are dynamically imported one at a time. A chunk is a single loading
 * unit, so these must not share one, or the eager registry import drags all 617 kB of language data
 * onto the initial load. Claimed above `SYNTAX` for the priority reason documented on `groups`. */
const REFRACTOR_CORE = /node_modules\/refractor\/lib\/(?:core|prism-core)\./;
const SYNTAX = inPackage("refractor|react-syntax-highlighter|lowlight|prismjs|highlight\\.js");
const PDFJS = inPackage("pdfjs-dist");
const DIFF = inPackage("react-diff-view|diff");
/** Only `mermaid` itself. Its transitive tree (`@mermaid-js/parser`, `cytoscape`, `d3`, `langium`,
 * `layout-base`, …) is deliberately not enumerated: the group absorbs a dependency no
 * higher-priority group claims, so those packages end up in `vendor-mermaid` anyway, and naming them
 * would be guesswork about which of them some eager module also uses. Same for `@hpcc-js` below. */
const MERMAID = inPackage("mermaid");
const GRAPHVIZ = inPackage("@hpcc-js");
const KATEX = inPackage("katex");
const REACT = inPackage("react|react-dom");

export default defineConfig({
  /** `docs/migration/parity-matrix.md` is a 7-column table ~1230 characters wide, and Oxfmt pads
   * every column to its widest cell — so editing one cell re-pads all 18 table lines. Four separate
   * plans (00604, 00613, 00619, 00650) have broken `main`'s Frontend checks by appending a row
   * without re-running the formatter, because a markdown-only edit does not read as "an affected
   * JavaScript or TypeScript package" to the NpmLint gate that would have caught it. Padding in a
   * doc nobody reads as source is not worth a red `main`, so the file is exempt. */
  fmt: {
    ignorePatterns: [
      "dist/**",
      "src-tauri/target/**",
      "node_modules/**",
      "docs/migration/parity-matrix.md",
    ],
  },
  lint: {
    ignorePatterns: ["dist/**", "src-tauri/target/**", "node_modules/**"],
    plugins: ["unicorn", "typescript", "oxc", "import"],
    rules: {
      "import/no-default-export": "error",
    },
    overrides: [
      {
        // CSF requires `export default meta`, and Storybook's own config files are default-export
        // modules too. Same exemption `packages/components/vite.config.ts` already carries, for the
        // same reason: the format is not ours to change.
        files: ["**/*.stories.tsx", ".storybook/**", "vite.config.ts", "vitest.config.ts"],
        rules: {
          "import/no-default-export": "off",
        },
      },
    ],
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
    hmr: process.env.NO_HMR === "1" || process.env.VITE_HMR === "false" ? false : undefined,
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "../../packages/components")],
    },
  },
  build: {
    chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT,
    rollupOptions: {
      output: {
        /** Rolldown's `codeSplitting.groups`, the same form `packages/components/.storybook/main.ts`
         * uses. The older `output.manualChunks` function does *not* work here: vite-plus folds it
         * into one unprioritised group, so the `vendor-runtime` rule below never produces a chunk
         * and the entry keeps its static edge into `vendor-mermaid` (measured: 4,290,781 B eager,
         * versus 1,199,952 B with the groups form).
         *
         * `minSize: 0` keeps small deliberate chunks — `vendor-runtime` is ~1.2 kB — from being
         * merged back into a larger neighbour, which is the whole point of splitting it out.
         *
         * **`priority` is load-bearing, and not only for overlapping tests.** A group also absorbs
         * every dependency that no higher-priority group claims, and groups are resolved in
         * descending priority order. So a package shared between eager code and a lazy heavyweight
         * must be claimed *above* that heavyweight's group, or the heavyweight absorbs it first and
         * the eager importer drags the whole chunk onto the initial load. `vendor-react` sat at
         * priority 20 during development and `react` itself (17 kB) was absorbed into
         * `vendor-syntax`, making all 610 kB of it eager — measured 1,802,771 B of eager JS. Moving
         * `vendor-react` above `vendor-syntax` is what brings that to 1,199,952 B. Same reason
         * `vendor-refractor-core` sits above `vendor-syntax`.
         *
         * The byte budget in `tests/code-splitting.test.tsx` is the regression guard on all of this. */
        codeSplitting: {
          minSize: 0,
          groups: [
            { name: "vendor-react", priority: 110, test: REACT },
            { name: "vendor-runtime", priority: 100, test: PRELOAD_HELPER },
            { name: "vendor-refractor-core", priority: 90, test: REFRACTOR_CORE },
            { name: "vendor-syntax", priority: 80, test: SYNTAX },
            { name: "vendor-pdfjs", priority: 70, test: PDFJS },
            { name: "vendor-diff", priority: 60, test: DIFF },
            { name: "vendor-mermaid", priority: 50, test: MERMAID },
            { name: "vendor-graphviz", priority: 40, test: GRAPHVIZ },
            { name: "vendor-katex", priority: 30, test: KATEX },
          ],
        },
      },
    },
  },
  clearScreen: false,
});
