import type { Meta, StoryObj } from "@storybook/react";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

/**
 * The reversible half of the project Danger Zone: drops the config entry and leaves everything on
 * disk. Its destructive sibling is `DeleteProjectDialog`, the one that asks you to type the name.
 *
 * V1's body here is a bare "This cannot be undone.", which is both vaguer than the truth and points
 * the wrong way — removing contains no filesystem call at all, so adding the project back *is* the
 * undo.
 */
const meta: Meta<typeof RemoveProjectDialog> = {
  title: "Dialogs/RemoveProjectDialog",
  component: RemoveProjectDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {} },
};

export default meta;
type Story = StoryObj<typeof RemoveProjectDialog>;

/** The base case, where the copy has to say that the files stay on disk. */
export const OrdinaryProject: Story = {
  args: { projectName: "Ivy-Tendril-V2" },
};

/** A long name is a wrapping case, since the name sits inside a sentence. */
export const LongName: Story = {
  args: { projectName: "Company.Product.Infrastructure.Provisioning" },
};

/** Spaces are legal and reach the route as a path segment, so they are worth seeing rendered. */
export const NameWithSpaces: Story = {
  args: { projectName: "My Side Project" },
};

/** Mid-request: the confirm is disabled so a second click cannot double-send. */
export const Busy: Story = {
  args: { projectName: "Ivy-Tendril-V2", isBusy: true },
};

/** On rejection the dialog stays open carrying the backend's message. */
export const BackendRejection: Story = {
  args: {
    projectName: "Ivy-Tendril-V2",
    error: "Project is referenced by 3 running jobs and cannot be removed.",
  },
};
