import type { Meta, StoryObj } from "@storybook/react";
import { DeletePlanDialog } from "./DeletePlanDialog";
import { plan } from "./storyModels";

/**
 * V1's `Apps/Plans/Dialogs/DeletePlanDialog`, in Framework's confirmation shape: Cancel outline
 * first, the destructive Delete last, nothing to type.
 *
 * It offers three outcomes rather than one — delete, Icebox, Skipped — so the stories are about
 * which of them a plan in a given state should be offered.
 */
const meta = {
  title: "Dialogs/Confirms/DeletePlanDialog",
  component: DeletePlanDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof DeletePlanDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The ordinary case, where deleting, archiving and skipping are all offered. */
export const DraftPlan: Story = {
  args: { plan: plan({ state: "Draft" }) },
};

/** A finished plan: whether the alternatives to deletion still make sense. */
export const CompletedPlan: Story = {
  args: { plan: plan({ state: "Completed" }) },
};

/** A plan a job still holds. Deletion is refused server-side, so the copy must not promise it. */
export const ExecutingPlan: Story = {
  args: { plan: plan({ state: "Executing" }) },
};

/** The plan id sits inside the body sentence, so a long title is a wrapping case around it. */
export const LongTitle: Story = {
  args: {
    plan: plan({
      title:
        "Give every dialog a story catalog that drives both Storybook and an automated contract suite",
    }),
  },
};

/**
 * What deletion actually removes. A plan with commits and an open PR is where the consequence is
 * largest.
 */
export const WithWorktreesAndPrs: Story = {
  args: {
    plan: plan({
      state: "Review",
      commits: ["a1b2c3d Add the stories", "e4f5g6h Add the contract runner"],
      prs: ["https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/241"],
    }),
  },
};
