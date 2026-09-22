import type { Meta, StoryObj } from "@storybook/react";
import { UpdatePlanDialog } from "./UpdatePlanDialog";
import { plan } from "./storyModels";
import type { Job } from "../../types/api";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "1184",
    type: "ExecutePlan",
    planId: "00412",
    project: "Ivy-Tendril-V2",
    status: "Running",
    ...overrides,
  };
}

/**
 * Refines an already-drafted plan via the UpdatePlan promptware.
 *
 * `planJobs` drives V1's "UpdatePlan is already running for this plan" warning. It is optional and
 * a convenience rather than the authority — the service refuses a second UpdatePlan on the same
 * folder either way — so the stories cover what the dialog can and cannot tell.
 */
const meta = {
  title: "Dialogs/Dispatch/UpdatePlanDialog",
  component: UpdatePlanDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof UpdatePlanDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing is running, so nothing is warned about. */
export const NoJobs: Story = {
  args: { plan: plan(), planJobs: [] },
};

/** The warning fires. */
export const UpdatePlanAlreadyRunning: Story = {
  args: { plan: plan(), planJobs: [job({ type: "UpdatePlan", status: "Running" })] },
};

/** ExecutePlan is running, which is not what the warning is about: the check is type-specific. */
export const DifferentJobRunning: Story = {
  args: {
    plan: plan({ state: "Executing" }),
    planJobs: [job({ type: "ExecutePlan", status: "Running" })],
  },
};

/** A completed UpdatePlan is not a running one, so the warning must not fire on history. */
export const UpdatePlanFinished: Story = {
  args: { plan: plan(), planJobs: [job({ type: "UpdatePlan", status: "Completed" })] },
};

/** Without the list the dialog cannot tell, and must not claim either way. */
export const PlanJobsAbsent: Story = {
  args: { plan: plan() },
};

/** UpdatePlan refines an existing draft, so a plan carrying its original prompt is realistic. */
export const WithInitialPrompt: Story = {
  args: {
    plan: plan({ initialPrompt: "Give every dialog a story catalog and render it two ways." }),
    planJobs: [],
  },
};
