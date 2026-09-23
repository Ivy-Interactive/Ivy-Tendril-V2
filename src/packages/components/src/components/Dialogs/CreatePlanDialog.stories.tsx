import type { Meta, StoryObj } from "@storybook/react";
import { CreatePlanDialog } from "./CreatePlanDialog";

/**
 * Create New Plan - V1's `Apps/Plans/Dialogs/CreatePlanDialog`: a project picker over one
 * `ContentInput` that owns Create, the "Chat with <agent>" split entry and the paperclip.
 *
 * The picker is a segmented toggle up to six projects and a select above that; "Auto" leads whenever
 * there is more than one project, and "+ Add New Project" closes the dialog for Settings. Below the
 * `sm` breakpoint the dialog docks to the bottom edge, V1's mobile `Sheet` - shrink the viewport to
 * see it.
 */
const meta: Meta<typeof CreatePlanDialog> = {
  title: "Dialogs/CreatePlanDialog",
  component: CreatePlanDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onSubmit: () => {},
    onAddProject: () => {},
    projects: ["Tendril", "Ivy-Framework"],
    agentLabel: "Claude",
    onContinueInChat: () => {},
    onUploadFile: async (file) => `C:\\Users\\dev\\.tendril\\Attachments\\3f2a\\${file.name}`,
  },
};

export default meta;
type Story = StoryObj<typeof CreatePlanDialog>;

/** Two projects: "Auto" leads and is selected, then the projects, then the way to Settings. */
export const TwoProjects: Story = {};

/** One project: nothing to decide, so no "Auto" and the project is pre-selected. */
export const SingleProject: Story = { args: { projects: ["Tendril"] } };

/** Above six projects the toggle becomes a select. */
export const ManyProjects: Story = {
  args: {
    projects: [
      "Tendril",
      "Ivy-Framework",
      "Ivy-Web",
      "Ivy-Docs",
      "Ivy-Agent",
      "Ivy-Examples",
      "Company.Product.Infrastructure",
    ],
  },
};

/** Opened from an inbox issue: the description and project are pre-filled. */
export const Prefilled: Story = {
  args: {
    initialProject: "Ivy-Framework",
    initialDescription:
      "Fix OAuth callback\n\nTask from GitHub Issue #88 (https://github.com/Ivy-Interactive/Ivy-Framework/issues/88):\n\nToken refresh fails on redirect when the session cookie has expired.",
  },
};

/** No "Chat with …" entry and no Settings escape hatch: the caller supplied neither. */
export const Minimal: Story = {
  args: { agentLabel: undefined, onContinueInChat: undefined, onAddProject: undefined },
};

/** Mid-dispatch (the preflight or the job start). */
export const Busy: Story = { args: { isBusy: true, initialDescription: "Add a dark mode toggle" } };

/** The dispatch was refused; the text stays for another try. */
export const Rejected: Story = {
  args: {
    initialDescription: "Add a dark mode toggle",
    error: "A CreatePlan job with this description is already queued (#1184).",
  },
};
