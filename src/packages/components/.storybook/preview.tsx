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
    // SB9 replaced the `values` array + `default` name with an `options` map keyed by the value
    // the `backgrounds` global takes; the selected one now lives in `initialGlobals` below.
    backgrounds: {
      options: {
        light: { name: "Light", value: "#ffffff" },
        dark: { name: "Dark", value: "#0a0a0a" },
      },
    },
    a11y: {
      config: {},
      options: {},
    },
  },
  decorators: [
    (Story: React.ComponentType, context: { globals?: StorybookGlobals; viewMode?: string }) => {
      const { theme = "light", density = Densities.Medium } = readStoryGlobals(context);
      const densityValue = density as Densities;
      // `min-h-screen` gives a story its own canvas to lay out against, which is right in story
      // view where the iframe *is* the viewport. A docs page inlines every story into one scrolling
      // column, so there the same rule floors each preview at a full viewport height regardless of
      // what it renders: the ErrorBoundary demo is 372px of card in a 900px block, and the rest is
      // dead white space the reader has to scroll past to reach the next section. Docs previews are
      // sized by their content instead.
      const canvasHeight = context.viewMode === "docs" ? "" : " min-h-screen";
      return (
        <div
          data-density={densityValue.toLowerCase()}
          className={
            theme === "dark"
              ? `dark bg-background text-foreground p-6${canvasHeight}`
              : `bg-background text-foreground p-6${canvasHeight}`
          }
        >
          <DensityProvider density={densityValue}>
            <Story />
          </DensityProvider>
        </div>
      );
    },
  ],
  // SB9 stopped reading `defaultValue` off `globalTypes`; every default now comes from
  // `initialGlobals`, which is also where the backgrounds selection moved.
  initialGlobals: {
    backgrounds: { value: "light" },
    theme: "light",
    density: "Medium",
  },
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global theme for components",
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
