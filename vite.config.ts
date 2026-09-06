import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
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
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [
        path.resolve(__dirname),
        "/Users/rorychatt/git/components-storybook",
      ],
    },
  },
  clearScreen: false,
});
