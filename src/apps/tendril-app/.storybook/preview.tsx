/// <reference types="vite/client" />
import type { Preview } from "@storybook/react";
import * as React from "react";
import { bridge } from "../src/api/bridge";
import "../src/index.css";

/**
 * Preview for the app package's Storybook.
 *
 * Two jobs beyond theming.
 *
 * **The bridge is stubbed here rather than per story.** Every `cmd_*` call goes through Tauri's
 * `invoke`, which does not exist in a browser: outside the desktop shell it rejects, and a dialog
 * that reads config as it opens would render its error state in every story. Most dialogs take an
 * injection seam and their stories use it (`PlanSearchDialog.search`, `ShareTunnelDialog.api`);
 * `AutoAcceptSettingsDialog` has none and calls `bridge.getConfig` directly, so it is served from
 * here. The stub is deliberately thin - enough to render, not a fake daemon - because a story that
 * needs more than this should be taking a seam instead.
 *
 * **Dialogs render into a portal at `document.body`**, so the decorator's padding never reaches
 * them. `layout: "fullscreen"` in each dialog's meta stops Storybook adding its own inset around an
 * element that is not where the dialog actually is.
 */

if (typeof window !== "undefined") {
  const stub = bridge as unknown as Record<string, unknown>;
  stub.getConfig = async () => ({
    codingAgent: "claude",
    jobTimeout: 30,
    maxConcurrentJobs: 20,
    desktopNotifications: true,
  });
  stub.putConfig = async () => undefined;
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#0a0a0a" },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: "Theme",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: ["light", "dark"],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story: React.ComponentType, context: { globals?: { theme?: string } }) => {
      const theme = context.globals?.theme ?? "light";
      // `dark` on a wrapper is not enough for a portalled dialog, which mounts outside it - so the
      // class goes on <html>, which is where the app itself puts it.
      React.useEffect(() => {
        document.documentElement.classList.toggle("dark", theme === "dark");
      }, [theme]);
      return (
        <div className="bg-background text-foreground min-h-screen p-6">
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
