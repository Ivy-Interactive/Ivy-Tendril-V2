import { defineConfig } from "vite-plus/test/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "**/*_tests.ts"],
    execArgv: ["--no-experimental-webstorage"],
    server: {
      deps: {
        // Radix is inlined for the same reason as the components bundle: resolved from
        // `packages/components/node_modules` it binds that package's own React, so a dialog rendered
        // from a test whose graph does not already pull in the components entry dies on a null
        // `useRef`. The root cause is the nested store under `packages/components`; this is the fix
        // that works without a reinstall.
        //
        // The list has to name packages that reach React from that nested store even when nothing
        // imports them directly. `@tanstack/react-virtual` is one: `DataTable`'s virtualizer pulls it
        // in, it bound the nested copy, and every test that rendered a table died on a null
        // `useReducer`.
        //
        // The nested store itself is not a mistake to be removed: `packages/components` has its own
        // `pnpm-workspace.yaml` and lockfile, so it is a separate project and installs its own React by
        // design. Which is why the fix is `mainFields` below rather than a dependency change.
        inline: [
          /@ivy-interactive\/components/,
          /@dnd-kit/,
          /@radix-ui/,
          /@tanstack\/react-virtual/,
        ],
      },
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "../../packages/components")],
    },
  },
  resolve: {
    /**
     * Prefer a dependency's ESM build over its CJS one, which is what stops a second React being
     * loaded — the cause of "more than one copy of React in the same app" across this suite.
     *
     * Under Node, Vitest resolves `main` first, and `main` is the CJS build for a package that ships
     * both. A CJS module is loaded by Node rather than processed by Vite, so its `require("react")`
     * never reaches the `alias` below and resolves relative to *its own* location — for anything under
     * `packages/components/node_modules`, that is that project's own React. `react-remove-scroll` (which
     * Radix's dialog and popover pull in) is exactly that shape: `main` is `dist/es5`, `module` is
     * `dist/es2015`, and every test that opened a dialog died on a null `useRef`.
     *
     * Taking `module` first puts those packages back in Vite's graph, where the alias applies and there
     * is one React again. `main` stays last, so a package with no ESM build is unaffected.
     */
    mainFields: ["module", "jsnext:main", "jsnext", "main"],
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
    },
  },
});
