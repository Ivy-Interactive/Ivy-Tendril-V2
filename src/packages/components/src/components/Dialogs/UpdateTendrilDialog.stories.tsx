import type { Meta, StoryObj } from "@storybook/react";
import { UpdateTendrilDialog } from "./UpdateTendrilDialog";

/**
 * The update dialog, opened from the update banner's Show Details. V1's
 * `AppShell/Dialogs/UpdateTendrilDialog.cs`.
 *
 * One story per V1 branch. V2 has no self-updater wired yet (the Tauri updater plugin is declared in
 * `tauri.conf.json` but not installed), so the app only ever shows **ManualCommand** today; the
 * other three are the contract a self-update will drive.
 */
const meta: Meta<typeof UpdateTendrilDialog> = {
  title: "Dialogs/UpdateTendrilDialog",
  component: UpdateTendrilDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onUpdate: () => {},
    currentVersion: "2.3.1",
    latestVersion: "2.4.0",
    updateCommand: "curl -sSf https://cdn.ivy.app/install-tendril.sh | sh",
    canSelfUpdate: true,
  },
};

export default meta;
type Story = StoryObj<typeof UpdateTendrilDialog>;

/** Self-update available: Cancel and Update Now. */
export const SelfUpdate: Story = {};

/** Mid-update: the step, the bar, and no way out - Escape and the overlay do nothing. */
export const Progress: Story = {
  args: { progress: 42, statusText: "Downloading Tendril 2.4.0..." },
};

/** Just started, before the first progress report: the generic "Updating..." line. */
export const Starting: Story = { args: { progress: 0 } };

/** The attempt failed: the reason, with Retry and Cancel. */
export const FailedWithRetry: Story = {
  args: {
    error:
      "Could not download https://releases.tendril.spacecorps.dev/desktop/windows/x86_64/2.3.1: the signature did not verify.",
  },
};

/** No self-update for this install: the terminal command (Windows here) and OK. */
export const ManualCommand: Story = {
  args: {
    canSelfUpdate: false,
    updateCommand: "irm https://cdn.ivy.app/install-tendril.ps1 | iex",
  },
};
