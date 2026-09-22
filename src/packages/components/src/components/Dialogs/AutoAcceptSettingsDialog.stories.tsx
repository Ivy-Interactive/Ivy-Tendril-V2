import type { Meta, StoryObj } from "@storybook/react";
import { AutoAcceptSettingsDialog } from "./AutoAcceptSettingsDialog";

/**
 * The Inbox's auto-accept settings: whether assigned GitHub issues are imported automatically, and
 * how often the importer sweeps.
 *
 * Its three daemon calls are props, so a story supplies them directly. The interesting state is the
 * one in between: while the read is still in flight the controls hold their defaults, which is why
 * Save is disarmed until it lands — a chord firing through `isLoading` would write those defaults
 * over the saved settings.
 */
const meta: Meta<typeof AutoAcceptSettingsDialog> = {
  title: "Dialogs/AutoAcceptSettingsDialog",
  component: AutoAcceptSettingsDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    loadSettings: () => Promise.resolve({ autoAccept: false, checkIntervalMinutes: 15 }),
    saveSettings: () => Promise.resolve(),
    runCheck: () => Promise.resolve({ imported: [], skipped: 0 }),
  },
};

export default meta;
type Story = StoryObj<typeof AutoAcceptSettingsDialog>;

/** What `Inbox.CheckIntervalMinutes` falls back to when the config has never carried one: 15. */
export const DefaultInterval: Story = {};

/** Auto-accept on, at the longest interval. */
export const EnabledHourly: Story = {
  args: {
    loadSettings: () => Promise.resolve({ autoAccept: true, checkIntervalMinutes: 60 }),
  },
};

/** The settings read never settles, so Save stays disarmed and the controls hold defaults. */
export const StillLoading: Story = {
  args: { loadSettings: () => new Promise<never>(() => {}) },
};

/** The settings read failed. */
export const LoadFailed: Story = {
  args: { loadSettings: () => Promise.reject(new Error("daemon unreachable")) },
};

/**
 * A manual check that found nothing. The report is what V1's toast could not say: a sweep that
 * found nothing and a sweep already running both leave the list unchanged.
 */
export const CheckFoundNothing: Story = {
  args: { runCheck: () => Promise.resolve({ imported: [], skipped: 4 }) },
};
