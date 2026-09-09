import { defineConfig } from "vite-plus/test/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { resolveStorybookRoot } from "./scripts/storybook-path.mjs";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "**/*_tests.ts"],
    poolOptions: {
      forks: { execArgv: ["--no-experimental-webstorage"] },
      threads: { execArgv: ["--no-experimental-webstorage"] },
    },
    server: {
      deps: {
        inline: [/components-storybook/, /@dnd-kit/],
      },
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname), resolveStorybookRoot()],
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
