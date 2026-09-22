import type { Meta, StoryObj } from "@storybook/react";
import { DeleteProjectDialog } from "./DeleteProjectDialog";

/**
 * The destructive half of the project Danger Zone, and the app's only typed-name gate.
 *
 * Its sibling `RemoveProjectDialog` drops the config entry and leaves everything on disk. This one
 * deletes, which is why it asks the operator to type the name first.
 *
 * Every story opens with the confirm **refused**, and that is the state worth looking at: the
 * primary is visible and disabled until the name is typed. The names chosen are the ones where
 * typing is awkward, because the gate is only as good as the phrase it asks for.
 */
const meta: Meta<typeof DeleteProjectDialog> = {
  title: "Dialogs/DeleteProjectDialog",
  component: DeleteProjectDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {} },
};

export default meta;
type Story = StoryObj<typeof DeleteProjectDialog>;

/** The base case, before anything is typed. */
export const OrdinaryProject: Story = { args: { projectName: "Ivy-Tendril-V2" } };

/** The name appears in the body, a path bullet, the field label and the placeholder. */
export const LongName: Story = {
  args: { projectName: "Company.Product.Infrastructure.Provisioning" },
};

/** A name the operator has to reproduce exactly, spaces and all, to arm the confirm. */
export const NameWithSpaces: Story = { args: { projectName: "My Side Project" } };

/** A leading dot is easy to drop when retyping, which is the gate working rather than a defect. */
export const DotPrefixedName: Story = { args: { projectName: ".scratch" } };

/** The weakest the gate ever is: one character. Still deliberate, still not a mis-click. */
export const SingleCharacterName: Story = { args: { projectName: "x" } };

/** The delete refused after the gate was passed. */
export const Refused: Story = {
  args: {
    projectName: "Ivy-Tendril-V2",
    error: "Project has 3 running jobs and cannot be deleted.",
  },
};
