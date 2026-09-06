import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
  server: {
    fs: {
      allow: [
        path.resolve(__dirname),
        "/Users/rorychatt/git/components-storybook",
      ],
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "components-storybook": path.resolve("/Users/rorychatt/git/components-storybook/dist"),
      "@spacecorps/components-storybook": path.resolve("/Users/rorychatt/git/components-storybook/dist"),
    },
  },
});
