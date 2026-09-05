import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { aliasEntries } from "./config/alias.ts";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { ...aliasEntries },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
