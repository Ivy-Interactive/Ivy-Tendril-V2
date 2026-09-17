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
        // `useReducer`. Naming it here fixes 169 of them.
        //
        // `react-remove-scroll` is the same shape and is deliberately *not* listed: Radix's dialog and
        // popover pull it in and it still binds the nested copy, but inlining it changes nothing,
        // because the build that gets loaded is its CJS `dist/es5`, whose `require("react")` the alias
        // below never sees. Those tests stay red until the nested copy goes away — `react` is in
        // `packages/components`'s `dependencies` as well as its `peerDependencies`, and belongs in
        // `devDependencies` instead, which is a lockfile change rather than a config one.
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
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
    },
  },
});
