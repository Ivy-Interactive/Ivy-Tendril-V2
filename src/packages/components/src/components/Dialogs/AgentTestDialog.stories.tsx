import type { Meta, StoryObj } from "@storybook/react";
import { AgentTestDebugDialog, AgentTestDialog, type AgentTestRow } from "./AgentTestDialog";

const PASSED: AgentTestRow[] = [
  { label: "Installation", status: "passed", message: "v2.1.0" },
  { label: "Authentication", status: "passed", message: "Authenticated (anthropic-api)" },
  { label: "Model: Claude Opus 5", status: "passed", message: "Ok" },
  { label: "Model: Claude Sonnet 5", status: "passed", message: "Ok" },
  { label: "Model: Default", status: "passed", message: "Ok" },
];

/**
 * V1's `Apps/Settings/Dialogs/AgentTestDialog.cs`, opened from a coding agent card's *Test*, and its
 * `AgentTestDebugDialog.cs` behind each row's Bug button.
 *
 * The rows arrive already worded — the app builds them from the daemon's reply — so these stories
 * are the shapes a run goes through: seeded, answered, short-circuited and failed.
 */
const meta: Meta<typeof AgentTestDialog> = {
  title: "Dialogs/AgentTestDialog",
  component: AgentTestDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, rows: PASSED },
};

export default meta;
type Story = StoryObj<typeof AgentTestDialog>;

/** Before the reply: every check seeded Pending, and the footer offers Cancel. */
export const Running: Story = {
  args: {
    isTesting: true,
    rows: [
      { label: "Installation", status: "running" },
      { label: "Authentication", status: "pending" },
      { label: "Model: Claude Opus 5", status: "pending" },
      { label: "Model: Default", status: "pending" },
    ],
  },
};

/** Everything answered. */
export const AllPassed: Story = {};

/** Signed out: the one row that says what to *do*, with the raw error behind the Bug button. */
export const NotAuthenticated: Story = {
  args: {
    rows: [
      { label: "Installation", status: "passed", message: "v2.1.0" },
      {
        label: "Authentication",
        status: "failed",
        message: "Not authenticated - run `claude auth login`",
        rawOutput: "exit 1: Invalid API key · Please run /login",
      },
      { label: "Model: Claude Opus 5", status: "failed", message: "Auth error" },
    ],
  },
};

/**
 * The CLI is missing, so the run stops there: the remaining checks stay Pending rather than being
 * reported as failures they never had the chance to be.
 */
export const NotInstalled: Story = {
  args: {
    rows: [
      {
        label: "Installation",
        status: "failed",
        message: "codex not found on PATH",
        rawOutput: "spawn codex ENOENT",
      },
      { label: "Authentication", status: "pending" },
      { label: "Model: Default", status: "pending" },
    ],
  },
};

/** A quota near its limit, and an auth probe that could not reach a verdict. */
export const MixedVerdicts: Story = {
  args: {
    rows: [
      { label: "Installation", status: "passed", message: "v0.42.0" },
      {
        label: "Authentication",
        status: "warning",
        message: "Keychain prompt timed out",
        rawOutput:
          "security: SecKeychainSearchCopyNext: The user name or passphrase you entered is not correct.",
      },
      {
        label: "Model: gpt-5-codex",
        status: "failed",
        message: "Quota exhausted or rate limited",
        rawOutput:
          "429 Too Many Requests: You exceeded your current quota, please check your plan and billing details.",
      },
      { label: "Model: Default", status: "passed", message: "Ok" },
    ],
  },
};

/** The request itself failed: the seeded checks are Cancelled and one extra row says why. */
export const RunFailed: Story = {
  args: {
    rows: [
      { label: "Installation", status: "warning", message: "Cancelled" },
      { label: "Authentication", status: "warning", message: "Cancelled" },
      { label: "Model: Default", status: "warning", message: "Cancelled" },
      {
        label: "Unexpected error",
        status: "failed",
        message: "Test run failed",
        rawOutput: "Tendril service is not running: daemon metadata (.master) not found",
      },
    ],
  },
};

/** `AgentTestDebugDialog` on its own, with a provider's stderr — routinely longer than the table. */
export const RawOutput: StoryObj<typeof AgentTestDebugDialog> = {
  render: () => (
    <AgentTestDebugDialog
      isOpen
      onClose={() => {}}
      output={[
        "Error: 401 Unauthorized",
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
        "    at ClaudeClient.request (/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js:1123:19)",
        "    at async validateModel (/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js:2210:5)",
        "Hint: run `claude auth login` or set ANTHROPIC_API_KEY.",
      ].join("\n")}
    />
  ),
};
