import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { emitRouteShells } from "./src/plugins/emit-route-shells";
import { emitAgenticAssets } from "./src/plugins/emit-agentic-assets";

const rawBase = process.env.VITE_BASE_PATH || process.env.BASE_PATH || "/";
const BASE = (rawBase.startsWith("/") ? rawBase : `/${rawBase}`).replace(/\/+$/, "") + "/";

export default defineConfig({
  base: BASE,
  fmt: {
    ignorePatterns: ["dist/**", "node_modules/**"],
  },
  lint: {
    ignorePatterns: ["dist/**", "node_modules/**"],
    plugins: ["unicorn", "typescript", "oxc", "import"],
    rules: {
      "import/no-default-export": "error",
    },
    overrides: [
      {
        files: ["vite.config.ts", "vitest.config.ts"],
        rules: {
          "import/no-default-export": "off",
        },
      },
    ],
    options: {
      typeAware: true,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    emitRouteShells({ contentDir: path.resolve(__dirname, "./content"), base: BASE }),
    emitAgenticAssets({ contentDir: path.resolve(__dirname, "./content"), base: BASE }),
  ],
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
    // Not the app's 5173: the two dev servers are routinely up at the same time, and strictPort
    // false means an already-taken port costs a message rather than a failed start.
    port: 5174,
    strictPort: false,
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "../../packages/components")],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          // refractor is the Prism grammar set behind MarkdownRenderer's syntax highlighting and is
          // by far the biggest dependency here; keeping it in its own chunk keeps the entry small.
          if (
            normalized.includes("node_modules/refractor") ||
            normalized.includes("node_modules/.pnpm/refractor")
          ) {
            return "vendor-refractor";
          }
          if (
            normalized.includes("node_modules/@hpcc-js") ||
            normalized.includes("node_modules/.pnpm/@hpcc-js")
          ) {
            return "vendor-graphviz";
          }
          if (
            normalized.includes("node_modules/mermaid") ||
            normalized.includes("node_modules/.pnpm/mermaid")
          ) {
            return "vendor-mermaid";
          }
          if (
            normalized.includes("node_modules/katex") ||
            normalized.includes("node_modules/.pnpm/katex")
          ) {
            return "vendor-katex";
          }
          if (
            normalized.includes("node_modules/react/") ||
            normalized.includes("node_modules/react-dom/") ||
            normalized.includes("node_modules/.pnpm/react@") ||
            normalized.includes("node_modules/.pnpm/react-dom@")
          ) {
            return "vendor-react";
          }
        },
      },
    },
  },
  clearScreen: false,
});
