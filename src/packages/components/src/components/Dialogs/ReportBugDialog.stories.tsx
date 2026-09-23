import type { Meta, StoryObj } from "@storybook/react";
import { ReportBugDialog } from "./ReportBugDialog";

/**
 * V1's `ReportBugDialog`, from the Job Debug sheet: a description, an optional GitHub username, and a
 * public GitHub issue with the job's logs and a sanitized config attached. Send is disabled until
 * there is a description.
 */
const meta: Meta<typeof ReportBugDialog> = {
  title: "Dialogs/ReportBugDialog",
  component: ReportBugDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onSubmit: () => {} },
};

export default meta;
type Story = StoryObj<typeof ReportBugDialog>;

/** Empty: the warning is read before anything is typed, and Send is disarmed. */
export const Default: Story = {};

/** Uploading: every control is disabled until the issue comes back. */
export const Sending: Story = { args: { isBusy: true } };

/** The upload failed; the reason stays with the form so nothing typed is lost. */
export const Failed: Story = {
  args: {
    error:
      "Failed to submit bug report: Bug report upload failed with status 502 Bad Gateway: upstream timed out",
  },
};
