import type { Meta, StoryObj } from "@storybook/react";
import { DeleteProjectDialog } from "./DeleteProjectDialog";

/**
 * `ProjectDetailView.cs`'s Danger Zone button, and the only `WithConfirm` in V1. Had no test of any
 * kind before this file.
 *
 * The project name is interpolated into the body and is also the path segment the route is
 * addressed by, so these stories are mostly about what a name can legally contain.
 */
const meta = {
  title: "Dialogs/Confirms/DeleteProjectDialog",
  component: DeleteProjectDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof DeleteProjectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The base case. V1's body is a bare "This cannot be undone.", which is vaguer than the truth:
 * `delete_project` removes the config entry and nothing on disk.
 */
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

/** A leading dot reads as a hidden folder. Legal, and must render as itself. */
export const DotPrefixedName: Story = {
  args: { projectName: ".scratch" },
};

/** The shortest legal name, where a layout that assumes width has nowhere to hide. */
export const SingleCharacterName: Story = {
  args: { projectName: "x" },
};
