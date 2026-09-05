import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(configDir, "../src");

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)", "../src/**/*.mdx"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-a11y", "@storybook/addon-interactions"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  viteFinal(viteConfig) {
    const existingAlias = viteConfig.resolve?.alias;
    return {
      ...viteConfig,
      resolve: {
        ...viteConfig.resolve,
        alias: Array.isArray(existingAlias)
          ? [...existingAlias, { find: "@", replacement: srcDir }]
          : { ...existingAlias, "@": srcDir },
      },
    };
  },
};

export default config;
