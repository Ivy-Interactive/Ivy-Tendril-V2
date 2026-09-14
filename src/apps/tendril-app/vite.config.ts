import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

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
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (
            normalized.includes("node_modules/refractor") ||
            normalized.includes("node_modules/.pnpm/refractor")
          ) {
            return "vendor-refractor";
          }
          if (
            normalized.includes("node_modules/pdfjs-dist") ||
            normalized.includes("node_modules/.pnpm/pdfjs-dist")
          ) {
            return "vendor-pdfjs";
          }
          if (
            normalized.includes("node_modules/react-diff-view") ||
            normalized.includes("node_modules/.pnpm/react-diff-view") ||
            normalized.includes("node_modules/diff") ||
            normalized.includes("node_modules/.pnpm/diff")
          ) {
            return "vendor-diff";
          }
          if (
            normalized.includes("node_modules/mermaid") ||
            normalized.includes("node_modules/.pnpm/mermaid")
          ) {
            return "vendor-mermaid";
          }
          if (
            normalized.includes("node_modules/@hpcc-js") ||
            normalized.includes("node_modules/.pnpm/@hpcc-js")
          ) {
            return "vendor-graphviz";
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
