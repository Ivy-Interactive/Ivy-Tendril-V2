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
        /* `@radix-ui` is inlined for the same reason as the components package itself. Externalized,
           it is loaded by Node's own resolution and picks up the `react` installed beside it under
           `packages/components/node_modules` — a second React, so every Radix hook throws "Cannot
           read properties of null (reading 'useRef')". Inlined, it resolves `react` through the
           alias below like the rest of the graph. This does not reach the CJS-only `dist/es5` build
           of `react-remove-scroll` behind Radix's `Dialog`, which Vite externalizes either way; a
           test that would mount a dialog shims it instead (see `tests/vault-settings-view.test.tsx`). */
        inline: [/@ivy-interactive\/components/, /@dnd-kit/, /@radix-ui/],
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
