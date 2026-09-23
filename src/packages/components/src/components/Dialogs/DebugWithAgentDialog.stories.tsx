import type { Meta, StoryObj } from "@storybook/react";
import { DebugWithAgentDialog } from "./DebugWithAgentDialog";

/**
 * V1's `DebugWithAgentDialog` (a `#if DEBUG` tool): one optional question, then a chat with the job's
 * debug details and the `/tendril-debug-job` skill, in the configured coding agent.
 */
const meta: Meta<typeof DebugWithAgentDialog> = {
  title: "Dialogs/DebugWithAgentDialog",
  component: DebugWithAgentDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {}, agentLabel: "Claude" },
};

export default meta;
type Story = StoryObj<typeof DebugWithAgentDialog>;

/** The configured agent is Claude. */
export const Default: Story = {};

/** Another agent: the title and the button follow the configuration. */
export const OtherAgent: Story = { args: { agentLabel: "Codex" } };

/** Starting the chat. */
export const Busy: Story = { args: { isBusy: true } };

/** The chat could not be started. */
export const Failed: Story = {
  args: { error: "Could not start a chat: Tendril service is not running" },
};
