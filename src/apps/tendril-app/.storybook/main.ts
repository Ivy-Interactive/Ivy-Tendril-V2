import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook for the **app** package.
 *
 * A second instance, beside the one in `packages/components`, and deliberately so. The dialogs and
 * sheets live here because they bind to app state - the stores, the Tauri bridge, `types/api` - so
 * they cannot move into the component library without inverting the dependency: the app depends on
 * components, not the other way round. Pointing the components instance at this package's source
 * would create that inversion in its Vite graph.
 *
 * Pinned to the same `^8.6.18` the components package uses. Two Storybook installs in one workspace
 * that resolve to different `@storybook/core` versions break each other in confusing ways. Verified
 * after install: pnpm resolves a single `storybook@8.6.18`, so both packages share one core.
 *
 * **If `storybook dev` exits silently right after "Starting preview.." with status 3221225477**
 * (0xC0000005), that is not this config. It is the Vite+ native bindings - `vite-plus` and
 * `lightningcss` - being dlopen'd into a process already busy with Storybook's manager build; it
 * reproduces on plain `storybook dev` with no wrapper, at roughly a 40% rate, with empty stderr.
 * The components package fixes it by preloading those bindings via
 * `node --import scripts/storybook-preload.mjs`. That preload is package-local, so this package
 * needs its own copy before the same fix applies here. `storybook build` is unaffected.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: { disableTelemetry: true },
  typescript: {
    // The app's own `tsc --noEmit` is the gate; re-checking types inside the Storybook build
    // doubles the work and reports the same errors twice.
    check: false,
  },
};

export default config;
