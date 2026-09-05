import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(configDir, "../src");

const config: StorybookConfig = {
  // No `*.mdx` glob: there are no MDX docs pages yet, and an unmatched glob makes Storybook
  // print `WARN No story files found for the specified pattern`. Re-adding it also requires
  // switching `test-storybook` to `--index-json` — the runner's default mode collects `.mdx`
  // into jest's `testMatch` but has no transform for it. See tests/storybook-mdx.test.ts.
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-a11y", "@storybook/addon-interactions"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["./public"],
  core: {
    disableTelemetry: true,
  },
  viteFinal(viteConfig) {
    const existingAlias = viteConfig.resolve?.alias;
    let alias;
    if (Array.isArray(existingAlias)) {
      alias = [...existingAlias, { find: "@", replacement: srcDir }];
    } else if (existingAlias) {
      alias = { ...(existingAlias as Record<string, string>), "@": srcDir };
    } else {
      alias = { "@": srcDir };
    }
    return {
      ...viteConfig,
      resolve: {
        ...viteConfig.resolve,
        alias,
      },
    };
  },
};

export default config;
