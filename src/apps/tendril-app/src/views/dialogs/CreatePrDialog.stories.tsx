import type { Meta, StoryObj } from "@storybook/react";
import { CreatePrDialog } from "./CreatePrDialog";
import { plan } from "./storyModels";

/**
 * Opens a pull request from the plan's worktrees via the CreatePr promptware.
 *
 * It carries five toggles — solve merge conflicts, merge, delete branch, include artifacts, draft —
 * so the stories are about the plan shapes that reach it rather than every toggle combination,
 * which the controls in Storybook cover interactively.
 */
const meta = {
  title: "Dialogs/Dispatch/CreatePrDialog",
  component: CreatePrDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof CreatePrDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The five toggles at their defaults, which is what most dispatches send. */
export const ReviewPlanDefaults: Story = {
  args: { plan: plan({ state: "Review" }) },
};

/** A plan with work to open a PR for: the ordinary case the dialog exists to serve. */
export const WithCommits: Story = {
  args: {
    plan: plan({
      state: "Review",
      commits: ["a1b2c3d Add the stories", "e4f5g6h Add the contract runner"],
    }),
  },
};

/** A second PR on a plan that already has one — whether the dialog says so before dispatching. */
export const WithExistingPr: Story = {
  args: {
    plan: plan({
      state: "Review",
      prs: ["https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/241"],
    }),
  },
};

/** Three repos means three PRs, and the toggles apply to all of them. */
export const MultiRepo: Story = {
  args: {
    plan: plan({
      state: "Review",
      repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework", "/repos/Ivy-Tendril"],
    }),
  },
};

/** Nothing to open a PR against. */
export const NoRepos: Story = {
  args: { plan: plan({ state: "Review", repos: [] }) },
};

/** A plan already shipped. V1 offers the dialog anyway, so the copy has to hold. */
export const CompletedPlan: Story = {
  args: { plan: plan({ state: "Completed" }) },
};

/**
 * Opening a PR from a plan whose checks did not pass, which the verification gate allows but the
 * reviewer should see.
 */
export const WithFailedVerifications: Story = {
  args: {
    plan: plan({
      state: "Review",
      verifications: [
        { name: "RustClippy", status: "Fail" },
        { name: "NpmTest", status: "Pass" },
      ],
    }),
  },
};
