import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { aliasEntries } from "./config/alias.ts";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { ...aliasEntries },
  },
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["src/index.ts", "src/ui.ts", "src/renderers.ts", "src/tendril.ts", "src/diagrams.ts"],
    format: ["esm"],
    dts: {
      tsgo: true,
    },
    clean: true,
    sourcemap: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
