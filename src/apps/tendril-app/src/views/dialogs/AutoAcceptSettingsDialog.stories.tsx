import type { Meta, StoryObj } from "@storybook/react";
import { AutoAcceptSettingsDialog } from "./AutoAcceptSettingsDialog";

/**
 * The Inbox's auto-accept settings: whether assigned GitHub issues are imported automatically, and
 * how often the check runs.
 *
 * The one dialog here with no injection seam of its own — it calls `bridge.getConfig` directly as
 * it opens. In Storybook that call is served by the mock bridge in `.storybook/preview.tsx`, which
 * is why the intervals below render at all. Adding a real seam would mean editing the dialog.
 */
const meta = {
  title: "Dialogs/Shell/AutoAcceptSettingsDialog",
  component: AutoAcceptSettingsDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof AutoAcceptSettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What `Inbox.CheckIntervalMinutes` falls back to when the config has never carried one: 15. */
export const DefaultInterval: Story = {};

/** V1's `refreshToken.Refresh()` — the Auto-Accept badge reads the setting this dialog writes. */
export const NotifiesOnSave: Story = {
  args: { onSaved: () => {} },
};

/** V1's `onRefresh`: a manual check imports issues, so the list behind the dialog is now stale. */
export const NotifiesOnCheck: Story = {
  args: { onChecked: () => {} },
};

/** Both callbacks are optional, and a caller that wants neither must not break the dialog. */
export const NoCallbacks: Story = {};
