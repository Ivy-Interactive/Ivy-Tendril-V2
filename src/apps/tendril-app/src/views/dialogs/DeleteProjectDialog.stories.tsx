import type { Meta, StoryObj } from "@storybook/react";
import { DeleteProjectDialog } from "./DeleteProjectDialog";

/**
 * The destructive half of the project Danger Zone, and the app's only typed-name gate.
 *
 * Its non-destructive sibling is `RemoveProjectDialog`, which drops the config entry and leaves
 * everything on disk. This one deletes, which is why it asks the operator to type the project name
 * first.
 *
 * Every story below opens with the confirm **disabled**, and that is the state worth looking at:
 * the primary action is visible and refused until the name is typed, and the Ctrl+Enter cap is
 * absent for the same reason. The names chosen are the ones where typing is awkward — spaces, a
 * leading dot, a single character — because the gate is only as good as the phrase it asks for.
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
 * The base case, before anything is typed: the confirm is visible and refused, and the body lists
 * what deletion actually removes.
 */
export const OrdinaryProject: Story = {
  args: { projectName: "Ivy-Tendril-V2" },
};

/**
 * The name appears in the body, in the path bullet, in the field label and as the placeholder —
 * four wrapping cases from one string.
 */
export const LongName: Story = {
  args: { projectName: "Company.Product.Infrastructure.Provisioning" },
};

/** A name the operator has to reproduce exactly, spaces and all, to arm the confirm. */
export const NameWithSpaces: Story = {
  args: { projectName: "My Side Project" },
};

/** A leading dot is easy to drop when retyping, which is the gate doing its job, not a defect. */
export const DotPrefixedName: Story = {
  args: { projectName: ".scratch" },
};

/**
 * The weakest the gate ever is: one character. Still a deliberate act, and still not a slip of the
 * mouse between two adjacent buttons.
 */
export const SingleCharacterName: Story = {
  args: { projectName: "x" },
};
