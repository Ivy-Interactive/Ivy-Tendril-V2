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
    entry: [
      "src/index.ts",
      "src/ui.ts",
      "src/renderers.ts",
      "src/tendril.ts",
      "src/diagrams.ts",
      "src/charts.ts",
      "src/theme.ts",
    ],
    format: ["esm"],
    dts: {
      tsgo: {},
    },
    clean: true,
    sourcemap: true,
  },
  lint: {
    plugins: ["unicorn", "typescript", "oxc", "import"],
    rules: {
      "import/no-default-export": "error",
    },
    overrides: [
      {
        files: [
          "**/*.stories.tsx",
          "vite.config.ts",
          ".storybook/**",
          "tests/global-setup.ts",
          "**/*.d.ts",
        ],
        rules: {
          "import/no-default-export": "off",
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
  },
});
