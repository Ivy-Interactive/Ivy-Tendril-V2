import type { Meta, StoryObj } from "@storybook/react";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

/**
 * The non-destructive half of the project Danger Zone: drops the config entry and leaves
 * everything on disk.
 *
 * V1's body here is a bare "This cannot be undone.", which is both vaguer than the truth and
 * points the wrong way — `delete_project` contains no `fs::` call of any kind, so the clones under
 * `<TENDRIL_HOME>/Projects/<name>/` and the plan folders survive, and adding the project back *is*
 * the undo. Its destructive sibling is `DeleteProjectDialog`, which is the one that asks you to
 * type the name.
 *
 * The project name is interpolated into the body and is also the path segment the route is
 * addressed by, so these stories are mostly about what a name can legally contain.
 */
const meta = {
  title: "Dialogs/Confirms/RemoveProjectDialog",
  component: RemoveProjectDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof RemoveProjectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

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

/** A leading dot reads as a hidden folder. Legal, and must render as itself. */
export const DotPrefixedName: Story = {
  args: { projectName: ".scratch" },
};

/** The shortest legal name, where a layout that assumes width has nowhere to hide. */
export const SingleCharacterName: Story = {
  args: { projectName: "x" },
};
