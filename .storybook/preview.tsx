/// <reference types="vite/client" />
import type { Preview } from "@storybook/react";
import * as React from "react";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../src/styles/globals.css";
import { DensityProvider } from "../src/contexts/density-context";
import { Densities } from "../src/types/density";
import { readStoryGlobals, type StorybookGlobals } from "./globals";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#0a0a0a" },
      ],
    },
    a11y: {
      config: {},
      options: {},
    },
  },
  decorators: [
    (Story: React.ComponentType, context: { globals?: StorybookGlobals }) => {
      const { theme = "light", density = Densities.Medium } = readStoryGlobals(context);
      const densityValue = density as Densities;
      return (
        <div
          data-density={densityValue.toLowerCase()}
          className={
            theme === "dark"
              ? "dark bg-background text-foreground p-6 min-h-screen"
              : "bg-background text-foreground p-6 min-h-screen"
          }
        >
          <DensityProvider density={densityValue}>
            <Story />
          </DensityProvider>
        </div>
      );
    },
  ],
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global theme for components",
      defaultValue: "light",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", icon: "sun", title: "Light" },
          { value: "dark", icon: "moon", title: "Dark" },
        ],
      },
    },
    density: {
      name: "Density",
      description: "Density scale for components",
      defaultValue: "Medium",
      toolbar: {
        icon: "unfold",
        items: [
          { value: "Small", title: "Small (Compact)" },
          { value: "Medium", title: "Medium (Default)" },
          { value: "Large", title: "Large (Relaxed)" },
        ],
      },
    },
  },
};

export default preview;
