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
        // The list has to name every package that reaches React from that nested store, not just the
        // ones imported directly: `@tanstack/react-virtual` is pulled in by `DataTable`'s virtualizer
        // and `react-remove-scroll` by Radix's dialog/popover, and both were resolving to the nested
        // copy — so every test that rendered a table died on a null `useReducer` and every test that
        // opened a dialog on a null `useRef`, in both cases reported as "more than one copy of React".
        inline: [
          /@ivy-interactive\/components/,
          /@dnd-kit/,
          /@radix-ui/,
          /@tanstack\/react-virtual/,
          /react-remove-scroll/,
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
